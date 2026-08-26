import { z } from '@hono/zod-openapi'

import { MAX_DISTRIBUTION_RECIPIENTS } from '../../../../constants/distribution'
import {
	distributionKinds,
	distributionStatuses,
	recipientStatuses,
	subscriptionKinds,
} from '../../../../db/values'
import { MailBodyContentSchema } from './send'

export const DistributionKindSchemaV1 = z
	.enum(distributionKinds)
	.openapi({ example: 'transactional' })

export const SubscriptionKindSchemaV1 = z
	.enum(subscriptionKinds)
	.openapi({ example: 'inialum' })

export const DistributionStatusSchemaV1 = z
	.enum(distributionStatuses)
	.openapi({ example: 'accepted' })

export const RecipientStatusSchemaV1 = z
	.enum(recipientStatuses)
	.openapi({ example: 'pending' })

export const DistributionRecipientInputSchemaV1 = z
	.object({
		email: z.string().email('Invalid email address').openapi({
			example: 'to@example.com',
		}),
		unsubscribeToken: z.string().min(1).optional().openapi({
			example: 'opaque-token',
		}),
	})
	.openapi('DistributionRecipientInput')

export const CreateDistributionApiRequestSchemaV1 = z
	.object({
		kind: DistributionKindSchemaV1,
		subscriptionKind: SubscriptionKindSchemaV1.optional(),
		source: z.string().min(1).openapi({ example: 'admin' }),
		actor: z.string().min(1).optional().openapi({ example: 'user_123' }),
		audienceSnapshot: z.unknown().optional(),
		from: z.string().email('Invalid email address').openapi({
			example: 'noreply@mail.inialum.org',
		}),
		subject: z.string().min(1).openapi({ example: 'This is a subject' }),
		body: MailBodyContentSchema,
		recipients: z
			.array(DistributionRecipientInputSchemaV1)
			.min(1, 'At least one recipient is required')
			.max(
				MAX_DISTRIBUTION_RECIPIENTS,
				`Maximum ${MAX_DISTRIBUTION_RECIPIENTS} recipients are allowed`,
			),
	})
	.refine(
		(value) => value.kind !== 'marketing' || Boolean(value.subscriptionKind),
		{
			message: 'subscriptionKind is required for marketing distributions',
			path: ['subscriptionKind'],
		},
	)
	.refine(
		(value) =>
			value.kind !== 'marketing' ||
			value.recipients.every((recipient) =>
				Boolean(recipient.unsubscribeToken),
			),
		{
			message: 'unsubscribeToken is required for marketing recipients',
			path: ['recipients'],
		},
	)
	.openapi('CreateDistributionRequest')

export type CreateDistributionApiRequestV1 = z.infer<
	typeof CreateDistributionApiRequestSchemaV1
>

export const CreateDistributionApiResponseSchemaV1 = z
	.object({
		status: z.literal('accepted').openapi({ example: 'accepted' }),
		distributionId: z
			.string()
			.openapi({ example: 'dst_01HZYEXAMPLE00000000000000' }),
	})
	.openapi('CreateDistributionResponse')

export const DistributionSummarySchemaV1 = z
	.object({
		id: z.string(),
		kind: DistributionKindSchemaV1,
		subscriptionKind: SubscriptionKindSchemaV1.nullable().optional(),
		source: z.string(),
		actor: z.string().nullable().optional(),
		from: z.string(),
		subject: z.string(),
		status: DistributionStatusSchemaV1,
		requestedRecipients: z.number().int(),
		uniqueRecipients: z.number().int(),
		processedRecipients: z.number().int(),
		sentRecipients: z.number().int(),
		failedRecipients: z.number().int(),
		createdAt: z.string().datetime(),
		startedAt: z.string().datetime().optional(),
		completedAt: z.string().datetime().optional(),
	})
	.openapi('DistributionSummary')

export const ListDistributionsApiResponseSchemaV1 = z
	.object({
		items: z.array(DistributionSummarySchemaV1),
		nextCursor: z.string().optional(),
	})
	.openapi('ListDistributionsResponse')

export const DistributionCampaignSchemaV1 = z
	.object({
		id: z.string(),
		status: DistributionStatusSchemaV1,
		chunkCount: z.number().int(),
		requestedRecipients: z.number().int(),
		uniqueRecipients: z.number().int(),
		processedRecipients: z.number().int(),
		sentRecipients: z.number().int(),
		failedRecipients: z.number().int(),
		createdAt: z.string().datetime(),
		startedAt: z.string().datetime().optional(),
		completedAt: z.string().datetime().optional(),
	})
	.openapi('DistributionCampaign')

export const GetDistributionApiResponseSchemaV1 =
	DistributionSummarySchemaV1.extend({
		body: MailBodyContentSchema.nullable(),
		audienceSnapshot: z.unknown().nullable(),
		campaigns: z.array(DistributionCampaignSchemaV1),
	}).openapi('GetDistributionResponse')

export const DistributionRecipientSchemaV1 = z
	.object({
		id: z.string(),
		email: z.string(),
		status: RecipientStatusSchemaV1,
		attemptCount: z.number().int(),
		providerMessageId: z.string().nullable().optional(),
		lastError: z.string().nullable().optional(),
		duplicatePossible: z.boolean(),
		createdAt: z.string().datetime(),
		updatedAt: z.string().datetime(),
	})
	.openapi('DistributionRecipient')

export const ListDistributionRecipientsApiResponseSchemaV1 = z
	.object({
		items: z.array(DistributionRecipientSchemaV1),
		nextCursor: z.string().optional(),
	})
	.openapi('ListDistributionRecipientsResponse')

export const DistributionApi404ErrorSchemaV1 = z.object({
	message: z.string().openapi({
		example: 'Distribution not found',
	}),
})
