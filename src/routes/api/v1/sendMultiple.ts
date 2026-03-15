import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { env } from 'hono/adapter'

import {
	SendApi400ErrorSchemaV1,
	SendApi500ErrorSchemaV1,
} from '../../../libs/api/v1/schema/send'
import {
	SendMultipleApiRequestSchemaV1,
	SendMultipleApiResponseSchemaV1,
} from '../../../libs/api/v1/schema/sendMultiple'
import {
	generateMessageId,
	saveCampaignAcceptedLog,
	saveMailLogToR2,
} from '../../../libs/mail/r2Logger'
import type { Bindings } from '../../../types/Bindings'
import type { MailQueueMessage } from '../../../types/MailQueueMessage'

const sendMultipleApiV1 = new OpenAPIHono<{ Bindings: Bindings }>()
const ENQUEUE_BATCH_SIZE = 100

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

const chunkBy = <T>(items: T[], size: number) => {
	const chunks: T[][] = []
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size))
	}
	return chunks
}

const route = createRoute({
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
		200: {
			content: {
				'application/json': {
					schema: SendMultipleApiResponseSchemaV1,
				},
			},
			description: 'Returns OK response if email is sent successfully',
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

sendMultipleApiV1.openapi(
	route,
	async (c) => {
		const { ENVIRONMENT, MAIL_SEND_QUEUE, MAIL_LOGS_BUCKET } = env(c)
		const campaignId = generateMessageId()

		const data = c.req.valid('json')
		const timestamp = new Date().toISOString()
		const dedupedRecipients = dedupeRecipients(data.to)
		const queueMessages: MailQueueMessage[] = dedupedRecipients.map(
			(recipient) => ({
				campaignId,
				timestamp,
				from: data.from,
				to: recipient,
				subject: data.subject,
				body: data.body,
			}),
		)
		let queuedRecipients = 0

		try {
			for (const chunk of chunkBy(queueMessages, ENQUEUE_BATCH_SIZE)) {
				await MAIL_SEND_QUEUE.sendBatch(
					chunk.map((message) => ({
						body: message,
						contentType: 'json',
					})),
				)
				queuedRecipients += chunk.length
			}

			try {
				await saveCampaignAcceptedLog(MAIL_LOGS_BUCKET, {
					environment: ENVIRONMENT,
					campaignId,
					timestamp,
					from: data.from,
					subject: data.subject,
					requestedRecipients: data.to.length,
					uniqueRecipients: dedupedRecipients.length,
					queuedRecipients,
				})
			} catch (logError) {
				console.error('Failed to save success log to R2:', logError)
			}

			return c.json(
				{
					status: 'ok',
				},
				200,
			)
		} catch (error) {
			try {
				await saveMailLogToR2(MAIL_LOGS_BUCKET, {
					environment: ENVIRONMENT,
					timestamp,
					from: data.from,
					to: dedupedRecipients,
					subject: data.subject,
					status: 'error',
					messageId: campaignId,
					error:
						`Failed to enqueue campaign. queuedRecipients: ${queuedRecipients}\n` +
						(error instanceof Error ? error.message : String(error)),
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

export { sendMultipleApiV1 }
