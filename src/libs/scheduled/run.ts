import { eq, lt } from 'drizzle-orm'

import { HISTORY_RETENTION_MS } from '../../constants/distribution'
import { createDb } from '../../db'
import { campaigns, distributions } from '../../db/schema'
import type { Bindings } from '../../types/Bindings'
import { acceptDistribution } from '../distribution/accept'
import { reconcileRecipientOutcome } from '../distribution/indexRecipient'
import { createMailIdempotencyStore } from '../idempotency/store'
import { getCampaignManifest, getCampaignStatus } from '../mail/campaignStore'
import { getRecipientOutcome } from '../mail/outcomeStore'

const PAGE_SIZE = 50
const RETENTION_BATCH = 20
const BACKFILL_BATCH = 20

type ScheduledCursorName = 'backfill' | 'reconcile'

const logScheduled = (event: string, data: Record<string, unknown>) => {
	console.log(
		JSON.stringify({
			event,
			...data,
		}),
	)
}

const isBackfillDryRun = (value: string | undefined) => value !== 'false'

const cursorKey = (environment: string, name: ScheduledCursorName) =>
	`${environment}/state/scheduled/${name}-cursor.json`

const getScheduledCursor = async (
	bucket: R2Bucket,
	environment: string,
	name: ScheduledCursorName,
) => {
	const object = await bucket.get(cursorKey(environment, name))
	if (!object) {
		return undefined
	}

	const state = await object.json<{ cursor?: string }>()
	return state.cursor
}

const saveScheduledCursor = async (
	bucket: R2Bucket,
	environment: string,
	name: ScheduledCursorName,
	nextCursor?: string,
) => {
	const key = cursorKey(environment, name)
	if (!nextCursor) {
		await bucket.delete(key)
		return
	}

	await bucket.put(key, JSON.stringify({ cursor: nextCursor }), {
		httpMetadata: { contentType: 'application/json' },
	})
}

const listAllKeys = async (bucket: R2Bucket, prefix: string, limit: number) => {
	const keys: string[] = []
	let cursor: string | undefined

	do {
		const page = await bucket.list({
			prefix,
			cursor,
			limit: Math.min(1000, limit - keys.length),
		})
		for (const object of page.objects) {
			keys.push(object.key)
			if (keys.length >= limit) {
				return keys
			}
		}
		cursor = page.truncated ? page.cursor : undefined
	} while (cursor)

	return keys
}

export const reconcileOutcomes = async (bindings: Bindings) => {
	const cursor = await getScheduledCursor(
		bindings.MAIL_LOGS_BUCKET,
		bindings.ENVIRONMENT,
		'reconcile',
	)
	const page = await bindings.MAIL_LOGS_BUCKET.list({
		prefix: `${bindings.ENVIRONMENT}/outcomes/`,
		cursor,
		limit: PAGE_SIZE,
	})
	const keys = page.objects.map((object) => object.key)
	let repaired = 0

	for (const key of keys) {
		const parts = key.split('/')
		const campaignId = parts.at(-2)
		const recipientFile = parts.at(-1)
		const recipientId = recipientFile?.replace(/\.json$/, '')
		if (!campaignId || !recipientId) {
			continue
		}

		const outcome = await getRecipientOutcome(
			bindings.MAIL_LOGS_BUCKET,
			bindings.ENVIRONMENT,
			campaignId,
			recipientId,
		)
		if (!outcome) {
			continue
		}

		const changed = await reconcileRecipientOutcome(bindings.DB, outcome)
		if (changed) {
			repaired += 1
		}
	}

	await saveScheduledCursor(
		bindings.MAIL_LOGS_BUCKET,
		bindings.ENVIRONMENT,
		'reconcile',
		page.truncated ? page.cursor : undefined,
	)

	logScheduled('mail_history.reconcile_completed', {
		environment: bindings.ENVIRONMENT,
		scanned: keys.length,
		repaired,
	})

	return { scanned: keys.length, repaired }
}

