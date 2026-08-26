import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { env } from 'hono/adapter'

import {
	SendApi400ErrorSchemaV1,
	SendApi500ErrorSchemaV1,
} from '../../../libs/api/v1/schema/send'
import {
	SendMultipleAcceptedApiResponseSchemaV1,
	SendMultipleApiRequestSchemaV1,
	SendMultipleStatusApi404ErrorSchemaV1,
	SendMultipleStatusApiResponseSchemaV1,
} from '../../../libs/api/v1/schema/sendMultiple'
import { acceptDistribution } from '../../../libs/distribution/accept'
import { getCampaignStatus } from '../../../libs/mail/campaignStore'
import { generateMessageId } from '../../../libs/mail/r2Logger'
import type { Bindings } from '../../../types/Bindings'

const sendMultipleApiV1 = new OpenAPIHono<{ Bindings: Bindings }>()

const postRoute = createRoute({
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
		202: {
			content: {
				'application/json': {
					schema: SendMultipleAcceptedApiResponseSchemaV1,
				},
			},
			description: 'Campaign accepted and queued for processing',
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

const getRoute = createRoute({
	method: 'get',
	path: '/{campaignId}',
	security: [{ Bearer: [] }],
	request: {
		params: z.object({
			campaignId: z.string().openapi({
				example: 'e7f4ad2b-8e0d-4e7a-a8fc-0ff6c5177310',
			}),
		}),
	},
	responses: {
		200: {
			content: {
				'application/json': {
					schema: SendMultipleStatusApiResponseSchemaV1,
				},
			},
			description: 'Campaign status',
		},
		404: {
			content: {
				'application/json': {
					schema: SendMultipleStatusApi404ErrorSchemaV1,
				},
			},
			description: 'Campaign not found',
		},
	},
})

sendMultipleApiV1.openapi(
	postRoute,
	async (c) => {
		const data = c.req.valid('json')
		const campaignId = generateMessageId()
		const accepted = await acceptDistribution(env(c), {
			kind: 'transactional',
			source: 'send-multiple',
			from: data.from,
			subject: data.subject,
			body: data.body,
			recipients: data.to.map((email) => ({ email })),
			requestedRecipients: data.to.length,
			campaignId,
			enqueue: true,
		})

		return c.json(
			{
				status: 'accepted' as const,
				campaignId: accepted.campaignIds[0] ?? campaignId,
			},
			202,
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

sendMultipleApiV1.openapi(getRoute, async (c) => {
	const { ENVIRONMENT, MAIL_LOGS_BUCKET } = env(c)
	const { campaignId } = c.req.valid('param')

	const campaignStatus = await getCampaignStatus(
		MAIL_LOGS_BUCKET,
		ENVIRONMENT,
		campaignId,
	)

	if (!campaignStatus) {
		return c.json(
			{
				message: 'Campaign not found',
			},
			404,
		)
	}

	return c.json(
		{
			campaignId: campaignStatus.campaignId,
			status: campaignStatus.status,
			requestedRecipients: campaignStatus.requestedRecipients,
			uniqueRecipients: campaignStatus.uniqueRecipients,
			processedRecipients: campaignStatus.processedRecipients,
			sentRecipients: campaignStatus.sentRecipients,
			failedRecipients: campaignStatus.failedRecipients,
			createdAt: campaignStatus.createdAt,
			startedAt: campaignStatus.startedAt,
			completedAt: campaignStatus.completedAt,
		},
		200,
	)
})

export { sendMultipleApiV1 }
