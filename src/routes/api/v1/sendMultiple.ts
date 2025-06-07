import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { env } from 'hono/adapter'

import {
	SendApi400ErrorSchemaV1,
	SendApi500ErrorSchemaV1,
} from '@/libs/api/v1/schema/send'
import {
	SendMultipleApiRequestSchemaV1,
	SendMultipleApiResponseSchemaV1,
} from '@/libs/api/v1/schema/sendMultiple'
import { sendEmailWithSendGrid } from '@/libs/mail/sendgrid'
import type { Bindings } from '@/types/Bindings'

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
		const { SENDGRID_TOKEN } = env(c)

		const data = c.req.valid('json')

		await sendEmailWithSendGrid(
			{
				fromAddress: data.from,
				toAddresses: data.to,
				subject: data.subject,
				body: data.body,
			},
			SENDGRID_TOKEN,
		)

		return c.json(
			{
				status: 'ok',
			},
			200,
		)
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