export const backfillLegacyCampaigns = async (bindings: Bindings) => {
	const dryRun = isBackfillDryRun(bindings.BACKFILL_DRY_RUN)
	const prefix = `${bindings.ENVIRONMENT}/state/campaigns/`
	const cursor = await getScheduledCursor(
		bindings.MAIL_LOGS_BUCKET,
		bindings.ENVIRONMENT,
		'backfill',
	)
	const listed = await bindings.MAIL_LOGS_BUCKET.list({
		prefix,
		delimiter: '/',
		cursor,
		limit: BACKFILL_BATCH,
	})
	const campaignIds = (listed.delimitedPrefixes ?? [])
		.map((value) => value.slice(prefix.length).replace(/\/$/, ''))
		.filter(Boolean)
	const db = createDb(bindings.DB)
	let considered = 0
	let created = 0

	for (const campaignId of campaignIds) {
		considered += 1
		const [existing] = await db
			.select({ id: campaigns.id })
			.from(campaigns)
			.where(eq(campaigns.id, campaignId))
			.limit(1)
		if (existing) {
			continue
		}

		const manifest = await getCampaignManifest(
			bindings.MAIL_LOGS_BUCKET,
			bindings.ENVIRONMENT,
			campaignId,
		)
		if (!manifest) {
			continue
		}

		logScheduled(dryRun ? 'mail_backfill.dry_run' : 'mail_backfill.apply', {
			environment: bindings.ENVIRONMENT,
			campaignId,
			uniqueRecipients: manifest.uniqueRecipients,
		})

		if (dryRun) {
			continue
		}

		await acceptDistribution(bindings, {
			kind: 'transactional',
			source: 'legacy-bulk',
			from: manifest.from,
			subject: manifest.subject,
			body: manifest.body,
			recipients: manifest.recipients.map((email) => ({ email })),
			requestedRecipients: manifest.requestedRecipients,
			campaignId,
			enqueue: false,
		})

		const status = await getCampaignStatus(
			bindings.MAIL_LOGS_BUCKET,
			bindings.ENVIRONMENT,
			campaignId,
		)
		if (status) {
			await db
				.update(campaigns)
				.set({
					status: status.status,
					processedRecipients: status.processedRecipients,
					sentRecipients: status.sentRecipients,
					failedRecipients: status.failedRecipients,
					startedAt: status.startedAt,
					completedAt: status.completedAt,
				})
				.where(eq(campaigns.id, campaignId))
		}

		created += 1
	}

	await saveScheduledCursor(
		bindings.MAIL_LOGS_BUCKET,
		bindings.ENVIRONMENT,
		'backfill',
		listed.truncated ? listed.cursor : undefined,
	)

	logScheduled('mail_backfill.completed', {
		environment: bindings.ENVIRONMENT,
		dryRun,
		considered,
		created,
	})

	return { dryRun, considered, created }
}

export const runRetention = async (bindings: Bindings, now = Date.now()) => {
	const cutoff = new Date(now - HISTORY_RETENTION_MS).toISOString()
	const db = createDb(bindings.DB)
	const expired = await db
		.select({
			id: distributions.id,
		})
		.from(distributions)
		.where(lt(distributions.createdAt, cutoff))
		.limit(RETENTION_BATCH)

	let deleted = 0
	for (const row of expired) {
		const childCampaigns = await db
			.select({ id: campaigns.id })
			.from(campaigns)
			.where(eq(campaigns.distributionId, row.id))

		for (const campaign of childCampaigns) {
			const objects = await listAllKeys(
				bindings.MAIL_LOGS_BUCKET,
				`${bindings.ENVIRONMENT}/state/campaigns/${campaign.id}/`,
				500,
			)
			const outcomes = await listAllKeys(
				bindings.MAIL_LOGS_BUCKET,
				`${bindings.ENVIRONMENT}/outcomes/${campaign.id}/`,
				500,
			)
			const campaignKeys = [...objects, ...outcomes]
			if (campaignKeys.length > 0) {
				await bindings.MAIL_LOGS_BUCKET.delete(campaignKeys)
			}
		}

		const distributionObjects = await listAllKeys(
			bindings.MAIL_LOGS_BUCKET,
			`${bindings.ENVIRONMENT}/state/distributions/${row.id}/`,
			100,
		)
		if (distributionObjects.length > 0) {
			await bindings.MAIL_LOGS_BUCKET.delete(distributionObjects)
		}

		await db.delete(distributions).where(eq(distributions.id, row.id))
		deleted += 1
	}

	logScheduled('mail_history.retention_completed', {
		environment: bindings.ENVIRONMENT,
		cutoff,
		deleted,
	})

	return { deleted }
}

export const purgeIdempotencyKeys = async (bindings: Bindings) => {
	const store = createMailIdempotencyStore(bindings.DB)
	await store.get('__purge_init__')
	await store.purge()
	logScheduled('mail_history.idempotency_purged', {
		environment: bindings.ENVIRONMENT,
	})
}

export const handleScheduled = async (bindings: Bindings) => {
	await reconcileOutcomes(bindings)
	await backfillLegacyCampaigns(bindings)
	await runRetention(bindings)
	await purgeIdempotencyKeys(bindings)
}
