import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { env } from 'hono/adapter'
import type { IdempotencyEnv } from 'hono-idempotency'

import { IDEMPOTENCY_SES_TIMEOUT_MS } from '../../../constants/idempotency'
import { LOCAL_SES_API_ENDPOINT } from '../../../constants/mail'
import {
	SendApi400ErrorSchemaV1,
	SendApi409ErrorSchemaV1,
	SendApi422ErrorSchemaV1,
	SendApi500ErrorSchemaV1,
	SendApiRequestSchemaV1,
	type SendApiRequestV1,
	SendApiResponseSchemaV1,
} from '../../../libs/api/v1/schema/send'
import { createSendIdempotencyMiddleware } from '../../../libs/idempotency/middleware'
import {
	createMailIdempotencyStore,
	type MailIdempotencyStore,
} from '../../../libs/idempotency/store'
import { sendEmailWithSES } from '../../../libs/mail/ses'
import type { Bindings } from '../../../types/Bindings'

type SendEnv = IdempotencyEnv & {
	Bindings: Bindings
	Variables: IdempotencyEnv['Variables'] & {
		idempotencyStore?: MailIdempotencyStore
	}
}

const sendApiV1 = new OpenAPIHono<SendEnv>()

sendApiV1.use('*', async (c, next) => {
	const { DB } = env(c)
	const store = createMailIdempotencyStore(DB)
	c.set('idempotencyStore', store)
	const middleware = createSendIdempotencyMiddleware(store)
	// hono-idempotency fixes its Context env type instead of preserving app bindings.
	return middleware(c as Context<IdempotencyEnv>, next)
})

const route = createRoute({
	method: 'post',
	path: '',
	security: [{ Bearer: [] }],
	request: {
		headers: z.object({
			'Idempotency-Key': z
				.string()
				.min(1)
				.max(255)
				.optional()
				.openapi({
					param: {
						name: 'Idempotency-Key',
						in: 'header',
					},
					example: 'invitation:inv_01HZYEXAMPLE:g1',
				}),
		}),
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
		409: {
			content: {
				'application/json': {
					schema: SendApi409ErrorSchemaV1,
				},
			},
			description: 'An Idempotency-Key request is already in progress',
		},
		422: {
			content: {
				'application/json': {
					schema: SendApi422ErrorSchemaV1,
				},
			},
			description: 'Idempotency-Key was reused with a different payload',
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

class SESRequestTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`SES request timed out after ${timeoutMs}ms`)
		this.name = 'SESRequestTimeoutError'
	}
}

const withTimeout = async <T>(
	operation: (abortSignal: AbortSignal) => Promise<T>,
	timeoutMs: number,
): Promise<T> => {
	const abortController = new AbortController()
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			operation(abortController.signal),
			new Promise<T>((_, reject) => {
				timer = setTimeout(() => {
					reject(new SESRequestTimeoutError(timeoutMs))
					abortController.abort()
				}, timeoutMs)
			}),
		])
	} finally {
		if (timer) {
			clearTimeout(timer)
		}
	}
}

const sendOnce = async (
	data: SendApiRequestV1,
	bindings: Pick<
		Bindings,
		'AWS_ACCESS_KEY_ID' | 'AWS_SECRET_ACCESS_KEY' | 'ENVIRONMENT'
	>,
) => {
	const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, ENVIRONMENT } = bindings

	await withTimeout(
		(abortSignal) =>
			sendEmailWithSES(
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
				{ abortSignal },
			),
		IDEMPOTENCY_SES_TIMEOUT_MS,
	)
}

sendApiV1.openapi(
	route,
	async (c) => {
		const data = c.req.valid('json')
		const bindings = env(c)

		try {
			await sendOnce(data, bindings)
		} catch (error) {
			if (error instanceof SESRequestTimeoutError) {
				c.var.idempotencyStore?.completeOnNextDelete({
					status: 500,
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ message: error.message }),
				})
			}
			throw error
		}
		return c.json({ status: 'ok' }, 200)
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
