import { eq } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'

import {
	D1_MAX_BATCH_STATEMENTS,
	RECIPIENTS_PER_CAMPAIGN,
	RECIPIENTS_PER_INSERT,
} from '../../constants/distribution'
import { RECIPIENTS_PER_CHUNK } from '../../constants/mail'
import { createDb, type MailDb } from '../../db'
import { campaigns, distributions, recipients } from '../../db/schema'
import type {
	DistributionKind,
	DistributionStatus,
	SubscriptionKind,
} from '../../db/values'
import type { MailCampaignBody } from '../../types/MailCampaign'
import type { MailQueueMessage } from '../../types/MailQueueMessage'
import {
	createCampaignId,
	createDistributionId,
	createRecipientId,
} from '../ids'
import {
	saveCampaignChunkProgress,
	saveCampaignManifest,
	saveCampaignStatus,
	updateCampaignStatus,
} from '../mail/campaignStore'
import { saveDistributionManifest } from '../mail/distributionStore'
import { saveCampaignAcceptedLog, saveMailLogToR2 } from '../mail/r2Logger'
import {
	chunkItems,
	dedupeRecipients,
	type IncomingRecipient,
	splitIntoCampaigns,
	splitIntoChunks,
} from './recipients'

export type AcceptDistributionInput = {
	kind: DistributionKind
	subscriptionKind?: SubscriptionKind | null
	source: string
	actor?: string | null
	audienceSnapshot?: unknown
	from: string
	subject: string
	body: MailCampaignBody
	recipients: IncomingRecipient[]
	requestedRecipients?: number
	idempotencyKey?: string | null
	campaignId?: string
	enqueue: boolean
}

export type AcceptDistributionResult = {
	distributionId: string
	campaignIds: string[]
	uniqueRecipients: number
	requestedRecipients: number
	status: DistributionStatus
}

type AcceptBindings = {
	DB: D1Database
	MAIL_LOGS_BUCKET: R2Bucket
	MAIL_SEND_QUEUE: {
		sendBatch: (
			messages: { body: MailQueueMessage; contentType: 'json' }[],
		) => Promise<unknown>
	}
	ENVIRONMENT: string
}

const emptyBatchError = new Error('D1 batch requires at least one statement')

export class DistributionAcceptanceIncompleteError extends Error {
	constructor(distributionId: string) {
		super(`Distribution acceptance is incomplete: ${distributionId}`)
		this.name = 'DistributionAcceptanceIncompleteError'
	}
}

type MailBatchStatement = BatchItem<'sqlite'>

const runBatches = async (db: MailDb, statements: MailBatchStatement[]) => {
	if (statements.length === 0) {
		throw emptyBatchError
	}

	for (
		let index = 0;
		index < statements.length;
		index += D1_MAX_BATCH_STATEMENTS
	) {
		const chunk = statements.slice(index, index + D1_MAX_BATCH_STATEMENTS)
		await db.batch(chunk as [MailBatchStatement, ...MailBatchStatement[]])
	}
}

