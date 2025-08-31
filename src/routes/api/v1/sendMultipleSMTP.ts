import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { env } from 'hono/adapter'

import { DEFAULT_SMTP_PORT } from '../../../constants/smtp'
import {
	SendApi400ErrorSchemaV1,
	SendApi500ErrorSchemaV1,
} from '../../../libs/api/v1/schema/send'
import {
	SendMultipleSMTPApiRequestSchemaV1,
	SendMultipleSMTPApiResponseSchemaV1,
} from '../../../libs/api/v1/schema/sendMultipleSMTP'
import { generateMessageId, saveMailLogToR2 } from '../../../libs/mail/r2Logger'
import { sendEmailWithSMTP } from '../../../libs/mail/smtp'
import type { Bindings } from '../../../types/Bindings'

const sendMultipleSMTPApiV1 = new OpenAPIHono<{ Bindings: Bindings }>()

const route = createRoute({
	method: 'post',
	path: '',
	security: [{ Bearer: [] }],
	request: {
		body: {
			content: {
				'application/json': {
					schema: SendMultipleSMTPApiRequestSchemaV1,
				},
			},
			description: 'Email data to send via SMTP',
			required: true,
		},
	},
	responses: {
		200: {
			content: {
				'application/json': {
					schema: SendMultipleSMTPApiResponseSchemaV1,
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
			description: 'Bad request or missing SMTP configuration',
		},
		500: {
			content: {
				'application/json': {
					schema: SendApi500ErrorSchemaV1,
				},
			},
			description: 'Internal server error or SMTP error',
		},
	},
})

sendMultipleSMTPApiV1.openapi(
	route,
	async (c) => {
		const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_LOGS_BUCKET } =
			env(c)
		const messageId = generateMessageId()
		const timestamp = new Date().toISOString()

		const data = c.req.valid('json')

		// Use environment variables for SMTP configuration
		if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
			return c.json(
				{
					message:
						'SMTP configuration is required. Please configure SMTP_HOST, SMTP_USER, and SMTP_PASS environment variables.',
				},
				400,
			)
		}

		const port = SMTP_PORT ? Number.parseInt(SMTP_PORT, 10) : DEFAULT_SMTP_PORT
		const smtpConfig = {
			host: SMTP_HOST,
			port,
			user: SMTP_USER,
			pass: SMTP_PASS,
			secure: port === 465, // SSL for port 465, STARTTLS for others
		}

		try {
			await sendEmailWithSMTP(
				{
					fromAddress: data.from,
					toAddresses: data.to,
					subject: data.subject,
					body: data.body,
				},
				smtpConfig,
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

export { sendMultipleSMTPApiV1 }
