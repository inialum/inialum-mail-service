import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { env } from 'hono/adapter'

import {
	SendApi400ErrorSchemaV1,
	SendApi500ErrorSchemaV1,
} from '../../../libs/api/v1/schema/send'
import {
	SendMultipleAcceptedApiResponseSchemaV1,
	SendMultipleApiRequestSchemaV1,
	SendMultipleStatusApi404ErrorSchemaV1,
	SendMultipleStatusApiResponseSchemaV1,
} from '../../../libs/api/v1/schema/sendMultiple'
import {
	getCampaignStatus,
	saveCampaignChunkProgress,
	saveCampaignManifest,
	saveCampaignStatus,
	updateCampaignStatus,
} from '../../../libs/mail/campaignStore'
import {
	generateMessageId,
	saveCampaignAcceptedLog,
	saveMailLogToR2,
} from '../../../libs/mail/r2Logger'
import type { Bindings } from '../../../types/Bindings'
import type {
	MailCampaignChunkProgress,
	MailCampaignManifest,
	MailCampaignStatus,
} from '../../../types/MailCampaign'
import type { MailQueueMessage } from '../../../types/MailQueueMessage'

const sendMultipleApiV1 = new OpenAPIHono<{ Bindings: Bindings }>()
const RECIPIENTS_PER_CHUNK = 100

const dedupeRecipients = (recipients: string[]) => {
	const seen = new Set<string>()
	const deduped: string[] = []

	for (const recipient of recipients) {
		const normalized = recipient.trim()
		const key = normalized.toLowerCase()

		if (seen.has(key)) {
			continue
		}

		seen.add(key)
		deduped.push(normalized)
	}

	return deduped
}

const chunkRecipients = (recipients: string[], size: number) => {
	const chunks: string[][] = []

	for (let index = 0; index < recipients.length; index += size) {
		chunks.push(recipients.slice(index, index + size))
	}

	return chunks
}

const createInitialCampaignStatus = (
	manifest: MailCampaignManifest,
): MailCampaignStatus => ({
	environment: manifest.environment,
	campaignId: manifest.campaignId,
	status: 'accepted',
	requestedRecipients: manifest.requestedRecipients,
	uniqueRecipients: manifest.uniqueRecipients,
	processedRecipients: 0,
	sentRecipients: 0,
	failedRecipients: 0,
	createdAt: manifest.createdAt,
})

const createInitialChunkProgress = (
	environment: string,
	campaignId: string,
	chunkIndex: number,
): MailCampaignChunkProgress => ({
	environment,
	campaignId,
	chunkIndex,
	nextRecipientOffset: 0,
	currentRecipientAttempts: 0,
})

const postRoute = createRoute({
	method: 'post',
	path: '',
	security: [{ Bearer: [] }],
	request: {
		body: {
			content: {
				'application/json': {
					schema: SendMultipleApiRequestSchemaV1,
				},
			},
			description: 'Email data to send',
			required: true,
		},
	},
	responses: {
		202: {
			content: {
				'application/json': {
					schema: SendMultipleAcceptedApiResponseSchemaV1,
				},
			},
			description: 'Campaign accepted and queued for processing',
		},
		400: {
			content: {
				'application/json': {
					schema: SendApi400ErrorSchemaV1,
				},
			},
			description: 'Bad request',
		},
		500: {
			content: {
				'application/json': {
					schema: SendApi500ErrorSchemaV1,
				},
			},
			description: 'Internal server error or external API error',
		},
	},
})

const getRoute = createRoute({
	method: 'get',
	path: '/{campaignId}',
	security: [{ Bearer: [] }],
	request: {
		params: z.object({
			campaignId: z.string().openapi({
				example: 'e7f4ad2b-8e0d-4e7a-a8fc-0ff6c5177310',
			}),
		}),
	},
	responses: {
		200: {
			content: {
				'application/json': {
					schema: SendMultipleStatusApiResponseSchemaV1,
				},
			},
			description: 'Campaign status',
		},
		404: {
			content: {
				'application/json': {
					schema: SendMultipleStatusApi404ErrorSchemaV1,
				},
			},
			description: 'Campaign not found',
		},
	},
})

