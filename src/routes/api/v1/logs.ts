import { OpenAPIHono, createRoute } from '@hono/zod-openapi'

import {
	LogsApi400ErrorSchemaV1,
	LogsApi500ErrorSchemaV1,
	LogsApiResponseSchemaV1,
	LogsQuerySchema,
	StatsApiResponseSchemaV1,
} from '@/libs/api/v1/schema/logs'
import { createDbClient } from '@/libs/db/client'
import { getEmailLogs, getEmailStats } from '@/libs/db/emailLogQueries'
import type { Bindings } from '@/types/Bindings'

export const logsApiV1 = new OpenAPIHono<{ Bindings: Bindings }>()

const logsRoute = createRoute({
	method: 'get',
	path: '',
	summary: 'Get email logs',
	description: 'Retrieve email sending logs with optional filtering',
	security: [{ apiKey: [] }],
	request: {
		query: LogsQuerySchema,
	},
	responses: {
		200: {
			content: {
				'application/json': {
					schema: LogsApiResponseSchemaV1,
				},
			},
			description: 'List of email logs',
		},
		400: {
			content: {
				'application/json': {
					schema: LogsApi400ErrorSchemaV1,
				},
			},
			description: 'Bad request',
		},
		500: {
			content: {
				'application/json': {
					schema: LogsApi500ErrorSchemaV1,
				},
			},
			description: 'Internal server error',
		},
	},
})

const statsRoute = createRoute({
	method: 'get',
	path: '/stats',
	summary: 'Get email statistics',
	description: 'Retrieve statistics about email sending',
	security: [{ apiKey: [] }],
	responses: {
		200: {
			description: 'Email statistics',
			content: {
				'application/json': {
					schema: StatsApiResponseSchemaV1,
				},
			},
		},
		400: {
			content: {
				'application/json': {
					schema: LogsApi400ErrorSchemaV1,
				},
			},
			description: 'Bad request',
		},
		500: {
			description: 'Internal server error',
			content: {
				'application/json': {
					schema: LogsApi500ErrorSchemaV1,
				},
			},
		},
	},
})

// Register routes with OpenAPI
logsApiV1.openapi(
	logsRoute,
	async (c) => {
		try {
			const { status, provider, limit, offset } = c.req.valid('query')
			const db = createDbClient(c.env.DB)

			const logs = await getEmailLogs(db, {
				status,
				provider,
				limit,
				offset,
			})

			// Convert createdAt from Date to number for API consistency
			const formattedLogs = logs.map((log) => ({
				...log,
				createdAt:
					log.createdAt instanceof Date
						? log.createdAt.getTime()
						: log.createdAt,
			}))

			return c.json({ logs: formattedLogs }, 200)
		} catch (error) {
			console.error('Error fetching email logs:', error)
			return c.json({ message: 'Failed to fetch email logs' }, 500)
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

logsApiV1.openapi(
	statsRoute,
	async (c) => {
		try {
			const db = createDbClient(c.env.DB)
			const stats = await getEmailStats(db)

			return c.json(stats, 200)
		} catch (error) {
			console.error('Error fetching email stats:', error)
			return c.json({ message: 'Failed to fetch email statistics' }, 500)
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
