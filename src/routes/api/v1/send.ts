import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { EnvironmentType } from '@inialum/error-notification-service-hono-middleware'
import { env } from 'hono/adapter'

import { LOCAL_SES_API_ENDPOINT } from '../../../constants/mail'
import {
	SendApi400ErrorSchemaV1,
	SendApi500ErrorSchemaV1,
	SendApiRequestSchemaV1,
	SendApiResponseSchemaV1,
} from '../../../libs/api/v1/schema/send'
import { sendEmailWithSES } from '../../../libs/mail/ses'

const sendApiV1 = new OpenAPIHono()

const route = createRoute({
	method: 'post',
	path: '',
	security: [{ Bearer: [] }],
	request: {
		body: {
			content: {
				'application/json': {
					schema: SendApiRequestSchemaV1,
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
					schema: SendApiResponseSchemaV1,
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

sendApiV1.openapi(
	route,
	async (c) => {
		const { AWS_ACCESS_KEY_ID } = env<{ AWS_ACCESS_KEY_ID: string }>(c)
		const { AWS_SECRET_ACCESS_KEY } = env<{ AWS_SECRET_ACCESS_KEY: string }>(c)
		const { ENVIRONMENT } = env<{ ENVIRONMENT: EnvironmentType }>(c)

		const data = c.req.valid('json')

		await sendEmailWithSES(
			{
				fromAddress: data.from,
				toAddresses: [data.to],
				subject: data.subject,
				body: data.body,
			},
			{
				accessKeyId: AWS_ACCESS_KEY_ID,
				secretAccessKey: AWS_SECRET_ACCESS_KEY,
			},
			ENVIRONMENT === 'production' || ENVIRONMENT === 'staging'
				? undefined
				: LOCAL_SES_API_ENDPOINT,
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

export { sendApiV1 }
