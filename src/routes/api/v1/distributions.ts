import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { env } from 'hono/adapter'
import type { IdempotencyEnv } from 'hono-idempotency'

import type { DistributionStatus, RecipientStatus } from '../../../db/values'
import {
	CreateDistributionApiRequestSchemaV1,
	CreateDistributionApiResponseSchemaV1,
	DistributionApi404ErrorSchemaV1,
	DistributionStatusSchemaV1,
	GetDistributionApiResponseSchemaV1,
	ListDistributionRecipientsApiResponseSchemaV1,
	ListDistributionsApiResponseSchemaV1,
	RecipientStatusSchemaV1,
} from '../../../libs/api/v1/schema/distributions'
import {
	SendApi400ErrorSchemaV1,
	SendApi409ErrorSchemaV1,
	SendApi422ErrorSchemaV1,
	SendApi500ErrorSchemaV1,
} from '../../../libs/api/v1/schema/send'
import { acceptDistribution } from '../../../libs/distribution/accept'
import {
	getDistribution,
	listDistributionRecipients,
	listDistributions,
} from '../../../libs/distribution/history'
import { createDistributionIdempotencyMiddleware } from '../../../libs/idempotency/middleware'
import {
	createMailIdempotencyStore,
	type MailIdempotencyStore,
} from '../../../libs/idempotency/store'
import type { Bindings } from '../../../types/Bindings'

type DistributionEnv = IdempotencyEnv & {
	Bindings: Bindings
	Variables: IdempotencyEnv['Variables'] & {
		idempotencyStore?: MailIdempotencyStore
	}
}

const distributionsApiV1 = new OpenAPIHono<DistributionEnv>()

distributionsApiV1.use('/', async (c, next) => {
	if (c.req.method !== 'POST') {
		return next()
	}

	const { DB } = env(c)
	const store = createMailIdempotencyStore(DB)
	c.set('idempotencyStore', store)
	const middleware = createDistributionIdempotencyMiddleware(store)
	return middleware(c as Context<IdempotencyEnv>, next)
})

const toSummary = (row: {
	id: string
	kind: 'transactional' | 'marketing'
	subscriptionKind: 'inialum' | 'university' | null
	source: string
	actor: string | null
	fromAddress: string
	subject: string
	status: DistributionStatus
	requestedRecipients: number
	uniqueRecipients: number
	processedRecipients: number
	sentRecipients: number
	failedRecipients: number
	createdAt: string
	startedAt: string | null
	completedAt: string | null
}) => ({
	id: row.id,
	kind: row.kind,
	subscriptionKind: row.subscriptionKind,
	source: row.source,
	actor: row.actor,
	from: row.fromAddress,
	subject: row.subject,
	status: row.status,
	requestedRecipients: row.requestedRecipients,
	uniqueRecipients: row.uniqueRecipients,
	processedRecipients: row.processedRecipients,
	sentRecipients: row.sentRecipients,
	failedRecipients: row.failedRecipients,
	createdAt: row.createdAt,
	startedAt: row.startedAt ?? undefined,
	completedAt: row.completedAt ?? undefined,
})

const postRoute = createRoute({
	method: 'post',
	path: '',
	security: [{ Bearer: [] }],
	request: {
		headers: z.object({
			'idempotency-key': z
				.string()
				.min(1)
				.max(255)
				.openapi({
					param: {
						name: 'idempotency-key',
						in: 'header',
						required: true,
					},
					example: 'distribution:dst_01HZYEXAMPLE',
				}),
		}),
		body: {
			content: {
				'application/json': {
					schema: CreateDistributionApiRequestSchemaV1,
				},
			},
			required: true,
		},
	},
	responses: {
		202: {
			content: {
				'application/json': {
					schema: CreateDistributionApiResponseSchemaV1,
				},
			},
			description: 'Distribution accepted',
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
			description: 'Idempotency-Key is already in progress',
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
			description: 'Internal server error',
		},
	},
})

const listRoute = createRoute({
	method: 'get',
	path: '',
	security: [{ Bearer: [] }],
	request: {
		query: z.object({
			cursor: z.string().optional(),
			limit: z.coerce.number().int().optional(),
			status: DistributionStatusSchemaV1.optional(),
			source: z.string().optional(),
			from: z.string().optional(),
			to: z.string().optional(),
			q: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				'application/json': {
					schema: ListDistributionsApiResponseSchemaV1,
				},
			},
			description: 'Distribution list',
		},
	},
})

