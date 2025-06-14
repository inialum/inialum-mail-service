import { OpenAPIHono, createRoute } from '@hono/zod-openapi'

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
	saveMailLogToR2,
} from '../../../libs/mail/r2Logger'
import { sendEmailWithSendGrid } from '../../../libs/mail/sendgrid'
import type { Bindings } from '../../../types/Bindings'

const sendMultipleApiV1 = new OpenAPIHono<{ Bindings: Bindings }>()

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
		const { SENDGRID_TOKEN, MAIL_LOGS_BUCKET } = env(c)
		const messageId = generateMessageId()
		const timestamp = new Date().toISOString()

		const data = c.req.valid('json')

		try {
			await sendEmailWithSendGrid(
				{
					fromAddress: data.from,
					toAddresses: data.to,
					subject: data.subject,
					body: data.body,
				},
				SENDGRID_TOKEN,
			)

			try {
				await saveMailLogToR2(MAIL_LOGS_BUCKET, {
					timestamp,
					from: data.from,
					to: data.to,
					subject: data.subject,
					status: 'success',
					messageId,
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
					timestamp,
					from: data.from,
					to: data.to,
					subject: data.subject,
					status: 'error',
					messageId,
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