sendMultipleApiV1.openapi(
	postRoute,
	async (c) => {
		const { ENVIRONMENT, MAIL_SEND_QUEUE, MAIL_LOGS_BUCKET } = env(c)
		const campaignId = generateMessageId()
		const data = c.req.valid('json')
		const timestamp = new Date().toISOString()
		const dedupedRecipients = dedupeRecipients(data.to)
		const recipientChunks = chunkRecipients(
			dedupedRecipients,
			RECIPIENTS_PER_CHUNK,
		)

		const manifest: MailCampaignManifest = {
			environment: ENVIRONMENT,
			campaignId,
			createdAt: timestamp,
			from: data.from,
			subject: data.subject,
			body: data.body,
			recipients: dedupedRecipients,
			requestedRecipients: data.to.length,
			uniqueRecipients: dedupedRecipients.length,
			chunkCount: recipientChunks.length,
		}

		try {
			await saveCampaignManifest(MAIL_LOGS_BUCKET, manifest)
			await saveCampaignStatus(
				MAIL_LOGS_BUCKET,
				createInitialCampaignStatus(manifest),
			)

			for (const [chunkIndex] of recipientChunks.entries()) {
				await saveCampaignChunkProgress(
					MAIL_LOGS_BUCKET,
					createInitialChunkProgress(ENVIRONMENT, campaignId, chunkIndex),
				)
			}

			const queueMessages: MailQueueMessage[] = recipientChunks.map(
				(recipients, chunkIndex) => ({
					campaignId,
					chunkIndex,
					recipients,
				}),
			)

			await MAIL_SEND_QUEUE.sendBatch(
				queueMessages.map((message) => ({
					body: message,
					contentType: 'json',
				})),
			)

			try {
				await saveCampaignAcceptedLog(MAIL_LOGS_BUCKET, {
					environment: ENVIRONMENT,
					campaignId,
					timestamp,
					from: data.from,
					subject: data.subject,
					requestedRecipients: data.to.length,
					uniqueRecipients: dedupedRecipients.length,
					queuedRecipients: dedupedRecipients.length,
				})
			} catch (logError) {
				console.error('Failed to save success log to R2:', logError)
			}

			return c.json(
				{
					status: 'accepted' as const,
					campaignId,
				},
				202,
			)
		} catch (error) {
			try {
				await updateCampaignStatus(
					MAIL_LOGS_BUCKET,
					ENVIRONMENT,
					campaignId,
					(current) => ({
						...current,
						status: 'failed',
						completedAt: new Date().toISOString(),
					}),
				)
			} catch (statusError) {
				console.error(
					'Failed to update campaign status to failed:',
					statusError,
				)
			}

			try {
				await saveMailLogToR2(MAIL_LOGS_BUCKET, {
					environment: ENVIRONMENT,
					timestamp,
					from: data.from,
					to: dedupedRecipients,
					subject: data.subject,
					status: 'error',
					messageId: campaignId,
					error: error instanceof Error ? error.message : String(error),
				})
			} catch (logError) {
				console.error('Failed to save error log to R2:', logError)
			}

			throw error
		}
	},
	(result, c) => {
		if (!result.success) {
			return c.json(
				{
					message: 'Validation error',
					issues: result.error.issues,
				},
				400,
			)
		}
	},
)

sendMultipleApiV1.openapi(getRoute, async (c) => {
	const { ENVIRONMENT, MAIL_LOGS_BUCKET } = env(c)
	const { campaignId } = c.req.valid('param')

	const campaignStatus = await getCampaignStatus(
		MAIL_LOGS_BUCKET,
		ENVIRONMENT,
		campaignId,
	)

	if (!campaignStatus) {
		return c.json(
			{
				message: 'Campaign not found',
			},
			404,
		)
	}

	return c.json(
		{
			campaignId: campaignStatus.campaignId,
			status: campaignStatus.status,
			requestedRecipients: campaignStatus.requestedRecipients,
			uniqueRecipients: campaignStatus.uniqueRecipients,
			processedRecipients: campaignStatus.processedRecipients,
			sentRecipients: campaignStatus.sentRecipients,
			failedRecipients: campaignStatus.failedRecipients,
			createdAt: campaignStatus.createdAt,
			startedAt: campaignStatus.startedAt,
			completedAt: campaignStatus.completedAt,
		},
		200,
	)
})

export { sendMultipleApiV1 }
