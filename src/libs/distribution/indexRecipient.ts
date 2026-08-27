import { and, eq, exists, sql } from 'drizzle-orm'

import { createDb } from '../../db'
import { campaigns, distributions, recipients } from '../../db/schema'
import type { RecipientStatus } from '../../db/values'
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
	const sentDelta = next.status === 'sent' ? 1 : 0
	const failedDelta = next.status === 'failed' ? 1 : 0
	const recipientIsPending = exists(
		db
			.select({ id: recipients.id })
			.from(recipients)
			.where(and(eq(recipients.id, row.id), eq(recipients.status, 'pending'))),
	)

	const [, , updated] = await db.batch([
		db
			.update(campaigns)
			.set({
				processedRecipients: sql`${campaigns.processedRecipients} + 1`,
				sentRecipients: sql`${campaigns.sentRecipients} + ${sentDelta}`,
				failedRecipients: sql`${campaigns.failedRecipients} + ${failedDelta}`,
				startedAt: sql`coalesce(${campaigns.startedAt}, ${next.timestamp})`,
				status: sql`case
					when ${campaigns.processedRecipients} + 1 < ${campaigns.uniqueRecipients} then 'processing'
					when ${campaigns.failedRecipients} + ${failedDelta} = 0 then 'completed'
					when ${campaigns.sentRecipients} + ${sentDelta} = 0 then 'failed'
					else 'partial_failed'
				end`,
				completedAt: sql`case
					when ${campaigns.processedRecipients} + 1 = ${campaigns.uniqueRecipients} then ${next.timestamp}
					else ${campaigns.completedAt}
				end`,
			})
			.where(and(eq(campaigns.id, row.campaignId), recipientIsPending)),
		db
			.update(distributions)
			.set({
				processedRecipients: sql`${distributions.processedRecipients} + 1`,
				sentRecipients: sql`${distributions.sentRecipients} + ${sentDelta}`,
				failedRecipients: sql`${distributions.failedRecipients} + ${failedDelta}`,
				startedAt: sql`coalesce(${distributions.startedAt}, ${next.timestamp})`,
				status: sql`case
					when ${distributions.processedRecipients} + 1 < ${distributions.uniqueRecipients} then 'processing'
					when ${distributions.failedRecipients} + ${failedDelta} = 0 then 'completed'
					when ${distributions.sentRecipients} + ${sentDelta} = 0 then 'failed'
					else 'partial_failed'
				end`,
				completedAt: sql`case
					when ${distributions.processedRecipients} + 1 = ${distributions.uniqueRecipients} then ${next.timestamp}
					else ${distributions.completedAt}
				end`,
			})
			.where(and(eq(distributions.id, row.distributionId), recipientIsPending)),
		db
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
			.returning({ id: recipients.id }),
	])

	return updated.length > 0
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

	const timestamp = new Date().toISOString()
	const proposedOutcome: RecipientOutcome = {
		environment: input.environment,
		distributionId: row.distributionId,
		campaignId: input.campaignId,
		recipientId: row.id,
		email: row.email,
		status: input.status,
		providerMessageId: input.providerMessageId,
		attempts: input.attempts,
		duplicatePossible: input.duplicatePossible === true,
		error: input.error,
		timestamp,
	}

	const saved = await saveRecipientOutcome(input.bucket, proposedOutcome)
	const duplicatePossible =
		saved.outcome.duplicatePossible ||
		input.duplicatePossible === true ||
		!saved.created

	try {
		await applyTerminalStatus(input.database, row, {
			status: saved.outcome.status,
			providerMessageId: saved.outcome.providerMessageId,
			lastError: saved.outcome.error,
			attemptCount: saved.outcome.attempts,
			duplicatePossible,
			timestamp: saved.outcome.timestamp,
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

	return applyTerminalStatus(database, row, {
		status: outcome.status,
		providerMessageId: outcome.providerMessageId,
		lastError: outcome.error,
		attemptCount: outcome.attempts,
		duplicatePossible: outcome.duplicatePossible,
		timestamp: outcome.timestamp,
	})
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
