import type { ZodError } from 'zod'

import type { SendMultipleApiRequestV1 } from '../../../libs/api/v1/schema/sendMultiple'
import {
	saveCampaignAcceptedLog,
	saveMailLogToR2,
} from '../../../libs/mail/r2Logger'
import { apiV1 } from '.'

const { sendBatchMock } = vi.hoisted(() => {
	return {
		sendBatchMock: vi.fn(),
	}
})

vi.mock('../../../libs/mail/r2Logger', () => {
	return {
		saveCampaignAcceptedLog: vi.fn(),
		saveMailLogToR2: vi.fn(),
		generateMessageId: vi.fn(() => 'test-message-id'),
	}
})

vi.mock('hono/adapter', () => {
	return {
		env: vi.fn(() => ({
			ENVIRONMENT: 'staging',
			MAIL_SEND_QUEUE: {
				sendBatch: sendBatchMock,
			},
			MAIL_LOGS_BUCKET: 'mock-r2-bucket',
		})),
	}
})

describe('API v1', () => {
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
		sendBatchMock.mockReset()
	})

	test('POST /send-multiple (should enqueue deduplicated recipients)', async () => {
		sendBatchMock.mockResolvedValueOnce(undefined)
		vi.mocked(saveCampaignAcceptedLog).mockResolvedValueOnce()

		const res = await apiV1.request('/send-multiple', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(apiBodyContent),
		})

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({
			status: 'ok',
		})
		expect(sendBatchMock).toHaveBeenCalledTimes(1)
		expect(sendBatchMock).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					contentType: 'json',
					body: expect.objectContaining({
						campaignId: 'test-message-id',
						to: 'test@example.com',
					}),
				}),
				expect.objectContaining({
					contentType: 'json',
					body: expect.objectContaining({
						campaignId: 'test-message-id',
						to: 'test2@example.com',
					}),
				}),
			]),
		)
		expect(vi.mocked(saveCampaignAcceptedLog)).toHaveBeenCalledWith(
			'mock-r2-bucket',
			expect.objectContaining({
				environment: 'staging',
				campaignId: 'test-message-id',
				requestedRecipients: 3,
				uniqueRecipients: 2,
				queuedRecipients: 2,
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
		sendBatchMock.mockRejectedValueOnce(new Error('queue enqueue failed'))
		vi.mocked(saveMailLogToR2).mockResolvedValueOnce()

		const res = await apiV1.request('/send-multiple', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(apiBodyContent),
		})

		expect(res.status).toBe(500)
		expect(await res.text()).toBe('Internal Server Error')
		expect(vi.mocked(saveMailLogToR2)).toHaveBeenCalledWith(
			'mock-r2-bucket',
			expect.objectContaining({
				environment: 'staging',
				status: 'error',
				messageId: 'test-message-id',
			}),
		)
	})
})
