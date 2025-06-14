import { z } from '@hono/zod-openapi'

/**
 * Schema for email log entry
 */
export const EmailLogSchema = z
	.object({
		id: z.number().openapi({
			example: 1,
		}),
		fromAddress: z.string().email().openapi({
			example: 'noreply@mail.inialum.org',
		}),
		toAddress: z.string().email().openapi({
			example: 'to@example.com',
		}),
		subject: z.string().openapi({
			example: 'This is a subject',
		}),
		status: z.enum(['success', 'failed']).openapi({
			example: 'success',
		}),
		statusCode: z.number().nullable().openapi({
			example: 202,
		}),
		errorMessage: z.string().nullable().openapi({
			example: null,
		}),
		provider: z.enum(['ses', 'sendgrid']).openapi({
			example: 'ses',
		}),
		createdAt: z.number().openapi({
			example: 1704085200000,
		}),
	})
	.openapi('EmailLog')

/**
 * Schema for logs query parameters
 */
export const LogsQuerySchema = z
	.object({
		status: z.enum(['success', 'failed']).optional().openapi({
			example: 'success',
		}),
		provider: z.enum(['ses', 'sendgrid']).optional().openapi({
			example: 'ses',
		}),
		limit: z.string().regex(/^\d+$/).transform(Number).optional().openapi({
			example: '10',
		}),
		offset: z.string().regex(/^\d+$/).transform(Number).optional().openapi({
			example: '0',
		}),
	})
	.openapi('LogsQuery')

/**
 * Schema for response of GET /api/v1/logs
 */
export const LogsApiResponseSchemaV1 = z
	.object({
		logs: z.array(EmailLogSchema),
	})
	.openapi('LogsResponse')

/**
 * Schema for response of GET /api/v1/logs/stats
 */
export const StatsApiResponseSchemaV1 = z
	.object({
		totalCount: z.number(),
		successCount: z.number(),
		failedCount: z.number(),
		sesCount: z.number(),
		sendgridCount: z.number(),
	})
	.openapi('StatsResponse')

/**
 * Schema for 400 error response (validation error)
 */
export const LogsApi400ErrorSchemaV1 = z.object({
	message: z.string().openapi({
		example: 'Validation error',
	}),
	issues: z.any().openapi({
		example: [
			{
				code: 'invalid_enum_value',
				expected: ['success', 'failed'],
				received: 'invalid',
				path: ['status'],
				message: 'Invalid enum value',
			},
		],
	}),
})

/**
 * Schema for 500 error response
 */
export const LogsApi500ErrorSchemaV1 = z.object({
	message: z.string().openapi({
		example: 'Internal server error',
	}),
})