const getRoute = createRoute({
	method: 'get',
	path: '/{id}',
	security: [{ Bearer: [] }],
	request: {
		params: z.object({
			id: z.string().openapi({ example: 'dst_01HZYEXAMPLE00000000000000' }),
		}),
	},
	responses: {
		200: {
			content: {
				'application/json': {
					schema: GetDistributionApiResponseSchemaV1,
				},
			},
			description: 'Distribution detail',
		},
		404: {
			content: {
				'application/json': {
					schema: DistributionApi404ErrorSchemaV1,
				},
			},
			description: 'Distribution not found',
		},
	},
})

const listRecipientsRoute = createRoute({
	method: 'get',
	path: '/{id}/recipients',
	security: [{ Bearer: [] }],
	request: {
		params: z.object({
			id: z.string(),
		}),
		query: z.object({
			cursor: z.string().optional(),
			limit: z.coerce.number().int().optional(),
			status: RecipientStatusSchemaV1.optional(),
		}),
	},
	responses: {
		200: {
			content: {
				'application/json': {
					schema: ListDistributionRecipientsApiResponseSchemaV1,
				},
			},
			description: 'Distribution recipients',
		},
		404: {
			content: {
				'application/json': {
					schema: DistributionApi404ErrorSchemaV1,
				},
			},
			description: 'Distribution not found',
		},
	},
})

const validationHook = (
	result: { success: boolean; error?: { issues: unknown } },
	c: Context,
) => {
	if (!result.success) {
		return c.json(
			{
				message: 'Validation error',
				issues: result.error?.issues,
			},
			400,
		)
	}
}

distributionsApiV1.openapi(
	postRoute,
	async (c) => {
		const data = c.req.valid('json')
		const idempotencyKey = c.req.header('Idempotency-Key')
		const accepted = await acceptDistribution(env(c), {
			kind: data.kind,
			subscriptionKind: data.subscriptionKind,
			source: data.source,
			actor: data.actor,
			audienceSnapshot: data.audienceSnapshot,
			from: data.from,
			subject: data.subject,
			body: data.body,
			recipients: data.recipients,
			idempotencyKey,
			enqueue: true,
		})

		return c.json(
			{
				status: 'accepted' as const,
				distributionId: accepted.distributionId,
			},
			202,
		)
	},
	validationHook,
)

distributionsApiV1.openapi(listRoute, async (c) => {
	const query = c.req.valid('query')
	const { DB } = env(c)
	const result = await listDistributions(DB, {
		cursor: query.cursor,
		limit: query.limit,
		status: query.status,
		source: query.source,
		from: query.from,
		to: query.to,
		q: query.q,
	})

	return c.json(
		{
			items: result.items.map(toSummary),
			nextCursor: result.nextCursor,
		},
		200,
	)
})

distributionsApiV1.openapi(getRoute, async (c) => {
	const { id } = c.req.valid('param')
	const { DB, MAIL_LOGS_BUCKET, ENVIRONMENT } = env(c)
	const detail = await getDistribution(DB, MAIL_LOGS_BUCKET, ENVIRONMENT, id)

	if (!detail) {
		return c.json({ message: 'Distribution not found' }, 404)
	}

	return c.json(
		{
			...toSummary(detail.distribution),
			body: detail.body,
			audienceSnapshot: detail.audienceSnapshot,
			campaigns: detail.campaigns.map((campaign) => ({
				id: campaign.id,
				status: campaign.status,
				chunkCount: campaign.chunkCount,
				requestedRecipients: campaign.requestedRecipients,
				uniqueRecipients: campaign.uniqueRecipients,
				processedRecipients: campaign.processedRecipients,
				sentRecipients: campaign.sentRecipients,
				failedRecipients: campaign.failedRecipients,
				createdAt: campaign.createdAt,
				startedAt: campaign.startedAt ?? undefined,
				completedAt: campaign.completedAt ?? undefined,
			})),
		},
		200,
	)
})

distributionsApiV1.openapi(listRecipientsRoute, async (c) => {
	const { id } = c.req.valid('param')
	const query = c.req.valid('query')
	const { DB, MAIL_LOGS_BUCKET, ENVIRONMENT } = env(c)
	const detail = await getDistribution(DB, MAIL_LOGS_BUCKET, ENVIRONMENT, id)

	if (!detail) {
		return c.json({ message: 'Distribution not found' }, 404)
	}

	const result = await listDistributionRecipients(DB, id, {
		cursor: query.cursor,
		limit: query.limit,
		status: query.status as RecipientStatus | undefined,
	})

	return c.json(
		{
			items: result.items.map((row) => ({
				id: row.id,
				email: row.email,
				status: row.status,
				attemptCount: row.attemptCount,
				providerMessageId: row.providerMessageId,
				lastError: row.lastError,
				duplicatePossible: row.duplicatePossible,
				createdAt: row.createdAt,
				updatedAt: row.updatedAt,
			})),
			nextCursor: result.nextCursor,
		},
		200,
	)
})

export { distributionsApiV1 }
