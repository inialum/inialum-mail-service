import type { ZodError } from 'zod'

import type { SendMultipleApiRequestV1 } from '../../../libs/api/v1/schema/sendMultiple'
import { acceptDistribution } from '../../../libs/distribution/accept'
import { getCampaignStatus } from '../../../libs/mail/campaignStore'
import { apiV1 } from '.'

vi.mock('../../../libs/distribution/accept', () => {
	return {
		acceptDistribution: vi.fn(),
	}
})

vi.mock('../../../libs/mail/campaignStore', () => {
	return {
		getCampaignStatus: vi.fn(),
	}
})

vi.mock('../../../libs/mail/r2Logger', () => {
	return {
		generateMessageId: vi.fn(() => 'test-message-id'),
	}
})

vi.mock('hono/adapter', () => {
	return {
		env: vi.fn(() => ({
			ENVIRONMENT: 'staging',
			MAIL_SEND_QUEUE: {},
			MAIL_LOGS_BUCKET: 'mock-r2-bucket',
			DB: {},
		})),
	}
})

describe('API v1 send-multiple', () => {
	const apiBodyContent: SendMultipleApiRequestV1 = {
		from: 'noreply@mail.inialum.org',
		to: ['test@example.com', 'TEST@example.com', 'test2@example.com'],
		subject: 'Test',
		body: {
			text: 'This is a test mail.',
			html: '<p>Hello World!</p>',
		},
	}

	beforeEach(() => {
		vi.mocked(acceptDistribution).mockReset()
		vi.mocked(getCampaignStatus).mockReset()
	})

	test('POST /send-multiple (should accept and enqueue deduplicated recipients)', async () => {
		vi.mocked(acceptDistribution).mockResolvedValueOnce({
			distributionId: 'dst_test',
			campaignIds: ['test-message-id'],
			uniqueRecipients: 2,
			requestedRecipients: 3,
			status: 'accepted',
		})

		const res = await apiV1.request('/send-multiple', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(apiBodyContent),
		})

		expect(res.status).toBe(202)
		expect(await res.json()).toEqual({
			status: 'accepted',
			campaignId: 'test-message-id',
		})
		expect(acceptDistribution).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				kind: 'transactional',
				source: 'send-multiple',
				campaignId: 'test-message-id',
				enqueue: true,
				requestedRecipients: 3,
			}),
		)
	})

	test('POST /send-multiple (should return validation errors)', async () => {
		const res = await apiV1.request('/send-multiple', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				from: 'noreply@mail.inialum.org',
				to: ['.test@example.com'],
				body: { ...apiBodyContent.body, text: undefined },
			}),
		})

		expect(res.status).toBe(400)
		expect(await res.json()).toEqual({
			message: 'Validation error',
			issues: [
				{
					code: 'invalid_string',
					message: 'Invalid email address',
					path: ['to', 0],
					validation: 'email',
				},
				{
					code: 'invalid_type',
					expected: 'string',
					message: 'This field is required',
					path: ['subject'],
					received: 'undefined',
				},
				{
					code: 'invalid_type',
					expected: 'string',
					message: 'This field is required',
					path: ['body', 'text'],
					received: 'undefined',
				},
			] as ZodError['issues'],
		})
	})

	test('POST /send-multiple (should reject when recipient count exceeds 400)', async () => {
		const recipients = Array.from(
			{
				length: 401,
			},
			(_, index) => `user${index}@example.com`,
		)

		const res = await apiV1.request('/send-multiple', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				...apiBodyContent,
				to: recipients,
			}),
		})

		expect(res.status).toBe(400)
		expect(await res.json()).toEqual({
			message: 'Validation error',
			issues: [
				{
					code: 'too_big',
					maximum: 400,
					type: 'array',
					inclusive: true,
					exact: false,
					message: 'Maximum 400 recipients are allowed',
					path: ['to'],
				},
			] as ZodError['issues'],
		})
	})

	test('POST /send-multiple (should return 500 when enqueue fails)', async () => {
		vi.mocked(acceptDistribution).mockRejectedValueOnce(
			new Error('queue enqueue failed'),
		)

		const res = await apiV1.request('/send-multiple', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(apiBodyContent),
		})

		expect(res.status).toBe(500)
		expect(await res.text()).toBe('Internal Server Error')
	})

	test('GET /send-multiple/:campaignId (should return campaign status)', async () => {
		vi.mocked(getCampaignStatus).mockResolvedValueOnce({
			environment: 'staging',
			campaignId: 'test-message-id',
			status: 'processing',
			requestedRecipients: 10,
			uniqueRecipients: 9,
			processedRecipients: 3,
			sentRecipients: 3,
			failedRecipients: 0,
			createdAt: '2026-03-16T00:00:00.000Z',
			startedAt: '2026-03-16T00:00:05.000Z',
		})

		const res = await apiV1.request('/send-multiple/test-message-id', {
			method: 'GET',
		})

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({
			campaignId: 'test-message-id',
			status: 'processing',
			requestedRecipients: 10,
			uniqueRecipients: 9,
			processedRecipients: 3,
			sentRecipients: 3,
			failedRecipients: 0,
			createdAt: '2026-03-16T00:00:00.000Z',
			startedAt: '2026-03-16T00:00:05.000Z',
		})
	})

	test('GET /send-multiple/:campaignId (should return 404 when campaign is missing)', async () => {
		vi.mocked(getCampaignStatus).mockResolvedValueOnce(null)

		const res = await apiV1.request('/send-multiple/test-message-id', {
			method: 'GET',
		})

		expect(res.status).toBe(404)
		expect(await res.json()).toEqual({
			message: 'Campaign not found',
		})
	})
})
