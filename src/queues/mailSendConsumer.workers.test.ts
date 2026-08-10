import { reportQueueError } from '../libs/error/reportQueueError'
import {
	getCampaignChunkProgress,
	getCampaignManifest,
	getCampaignStatus,
} from '../libs/mail/campaignStore'
import { sendEmailWithSES } from '../libs/mail/ses'
import type { Bindings } from '../types/Bindings'
import { handleMailSendQueue } from './mailSendConsumer'
import {
	createExecutionContext,
	createMessageBatch,
	getQueueResult,
} from 'cloudflare:test'
import { env } from 'cloudflare:workers'

const bindings = {
	...env,
	ENVIRONMENT: 'test' as Bindings['ENVIRONMENT'],
}

vi.mock('../libs/error/reportQueueError', () => ({
	reportQueueError: vi.fn(),
}))

vi.mock('../libs/mail/campaignStore', () => ({
	getCampaignChunkProgress: vi.fn(),
	getCampaignManifest: vi.fn(),
	getCampaignStatus: vi.fn(),
}))

vi.mock('../libs/mail/ses', () => ({
	sendEmailWithSES: vi.fn(),
}))

describe('Workers queue integration', () => {
	beforeEach(() => {
		vi.mocked(reportQueueError).mockReset()
		vi.mocked(reportQueueError).mockResolvedValue(true)
		vi.mocked(getCampaignChunkProgress).mockReset()
		vi.mocked(getCampaignManifest).mockReset()
		vi.mocked(getCampaignStatus).mockReset()
		vi.mocked(sendEmailWithSES).mockReset()
	})

	test('acknowledges an invalid message through the real MessageBatch', async () => {
		const batch = createMessageBatch('inialum-mail-send-production', [
			{
				id: 'invalid-message',
				timestamp: new Date(1000),
				attempts: 1,
				body: null,
			},
		])
		const context = createExecutionContext()

		await handleMailSendQueue(batch, bindings, 0)
		const result = await getQueueResult(batch, context)

		expect(result.explicitAcks).toStrictEqual(['invalid-message'])
		expect(result.retryMessages).toStrictEqual([])
	})

	test('retries the same message when the invocation budget is exhausted', async () => {
		vi.mocked(getCampaignManifest).mockResolvedValue({
			environment: 'test',
			campaignId: 'workers-budget',
			createdAt: '2026-04-02T00:00:00.000Z',
			from: 'noreply@example.com',
			subject: 'Subject',
			body: { text: 'hello' },
			recipients: ['user@example.com'],
			requestedRecipients: 1,
			uniqueRecipients: 1,
			chunkCount: 1,
		})
		vi.mocked(getCampaignChunkProgress).mockResolvedValue({
			environment: 'test',
			campaignId: 'workers-budget',
			chunkIndex: 0,
			nextRecipientOffset: 0,
			currentRecipientAttempts: 0,
		})
		vi.mocked(getCampaignStatus).mockResolvedValue({
			environment: 'test',
			campaignId: 'workers-budget',
			status: 'accepted',
			requestedRecipients: 1,
			uniqueRecipients: 1,
			processedRecipients: 0,
			sentRecipients: 0,
			failedRecipients: 0,
			createdAt: '2026-04-02T00:00:00.000Z',
		})
		vi.mocked(sendEmailWithSES).mockRejectedValue(
			new Error('Too many subrequests'),
		)

		const batch = createMessageBatch('inialum-mail-send-production', [
			{
				id: 'budget-message',
				timestamp: new Date(1000),
				attempts: 1,
				body: {
					campaignId: 'workers-budget',
					chunkIndex: 0,
					recipients: ['user@example.com'],
				},
			},
		])
		const context = createExecutionContext()

		await handleMailSendQueue(batch, bindings, 0)
		const result = await getQueueResult(batch, context)

		expect(result.retryMessages).toHaveLength(1)
		expect(result.retryMessages[0]).toMatchObject({ msgId: 'budget-message' })
		expect(result.explicitAcks).toStrictEqual([])
	})
})
