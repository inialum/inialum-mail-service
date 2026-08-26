import { and, eq, sql } from 'drizzle-orm'

import { createDb } from '../../db'
import { campaigns, distributions, recipients } from '../../db/schema'
import type { RecipientStatus } from '../../db/values'
import { resolveCampaignStatus } from '../mail/campaignStore'
import {
	getRecipientOutcome,
	type RecipientOutcome,
	saveRecipientOutcome,
} from '../mail/outcomeStore'

const logIndexEvent = (event: string, data: Record<string, unknown>) => {
	console.error(
		JSON.stringify({
			event,
			...data,
		}),
	)
}

export const findRecipientByCampaignEmail = async (
	database: D1Database,
	campaignId: string,
	email: string,
) => {
	const db = createDb(database)
	const normalized = email.trim().toLowerCase()
	const [row] = await db
		.select()
		.from(recipients)
		.where(
			and(
				eq(recipients.campaignId, campaignId),
				eq(recipients.emailNormalized, normalized),
			),
		)
		.limit(1)

	return row ?? null
}

const applyTerminalStatus = async (
	database: D1Database,
	row: typeof recipients.$inferSelect,
	next: {
		status: Exclude<RecipientStatus, 'pending'>
		providerMessageId?: string
		lastError?: string
		attemptCount: number
		duplicatePossible: boolean
		timestamp: string
	},
) => {
	const db = createDb(database)
	const updated = await db
		.update(recipients)
		.set({
			status: next.status,
			providerMessageId: next.providerMessageId,
			lastError: next.lastError,
			attemptCount: next.attemptCount,
			duplicatePossible: next.duplicatePossible,
			updatedAt: next.timestamp,
		})
		.where(and(eq(recipients.id, row.id), eq(recipients.status, 'pending')))
		.returning({ id: recipients.id })

	if (updated.length === 0) {
		return
	}

	const sentDelta = next.status === 'sent' ? 1 : 0
	const failedDelta = next.status === 'failed' ? 1 : 0

	await db.batch([
		db
			.update(campaigns)
			.set({
				processedRecipients: sql`${campaigns.processedRecipients} + 1`,
				sentRecipients: sql`${campaigns.sentRecipients} + ${sentDelta}`,
				failedRecipients: sql`${campaigns.failedRecipients} + ${failedDelta}`,
				startedAt: sql`coalesce(${campaigns.startedAt}, ${next.timestamp})`,
			})
			.where(eq(campaigns.id, row.campaignId)),
		db
			.update(distributions)
			.set({
				processedRecipients: sql`${distributions.processedRecipients} + 1`,
				sentRecipients: sql`${distributions.sentRecipients} + ${sentDelta}`,
				failedRecipients: sql`${distributions.failedRecipients} + ${failedDelta}`,
				startedAt: sql`coalesce(${distributions.startedAt}, ${next.timestamp})`,
			})
			.where(eq(distributions.id, row.distributionId)),
	])

	const [campaign] = await db
		.select()
		.from(campaigns)
		.where(eq(campaigns.id, row.campaignId))
		.limit(1)

	if (!campaign) {
		return
	}

	const campaignStatus = resolveCampaignStatus(campaign)
	const campaignCompletedAt =
		campaign.processedRecipients === campaign.uniqueRecipients
			? next.timestamp
			: null

	await db
		.update(campaigns)
		.set({
			status: campaignStatus,
			completedAt: campaignCompletedAt,
		})
		.where(eq(campaigns.id, campaign.id))

	const [distribution] = await db
		.select()
		.from(distributions)
		.where(eq(distributions.id, row.distributionId))
		.limit(1)

	if (!distribution) {
		return
	}

	const distributionStatus = resolveCampaignStatus(distribution)
	const distributionCompletedAt =
		distribution.processedRecipients === distribution.uniqueRecipients
			? next.timestamp
			: null

	await db
		.update(distributions)
		.set({
			status: distributionStatus,
			completedAt: distributionCompletedAt,
		})
		.where(eq(distributions.id, distribution.id))
}

export const finalizeRecipientDelivery = async (input: {
	database: D1Database
	bucket: R2Bucket
	environment: string
	campaignId: string
	email: string
	status: Exclude<RecipientStatus, 'pending'>
	providerMessageId?: string
	error?: string
	attempts: number
	duplicatePossible?: boolean
}) => {
	const row = await findRecipientByCampaignEmail(
		input.database,
		input.campaignId,
		input.email,
	)

	if (!row) {
		return { indexed: false as const, skippedSend: false as const }
	}

	const existingOutcome = await getRecipientOutcome(
		input.bucket,
		input.environment,
		input.campaignId,
		row.id,
	)
	const duplicatePossible =
		input.duplicatePossible === true || Boolean(existingOutcome)

	const timestamp = new Date().toISOString()
	const outcome: RecipientOutcome = {
		environment: input.environment,
		distributionId: row.distributionId,
		campaignId: input.campaignId,
		recipientId: row.id,
		email: row.email,
		status: input.status,
		providerMessageId: input.providerMessageId,
		attempts: input.attempts,
		duplicatePossible,
		error: input.error,
		timestamp,
	}

	await saveRecipientOutcome(input.bucket, outcome)

	try {
		await applyTerminalStatus(input.database, row, {
			status: input.status,
			providerMessageId: input.providerMessageId,
			lastError: input.error,
			attemptCount: input.attempts,
			duplicatePossible,
			timestamp,
		})
	} catch (error) {
		logIndexEvent('mail_history.index_update_failed', {
			campaignId: input.campaignId,
			recipientId: row.id,
			error: error instanceof Error ? error.message : String(error),
		})
	}

	return { indexed: true as const, skippedSend: false as const, recipient: row }
}

export const reconcileRecipientOutcome = async (
	database: D1Database,
	outcome: RecipientOutcome,
) => {
	const db = createDb(database)
	const [row] = await db
		.select()
		.from(recipients)
		.where(eq(recipients.id, outcome.recipientId))
		.limit(1)

	if (!row || row.status !== 'pending') {
		return false
	}

	await applyTerminalStatus(database, row, {
		status: outcome.status,
		providerMessageId: outcome.providerMessageId,
		lastError: outcome.error,
		attemptCount: outcome.attempts,
		duplicatePossible: outcome.duplicatePossible,
		timestamp: outcome.timestamp,
	})
	return true
}

export const getExistingSentOutcome = async (input: {
	database: D1Database
	bucket: R2Bucket
	environment: string
	campaignId: string
	email: string
}) => {
	const row = await findRecipientByCampaignEmail(
		input.database,
		input.campaignId,
		input.email,
	)
	if (!row) {
		return null
	}

	const outcome = await getRecipientOutcome(
		input.bucket,
		input.environment,
		input.campaignId,
		row.id,
	)
	if (outcome?.status !== 'sent') {
		return null
	}

	return { row, outcome }
}
