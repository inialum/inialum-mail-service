import { eq } from 'drizzle-orm'

import { createDb } from '../../db'
import { distributions, recipients } from '../../db/schema'
import worker from '../../index'
import { testEnv } from '../../types/testEnv'
import { acceptDistribution } from '../distribution/accept'
import { saveCampaignManifest, saveCampaignStatus } from '../mail/campaignStore'
import { saveRecipientOutcome } from '../mail/outcomeStore'
import {
	backfillLegacyCampaigns,
	handleScheduled,
	reconcileOutcomes,
} from './run'
import { applyD1Migrations, createScheduledController } from 'cloudflare:test'

describe('scheduled history jobs', () => {
	beforeEach(async () => {
		await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
		const db = createDb(testEnv.DB)
		await db.delete(distributions)

		for (const prefix of [
			'test/outcomes/',
			'test/state/campaigns/',
			'test/state/distributions/',
			'test/state/scheduled/',
		]) {
			let cursor: string | undefined
			do {
				const page = await testEnv.MAIL_LOGS_BUCKET.list({ prefix, cursor })
				if (page.objects.length > 0) {
					await testEnv.MAIL_LOGS_BUCKET.delete(
						page.objects.map((object) => object.key),
					)
				}
				cursor = page.truncated ? page.cursor : undefined
			} while (cursor)
		}
	})

	test('dry-run backfill does not insert legacy campaigns', async () => {
		await saveCampaignManifest(testEnv.MAIL_LOGS_BUCKET, {
			environment: 'test',
			campaignId: 'legacy-campaign-1',
			createdAt: '2026-01-01T00:00:00.000Z',
			from: 'noreply@mail.inialum.org',
			subject: 'Legacy',
			body: { text: 'old' },
			recipients: ['legacy@example.com'],
			requestedRecipients: 1,
			uniqueRecipients: 1,
			chunkCount: 1,
		})
		await saveCampaignStatus(testEnv.MAIL_LOGS_BUCKET, {
			environment: 'test',
			campaignId: 'legacy-campaign-1',
			status: 'completed',
			requestedRecipients: 1,
			uniqueRecipients: 1,
			processedRecipients: 1,
			sentRecipients: 1,
			failedRecipients: 0,
			createdAt: '2026-01-01T00:00:00.000Z',
		})

		await handleScheduled({ ...testEnv, BACKFILL_DRY_RUN: 'true' })

		const db = createDb(testEnv.DB)
		const rows = await db.select().from(distributions)
		expect(rows.some((row) => row.source === 'legacy-bulk')).toBe(false)
	})

	test('reconcile repairs a pending recipient from an R2 outcome', async () => {
		const accepted = await acceptDistribution(testEnv, {
			kind: 'transactional',
			source: 'reconcile-test',
			from: 'noreply@mail.inialum.org',
			subject: 'Reconcile',
			body: { text: 'hi' },
			recipients: [{ email: 'repair@example.com' }],
			enqueue: false,
		})
		const db = createDb(testEnv.DB)
		const [recipient] = await db.select().from(recipients)
		expect(recipient?.status).toBe('pending')

		await saveRecipientOutcome(testEnv.MAIL_LOGS_BUCKET, {
			environment: 'test',
			distributionId: accepted.distributionId,
			campaignId: accepted.campaignIds[0] ?? 'missing',
			recipientId: recipient?.id ?? 'missing',
			email: 'repair@example.com',
			status: 'sent',
			providerMessageId: 'ses-repair',
			attempts: 1,
			duplicatePossible: false,
			timestamp: new Date().toISOString(),
		})

		await handleScheduled({ ...testEnv, BACKFILL_DRY_RUN: 'true' })

		const [repaired] = await db.select().from(recipients)
		expect(repaired?.status).toBe('sent')
		expect(repaired?.providerMessageId).toBe('ses-repair')
	})

	test('reconcile advances past the first outcome page', async () => {
		const accepted = await acceptDistribution(testEnv, {
			kind: 'transactional',
			source: 'reconcile-pages',
			from: 'noreply@mail.inialum.org',
			subject: 'Reconcile pages',
			body: { text: 'hi' },
			recipients: Array.from({ length: 51 }, (_, index) => ({
				email: `page-${index}@example.com`,
			})),
			enqueue: false,
		})
		const db = createDb(testEnv.DB)
		const rows = await db
			.select()
			.from(recipients)
			.where(eq(recipients.distributionId, accepted.distributionId))

		await Promise.all(
			rows.map((recipient) =>
				saveRecipientOutcome(testEnv.MAIL_LOGS_BUCKET, {
					environment: 'test',
					distributionId: accepted.distributionId,
					campaignId: recipient.campaignId,
					recipientId: recipient.id,
					email: recipient.email,
					status: 'sent',
					providerMessageId: `ses-${recipient.id}`,
					attempts: 1,
					duplicatePossible: false,
					timestamp: new Date().toISOString(),
				}),
			),
		)

		const first = await reconcileOutcomes(testEnv)
		const second = await reconcileOutcomes(testEnv)
		expect(first).toEqual({ scanned: 50, repaired: 50 })
		expect(second).toEqual({ scanned: 1, repaired: 1 })
	})

	test('backfill advances past the first legacy campaign page', async () => {
		for (let index = 0; index < 21; index += 1) {
			const campaignId = `legacy-page-${String(index).padStart(2, '0')}`
			await saveCampaignManifest(testEnv.MAIL_LOGS_BUCKET, {
				environment: 'test',
				campaignId,
				createdAt: '2026-01-01T00:00:00.000Z',
				from: 'noreply@mail.inialum.org',
				subject: `Legacy ${index}`,
				body: { text: 'old' },
				recipients: [`legacy-${index}@example.com`],
				requestedRecipients: 1,
				uniqueRecipients: 1,
				chunkCount: 1,
			})
			await saveCampaignStatus(testEnv.MAIL_LOGS_BUCKET, {
				environment: 'test',
				campaignId,
				status: 'completed',
				requestedRecipients: 1,
				uniqueRecipients: 1,
				processedRecipients: 1,
				sentRecipients: 1,
				failedRecipients: 0,
				createdAt: '2026-01-01T00:00:00.000Z',
			})
		}

		const bindings = { ...testEnv, BACKFILL_DRY_RUN: 'false' }
		const first = await backfillLegacyCampaigns(bindings)
		const second = await backfillLegacyCampaigns(bindings)
		expect(first.created).toBe(20)
		expect(second.created).toBe(1)
	})

	test('retention deletes distributions older than one year', async () => {
		const db = createDb(testEnv.DB)
		await acceptDistribution(testEnv, {
			kind: 'transactional',
			source: 'old',
			from: 'noreply@mail.inialum.org',
			subject: 'Old',
			body: { text: 'old' },
			recipients: [{ email: 'old@example.com' }],
			enqueue: false,
		})
		await db.update(distributions).set({
			createdAt: '2020-01-01T00:00:00.000Z',
		})

		await handleScheduled({ ...testEnv, BACKFILL_DRY_RUN: 'true' })

		const remaining = await db.select().from(distributions)
		expect(remaining).toHaveLength(0)
	})

	test('scheduled handler is exported on the worker', () => {
		expect(worker.scheduled).toBeTypeOf('function')
		const controller = createScheduledController({ cron: '0 17 * * *' })
		expect(controller.cron).toBe('0 17 * * *')
	})
})
