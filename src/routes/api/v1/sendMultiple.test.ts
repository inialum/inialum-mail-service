import type { ZodError } from 'zod'

import type { SendMultipleApiRequestV1 } from '../../../libs/api/v1/schema/sendMultiple'
import {
	getCampaignStatus,
	saveCampaignChunkProgress,
	saveCampaignManifest,
	saveCampaignStatus,
	updateCampaignStatus,
} from '../../../libs/mail/campaignStore'
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

vi.mock('../../../libs/mail/campaignStore', () => {
	return {
		saveCampaignManifest: vi.fn(),
		saveCampaignStatus: vi.fn(),
		saveCampaignChunkProgress: vi.fn(),
		getCampaignStatus: vi.fn(),
		updateCampaignStatus: vi.fn(),
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
		vi.mocked(saveCampaignManifest).mockReset()
		vi.mocked(saveCampaignStatus).mockReset()
		vi.mocked(saveCampaignChunkProgress).mockReset()
		vi.mocked(getCampaignStatus).mockReset()
		vi.mocked(updateCampaignStatus).mockReset()
		vi.mocked(saveCampaignAcceptedLog).mockReset()
		vi.mocked(saveMailLogToR2).mockReset()
	})

	test('POST /send-multiple (should accept and enqueue deduplicated recipients)', async () => {
		sendBatchMock.mockResolvedValueOnce(undefined)
		vi.mocked(saveCampaignManifest).mockResolvedValueOnce(undefined)
		vi.mocked(saveCampaignStatus).mockResolvedValueOnce(undefined)
		vi.mocked(saveCampaignChunkProgress).mockResolvedValueOnce(undefined)
		vi.mocked(saveCampaignAcceptedLog).mockResolvedValueOnce(undefined)

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
		expect(vi.mocked(saveCampaignManifest)).toHaveBeenCalledWith(
			'mock-r2-bucket',
			expect.objectContaining({
				environment: 'staging',
				campaignId: 'test-message-id',
				recipients: ['test@example.com', 'test2@example.com'],
				requestedRecipients: 3,
				uniqueRecipients: 2,
				chunkCount: 1,
			}),
		)
		expect(vi.mocked(saveCampaignStatus)).toHaveBeenCalledWith(
			'mock-r2-bucket',
			expect.objectContaining({
				status: 'accepted',
				processedRecipients: 0,
				sentRecipients: 0,
				failedRecipients: 0,
			}),
		)
		expect(vi.mocked(saveCampaignChunkProgress)).toHaveBeenCalledWith(
			'mock-r2-bucket',
			expect.objectContaining({
				environment: 'staging',
				campaignId: 'test-message-id',
				chunkIndex: 0,
				nextRecipientOffset: 0,
				currentRecipientAttempts: 0,
			}),
		)
		expect(sendBatchMock).toHaveBeenCalledTimes(1)
		expect(sendBatchMock).toHaveBeenCalledWith([
			{
				body: {
					campaignId: 'test-message-id',
					chunkIndex: 0,
					recipients: ['test@example.com', 'test2@example.com'],
				},
				contentType: 'json',
			},
		])
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

	test('POST /send-multiple (should chunk up to 400 recipients into multiple queue messages)', async () => {
		sendBatchMock.mockResolvedValueOnce(undefined)
		vi.mocked(saveCampaignManifest).mockResolvedValueOnce(undefined)
		vi.mocked(saveCampaignStatus).mockResolvedValueOnce(undefined)
		vi.mocked(saveCampaignChunkProgress).mockResolvedValue(undefined)
		vi.mocked(saveCampaignAcceptedLog).mockResolvedValueOnce(undefined)

		const recipients = Array.from(
			{
				length: 250,
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

		expect(res.status).toBe(202)
		expect(sendBatchMock).toHaveBeenCalledWith([
			{
				body: {
					campaignId: 'test-message-id',
					chunkIndex: 0,
					recipients: recipients.slice(0, 100),
				},
				contentType: 'json',
			},
			{
				body: {
					campaignId: 'test-message-id',
					chunkIndex: 1,
					recipients: recipients.slice(100, 200),
				},
				contentType: 'json',
			},
			{
				body: {
					campaignId: 'test-message-id',
					chunkIndex: 2,
					recipients: recipients.slice(200, 250),
				},
				contentType: 'json',
			},
		])
		expect(vi.mocked(saveCampaignChunkProgress)).toHaveBeenCalledTimes(3)
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
		vi.mocked(saveCampaignManifest).mockResolvedValueOnce(undefined)
		vi.mocked(saveCampaignStatus).mockResolvedValueOnce(undefined)
		vi.mocked(saveCampaignChunkProgress).mockResolvedValueOnce(undefined)
		vi.mocked(updateCampaignStatus).mockResolvedValueOnce({
			environment: 'staging',
			campaignId: 'test-message-id',
			status: 'failed',
			requestedRecipients: 3,
			uniqueRecipients: 2,
			processedRecipients: 0,
			sentRecipients: 0,
			failedRecipients: 0,
			createdAt: '2026-03-16T00:00:00.000Z',
			completedAt: '2026-03-16T00:00:01.000Z',
		})
		vi.mocked(saveMailLogToR2).mockResolvedValueOnce(undefined)

		const res = await apiV1.request('/send-multiple', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(apiBodyContent),
		})

		expect(res.status).toBe(500)
		expect(await res.text()).toBe('Internal Server Error')
		expect(vi.mocked(updateCampaignStatus)).toHaveBeenCalledWith(
			'mock-r2-bucket',
			'staging',
			'test-message-id',
			expect.any(Function),
		)
		expect(vi.mocked(saveMailLogToR2)).toHaveBeenCalledWith(
			'mock-r2-bucket',
			expect.objectContaining({
				environment: 'staging',
				status: 'error',
				messageId: 'test-message-id',
			}),
		)
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
