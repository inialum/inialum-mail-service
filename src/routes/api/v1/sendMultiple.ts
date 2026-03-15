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
const MAX_QUEUE_BATCH_MESSAGES = 100
const MAX_QUEUE_BATCH_BYTES = 256_000
const MAX_QUEUE_MESSAGE_BYTES = 128_000
const APPROX_QUEUE_METADATA_BYTES = 100
const textEncoder = new TextEncoder()

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

const estimateQueueMessageBytes = (message: MailQueueMessage) =>
	textEncoder.encode(JSON.stringify(message)).byteLength +
	APPROX_QUEUE_METADATA_BYTES

const buildQueueValidationIssues = (messages: MailQueueMessage[]) => {
	const issues: Array<{
		code: string
		message: string
		path: string[]
	}> = []

	if (messages.length > MAX_QUEUE_BATCH_MESSAGES) {
		issues.push({
			code: 'custom',
			message:
				'This request cannot be enqueued safely. Reduce unique recipients to 100 or fewer.',
			path: ['to'],
		})
	}

	let batchBytes = 0
	let oversizeRecipient: string | undefined
	for (const message of messages) {
		const messageBytes = estimateQueueMessageBytes(message)
		if (
			oversizeRecipient === undefined &&
			messageBytes > MAX_QUEUE_MESSAGE_BYTES
		) {
			oversizeRecipient = message.to
		}
		batchBytes += messageBytes
	}

	if (oversizeRecipient) {
		issues.push({
			code: 'custom',
			message: `Email payload is too large for Cloudflare Queues for recipient ${oversizeRecipient}. Reduce the subject or body size.`,
			path: ['body'],
		})
	}

	if (batchBytes > MAX_QUEUE_BATCH_BYTES) {
		issues.push({
			code: 'custom',
			message:
				'This request is too large to enqueue safely in a single batch. Reduce recipients or body size.',
			path: ['to'],
		})
	}

	return issues
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
		const queueValidationIssues = buildQueueValidationIssues(queueMessages)
		if (queueValidationIssues.length > 0) {
			return c.json(
				{
					message: 'Validation error',
					issues: queueValidationIssues,
				},
				400,
			)
		}

		try {
			await MAIL_SEND_QUEUE.sendBatch(
				queueMessages.map((message) => ({
					body: message,
					contentType: 'json',
				})),
			)
			const queuedRecipients = queueMessages.length

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

export { sendMultipleApiV1 }
