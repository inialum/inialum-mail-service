import { z } from '@hono/zod-openapi'

import { MailBodyContentSchema } from './send'

/**
 * Schema for request of POST /send-multiple
 */
export const SendMultipleApiRequestSchemaV1 = z
	.object({
		from: z.string().email('Invalid email address').openapi({
			example: 'noreply@mail.inialum.org',
		}),
		to: z
			.string()
			.email('Invalid email address')
			.array()
			.min(1, 'At least one recipient is required')
			.max(400, 'Maximum 400 recipients are allowed')
			.openapi({
				example: ['to@example.com'],
			}),
		subject: z
			.string({
				required_error: 'This field is required',
			})
			.openapi({
				example: 'This is a subject',
			}),
		body: MailBodyContentSchema,
	})
	.openapi('Request')

export type SendMultipleApiRequestV1 = z.infer<
	typeof SendMultipleApiRequestSchemaV1
>

/**
 * Schema for accepted response of POST /send-multiple
 */
export const SendMultipleAcceptedApiResponseSchemaV1 = z
	.object({
		status: z.literal('accepted').openapi({
			example: 'accepted',
		}),
		campaignId: z.string().openapi({
			example: 'e7f4ad2b-8e0d-4e7a-a8fc-0ff6c5177310',
		}),
	})
	.openapi('AcceptedResponse')

export const MailCampaignStatusSchemaV1 = z
	.enum(['accepted', 'processing', 'completed', 'partial_failed', 'failed'])
	.openapi({
		example: 'processing',
	})

export const SendMultipleStatusApiResponseSchemaV1 = z
	.object({
		campaignId: z.string().openapi({
			example: 'e7f4ad2b-8e0d-4e7a-a8fc-0ff6c5177310',
		}),
		status: MailCampaignStatusSchemaV1,
		requestedRecipients: z.number().int().openapi({
			example: 400,
		}),
		uniqueRecipients: z.number().int().openapi({
			example: 398,
		}),
		processedRecipients: z.number().int().openapi({
			example: 120,
		}),
		sentRecipients: z.number().int().openapi({
			example: 118,
		}),
		failedRecipients: z.number().int().openapi({
			example: 2,
		}),
		createdAt: z.string().datetime().openapi({
			example: '2026-03-16T00:00:00.000Z',
		}),
		startedAt: z.string().datetime().optional().openapi({
			example: '2026-03-16T00:00:05.000Z',
		}),
		completedAt: z.string().datetime().optional().openapi({
			example: '2026-03-16T00:01:30.000Z',
		}),
	})
	.openapi('CampaignStatusResponse')

export const SendMultipleStatusApi404ErrorSchemaV1 = z.object({
	message: z.string().openapi({
		example: 'Campaign not found',
	}),
})