export const acceptDistribution = async (
	bindings: AcceptBindings,
	input: AcceptDistributionInput,
): Promise<AcceptDistributionResult> => {
	const requestedRecipients =
		input.requestedRecipients ?? input.recipients.length
	const uniqueRecipients = dedupeRecipients(input.recipients)
	const timestamp = new Date().toISOString()
	const distributionId = createDistributionId()
	const campaignGroups = splitIntoCampaigns(
		uniqueRecipients,
		RECIPIENTS_PER_CAMPAIGN,
	)
	const campaignRows = campaignGroups.map((group, campaignIndex) => {
		const campaignId =
			campaignIndex === 0 && input.campaignId
				? input.campaignId
				: createCampaignId()
		const chunks = splitIntoChunks(group, RECIPIENTS_PER_CHUNK)

		return {
			campaignId,
			recipients: group,
			chunks,
		}
	})

	const db = createDb(bindings.DB)
	const audienceSnapshot =
		input.audienceSnapshot === undefined
			? null
			: JSON.stringify(input.audienceSnapshot)

	const statements = [
		db.insert(distributions).values({
			id: distributionId,
			kind: input.kind,
			subscriptionKind: input.subscriptionKind ?? null,
			source: input.source,
			actor: input.actor ?? null,
			audienceSnapshot,
			fromAddress: input.from,
			subject: input.subject,
			status: 'accepted',
			requestedRecipients,
			uniqueRecipients: uniqueRecipients.length,
			idempotencyKey: input.idempotencyKey ?? null,
			createdAt: timestamp,
		}),
		...campaignRows.map((campaign) =>
			db.insert(campaigns).values({
				id: campaign.campaignId,
				distributionId,
				status: 'accepted',
				chunkCount: campaign.chunks.length,
				requestedRecipients: campaign.recipients.length,
				uniqueRecipients: campaign.recipients.length,
				createdAt: timestamp,
			}),
		),
		...campaignRows.flatMap((campaign) => {
			const recipientRows = campaign.recipients.map((recipient) => ({
				id: createRecipientId(),
				distributionId,
				campaignId: campaign.campaignId,
				email: recipient.email,
				emailNormalized: recipient.email.trim().toLowerCase(),
				status: 'pending' as const,
				unsubscribeToken: recipient.unsubscribeToken,
				createdAt: timestamp,
				updatedAt: timestamp,
			}))

			return chunkItems(recipientRows, RECIPIENTS_PER_INSERT).map(
				(recipientChunk) => db.insert(recipients).values(recipientChunk),
			)
		}),
	] as MailBatchStatement[]

	try {
		await runBatches(db, statements)
	} catch (error) {
		const [partial] = await db
			.select({ id: distributions.id })
			.from(distributions)
			.where(eq(distributions.id, distributionId))
			.limit(1)
		if (partial) {
			await db.delete(distributions).where(eq(distributions.id, distributionId))
			throw error
		}

		if (input.idempotencyKey) {
			const [existing] = await db
				.select()
				.from(distributions)
				.where(eq(distributions.idempotencyKey, input.idempotencyKey))
				.limit(1)
			if (existing) {
				if (!existing.acceptanceCompletedAt) {
					throw new DistributionAcceptanceIncompleteError(existing.id)
				}

				const existingCampaigns = await db
					.select({ id: campaigns.id })
					.from(campaigns)
					.where(eq(campaigns.distributionId, existing.id))
				return {
					distributionId: existing.id,
					campaignIds: existingCampaigns.map((row) => row.id),
					uniqueRecipients: existing.uniqueRecipients,
					requestedRecipients: existing.requestedRecipients,
					status: existing.status,
				}
			}
		}
		throw error
	}

	try {
		await saveDistributionManifest(bindings.MAIL_LOGS_BUCKET, {
			environment: bindings.ENVIRONMENT,
			distributionId,
			createdAt: timestamp,
			from: input.from,
			subject: input.subject,
			body: input.body,
			kind: input.kind,
			source: input.source,
			actor: input.actor,
			subscriptionKind: input.subscriptionKind,
			audienceSnapshot: input.audienceSnapshot,
		})

		if (!input.enqueue) {
			await db
				.update(distributions)
				.set({ acceptanceCompletedAt: new Date().toISOString() })
				.where(eq(distributions.id, distributionId))

			return {
				distributionId,
				campaignIds: campaignRows.map((campaign) => campaign.campaignId),
				uniqueRecipients: uniqueRecipients.length,
				requestedRecipients,
				status: 'accepted',
			}
		}

		for (const campaign of campaignRows) {
			await saveCampaignManifest(bindings.MAIL_LOGS_BUCKET, {
				environment: bindings.ENVIRONMENT,
				campaignId: campaign.campaignId,
				distributionId,
				createdAt: timestamp,
				from: input.from,
				subject: input.subject,
				body: input.body,
				recipients: campaign.recipients.map((recipient) => recipient.email),
				requestedRecipients: campaign.recipients.length,
				uniqueRecipients: campaign.recipients.length,
				chunkCount: campaign.chunks.length,
			})
			await saveCampaignStatus(bindings.MAIL_LOGS_BUCKET, {
				environment: bindings.ENVIRONMENT,
				campaignId: campaign.campaignId,
				status: 'accepted',
				requestedRecipients: campaign.recipients.length,
				uniqueRecipients: campaign.recipients.length,
				processedRecipients: 0,
				sentRecipients: 0,
				failedRecipients: 0,
				createdAt: timestamp,
			})
			for (const [chunkIndex] of campaign.chunks.entries()) {
				await saveCampaignChunkProgress(bindings.MAIL_LOGS_BUCKET, {
					environment: bindings.ENVIRONMENT,
					campaignId: campaign.campaignId,
					chunkIndex,
					nextRecipientOffset: 0,
					currentRecipientAttempts: 0,
				})
			}
		}

		const queueMessages: MailQueueMessage[] = campaignRows.flatMap((campaign) =>
			campaign.chunks.map((chunk, chunkIndex) => ({
				campaignId: campaign.campaignId,
				chunkIndex,
				recipients: chunk.map((recipient) => ({
					email: recipient.email,
					unsubscribeToken: recipient.unsubscribeToken,
				})),
				distributionId,
			})),
		)

		for (
			let index = 0;
			index < queueMessages.length;
			index += D1_MAX_BATCH_STATEMENTS
		) {
			const batch = queueMessages.slice(index, index + D1_MAX_BATCH_STATEMENTS)
			await bindings.MAIL_SEND_QUEUE.sendBatch(
				batch.map((message) => ({
					body: message,
					contentType: 'json' as const,
				})),
			)
		}

		await db
			.update(distributions)
			.set({ acceptanceCompletedAt: new Date().toISOString() })
			.where(eq(distributions.id, distributionId))

		try {
			await saveCampaignAcceptedLog(bindings.MAIL_LOGS_BUCKET, {
				environment: bindings.ENVIRONMENT,
				campaignId: campaignRows[0]?.campaignId ?? distributionId,
				timestamp,
				from: input.from,
				subject: input.subject,
				requestedRecipients,
				uniqueRecipients: uniqueRecipients.length,
				queuedRecipients: uniqueRecipients.length,
			})
		} catch (logError) {
			console.error('Failed to save success log to R2:', logError)
		}

		return {
			distributionId,
			campaignIds: campaignRows.map((campaign) => campaign.campaignId),
			uniqueRecipients: uniqueRecipients.length,
			requestedRecipients,
			status: 'accepted',
		}
	} catch (error) {
		try {
			await db
				.update(distributions)
				.set({
					status: 'failed',
					completedAt: new Date().toISOString(),
				})
				.where(eq(distributions.id, distributionId))
			for (const campaign of campaignRows) {
				await updateCampaignStatus(
					bindings.MAIL_LOGS_BUCKET,
					bindings.ENVIRONMENT,
					campaign.campaignId,
					(current) => ({
						...current,
						status: 'failed',
						completedAt: new Date().toISOString(),
					}),
				)
			}
		} catch (statusError) {
			console.error('Failed to update campaign status to failed:', statusError)
		}

		try {
			await saveMailLogToR2(bindings.MAIL_LOGS_BUCKET, {
				environment: bindings.ENVIRONMENT,
				timestamp,
				from: input.from,
				to: uniqueRecipients.map((recipient) => recipient.email),
				subject: input.subject,
				status: 'error',
				messageId: campaignRows[0]?.campaignId ?? distributionId,
				error: error instanceof Error ? error.message : String(error),
			})
		} catch (logError) {
			console.error('Failed to save error log to R2:', logError)
		}

		throw error
	}
}
