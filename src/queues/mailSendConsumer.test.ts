import { LOCAL_SES_API_ENDPOINT } from '../constants/mail'
import { reportQueueError } from '../libs/error/reportQueueError'
import {
	getCampaignChunkProgress,
	getCampaignManifest,
	getCampaignStatus,
	saveCampaignChunkProgress,
	updateCampaignStatus,
} from '../libs/mail/campaignStore'
import { saveRecipientFailureLog } from '../libs/mail/r2Logger'
import { sendEmailWithSES } from '../libs/mail/ses'
import type { Bindings } from '../types/Bindings'
import type { MailQueueMessage } from '../types/MailQueueMessage'
import { handleMailSendQueue } from './mailSendConsumer'

vi.mock('../libs/mail/ses', () => {
	return {
		sendEmailWithSES: vi.fn(),
	}
})

vi.mock('../libs/mail/campaignStore', () => {
	return {
		getCampaignManifest: vi.fn(),
		getCampaignChunkProgress: vi.fn(),
		getCampaignStatus: vi.fn(),
		saveCampaignChunkProgress: vi.fn(),
		updateCampaignStatus: vi.fn(),
		resolveCampaignStatus: vi.fn(
			({
				processedRecipients,
				uniqueRecipients,
				sentRecipients,
				failedRecipients,
			}) => {
				if (processedRecipients < uniqueRecipients) {
					return 'processing'
				}
				if (failedRecipients === 0) {
					return 'completed'
				}
				if (sentRecipients === 0) {
					return 'failed'
				}
				return 'partial_failed'
			},
		),
	}
})

vi.mock('../libs/mail/r2Logger', () => {
	return {
		saveRecipientFailureLog: vi.fn(),
	}
})

vi.mock('../libs/error/reportQueueError', () => {
	return {
		reportQueueError: vi.fn(),
	}
})

const baseMessageBody: MailQueueMessage = {
	campaignId: 'campaign-1',
	chunkIndex: 0,
	recipients: ['user@example.com'],
}

const baseManifest = {
	environment: 'production',
	campaignId: 'campaign-1',
	createdAt: '2026-03-05T10:00:00.000Z',
	from: 'noreply@mail.inialum.org',
	subject: 'Subject',
	body: {
		text: 'Body text',
		html: '<p>Body text</p>',
	},
	recipients: ['user@example.com'],
	requestedRecipients: 1,
	uniqueRecipients: 1,
	chunkCount: 1,
}

const baseStatus = {
	environment: 'production',
	campaignId: 'campaign-1',
	status: 'accepted' as const,
	requestedRecipients: 1,
	uniqueRecipients: 1,
	processedRecipients: 0,
	sentRecipients: 0,
	failedRecipients: 0,
	createdAt: '2026-03-05T10:00:00.000Z',
}

const baseProgress = {
	environment: 'production',
	campaignId: 'campaign-1',
	chunkIndex: 0,
	nextRecipientOffset: 0,
	currentRecipientAttempts: 0,
}

const queueSendMock = vi.fn()

const bindings = {
	ENVIRONMENT: 'production',
	AWS_ACCESS_KEY_ID: 'test-access-key-id',
	AWS_SECRET_ACCESS_KEY: 'test-secret-access-key',
	ERROR_NOTIFICATION_TOKEN: 'test-error-token',
	MAIL_LOGS_BUCKET: 'mock-r2-bucket',
	MAIL_SEND_QUEUE: {
		send: queueSendMock,
	},
} as unknown as Bindings

const createMessage = (body: unknown, attempts: number = 1) => {
	return {
		id: crypto.randomUUID(),
		timestamp: new Date(),
		body,
		attempts,
		ack: vi.fn(),
		retry: vi.fn(),
	}
}

const createBatch = (messages: ReturnType<typeof createMessage>[]) => {
	return {
		queue: 'inialum-mail-send-production',
		messages,
		ackAll: vi.fn(),
		retryAll: vi.fn(),
	}
}

describe('handleMailSendQueue', () => {
	beforeEach(() => {
		queueSendMock.mockReset()
		vi.mocked(sendEmailWithSES).mockReset()
		vi.mocked(getCampaignManifest).mockReset()
		vi.mocked(getCampaignChunkProgress).mockReset()
		vi.mocked(getCampaignStatus).mockReset()
		vi.mocked(saveCampaignChunkProgress).mockReset()
		vi.mocked(updateCampaignStatus).mockReset()
		vi.mocked(saveRecipientFailureLog).mockReset()
		vi.mocked(reportQueueError).mockReset()

		vi.mocked(getCampaignManifest).mockResolvedValue(baseManifest)
		vi.mocked(getCampaignChunkProgress).mockResolvedValue(baseProgress)
		vi.mocked(getCampaignStatus).mockResolvedValue(baseStatus)
		vi.mocked(saveCampaignChunkProgress).mockResolvedValue(undefined)
		vi.mocked(updateCampaignStatus).mockResolvedValue(baseStatus)
	})

	const getStatusUpdaterResult = (callIndex: number, current = baseStatus) => {
		const updater = vi.mocked(updateCampaignStatus).mock.calls[callIndex]?.[3]
		expect(updater).toBeTypeOf('function')
		return (updater as (status: typeof baseStatus) => typeof baseStatus)(
			current,
		)
	}

	test('should send mail and acknowledge message', async () => {
		vi.mocked(sendEmailWithSES).mockResolvedValueOnce({
			$metadata: {
				httpStatusCode: 200,
			},
		})
		const message = createMessage(baseMessageBody)
		const batch = createBatch([message])

		await handleMailSendQueue(batch, bindings, 0)

		expect(vi.mocked(sendEmailWithSES)).toHaveBeenCalledWith(
			{
				fromAddress: 'noreply@mail.inialum.org',
				toAddresses: ['user@example.com'],
				subject: 'Subject',
				body: {
					text: 'Body text',
					html: '<p>Body text</p>',
				},
			},
			{
				accessKeyId: 'test-access-key-id',
				secretAccessKey: 'test-secret-access-key',
			},
			undefined,
		)
		expect(vi.mocked(saveCampaignChunkProgress)).toHaveBeenCalledWith(
			'mock-r2-bucket',
			expect.objectContaining({
				nextRecipientOffset: 1,
				currentRecipientAttempts: 0,
			}),
		)
		expect(message.ack).toHaveBeenCalledTimes(1)
		expect(message.retry).not.toHaveBeenCalled()
		expect(queueSendMock).not.toHaveBeenCalled()
		expect(vi.mocked(reportQueueError)).not.toHaveBeenCalled()
	})

	test('should fail campaign without retrying when bookkeeping fails after send', async () => {
		vi.mocked(sendEmailWithSES).mockResolvedValueOnce({
			$metadata: {
				httpStatusCode: 200,
			},
		})
		vi.mocked(saveCampaignChunkProgress).mockRejectedValueOnce(
			new Error('chunk progress save failed'),
		)
		const message = createMessage(baseMessageBody, 1)
		const batch = createBatch([message])

		await handleMailSendQueue(batch, bindings, 0)

		expect(message.retry).not.toHaveBeenCalled()
		expect(message.ack).toHaveBeenCalledTimes(1)
		expect(queueSendMock).not.toHaveBeenCalled()
		expect(vi.mocked(updateCampaignStatus)).toHaveBeenCalledTimes(2)
		expect(getStatusUpdaterResult(1)).toEqual(
			expect.objectContaining({
				status: 'failed',
			}),
		)
		expect(vi.mocked(reportQueueError)).toHaveBeenCalledWith(
			expect.any(Error),
			'test-error-token',
			expect.objectContaining({
				queue: 'inialum-mail-send-production',
				reason: 'campaign bookkeeping failed after send',
				campaignId: 'campaign-1',
				recipient: 'user@example.com',
				willRetry: false,
			}),
		)
	})

	test('should enqueue a continuation message when sending fails before final attempt', async () => {
		vi.mocked(sendEmailWithSES).mockRejectedValueOnce(new Error('SES error'))
		queueSendMock.mockResolvedValueOnce(undefined)
		const message = createMessage(baseMessageBody, 1)
		const batch = createBatch([message])

		await handleMailSendQueue(batch, bindings, 0)

		expect(vi.mocked(saveCampaignChunkProgress)).toHaveBeenCalledWith(
			'mock-r2-bucket',
			expect.objectContaining({
				nextRecipientOffset: 0,
				currentRecipientAttempts: 1,
			}),
		)
		expect(queueSendMock).toHaveBeenCalledWith(baseMessageBody, {
			contentType: 'json',
			delaySeconds: 30,
		})
		expect(message.ack).toHaveBeenCalledTimes(1)
		expect(message.retry).not.toHaveBeenCalled()
		expect(vi.mocked(saveRecipientFailureLog)).not.toHaveBeenCalled()
	})

	test('should save failure log and acknowledge message on final recipient attempt', async () => {
		vi.mocked(getCampaignChunkProgress).mockResolvedValueOnce({
			...baseProgress,
			currentRecipientAttempts: 4,
		})
		vi.mocked(sendEmailWithSES).mockRejectedValueOnce(
			new Error('SES final error'),
		)
		vi.mocked(saveRecipientFailureLog).mockResolvedValueOnce(undefined)
		const message = createMessage(baseMessageBody, 1)
		const batch = createBatch([message])

		await handleMailSendQueue(batch, bindings, 0)

		expect(vi.mocked(saveRecipientFailureLog)).toHaveBeenCalledWith(
			'mock-r2-bucket',
			expect.objectContaining({
				environment: 'production',
				campaignId: 'campaign-1',
				to: 'user@example.com',
				attempts: 5,
				error: 'SES final error',
			}),
		)
		expect(queueSendMock).not.toHaveBeenCalled()
		expect(message.retry).not.toHaveBeenCalled()
		expect(message.ack).toHaveBeenCalledTimes(1)
		expect(vi.mocked(reportQueueError)).toHaveBeenCalledWith(
			expect.any(Error),
			'test-error-token',
			expect.objectContaining({
				queue: 'inialum-mail-send-production',
				reason: 'final delivery failure',
				recipient: 'user@example.com',
				attempts: 5,
				willRetry: false,
			}),
		)
	})

	test('should use local SES endpoint outside production and staging', async () => {
		vi.mocked(sendEmailWithSES).mockResolvedValueOnce({
			$metadata: {
				httpStatusCode: 200,
			},
		})
		const message = createMessage(baseMessageBody)
		const batch = createBatch([message])
		const localBindings = {
			...bindings,
			ENVIRONMENT: 'local',
		} as Bindings

		await handleMailSendQueue(batch, localBindings, 0)

		expect(vi.mocked(sendEmailWithSES)).toHaveBeenCalledWith(
			expect.any(Object),
			expect.any(Object),
			LOCAL_SES_API_ENDPOINT,
		)
	})

	test('should ack invalid queue payload and skip processing', async () => {
		const message = createMessage(
			{
				invalid: true,
			},
			1,
		)
		const batch = createBatch([message])

		await handleMailSendQueue(batch, bindings, 0)

		expect(message.ack).toHaveBeenCalledTimes(1)
		expect(message.retry).not.toHaveBeenCalled()
		expect(vi.mocked(sendEmailWithSES)).not.toHaveBeenCalled()
		expect(vi.mocked(reportQueueError)).toHaveBeenCalledWith(
			expect.any(Error),
			'test-error-token',
			expect.objectContaining({
				queue: 'inialum-mail-send-production',
				reason: 'invalid payload acknowledged',
				messageId: message.id,
				attempts: 1,
				willRetry: false,
			}),
		)
	})

	test('should ack when campaign data is missing', async () => {
		vi.mocked(getCampaignManifest).mockResolvedValueOnce(null)
		const message = createMessage(baseMessageBody, 1)
		const batch = createBatch([message])

		await handleMailSendQueue(batch, bindings, 0)

		expect(message.ack).toHaveBeenCalledTimes(1)
		expect(message.retry).not.toHaveBeenCalled()
		expect(vi.mocked(updateCampaignStatus)).toHaveBeenCalledTimes(1)
		expect(getStatusUpdaterResult(0)).toEqual(
			expect.objectContaining({
				status: 'failed',
			}),
		)
		expect(vi.mocked(reportQueueError)).toHaveBeenCalledWith(
			expect.any(Error),
			'test-error-token',
			expect.objectContaining({
				queue: 'inialum-mail-send-production',
				reason: 'campaign data missing',
				campaignId: 'campaign-1',
				willRetry: false,
			}),
		)
	})

	test('should mark campaign failed and ack on final processing error', async () => {
		vi.mocked(updateCampaignStatus).mockRejectedValueOnce(
			new Error('campaign status update failed'),
		)
		const message = createMessage(baseMessageBody, 5)
		const batch = createBatch([message])

		await handleMailSendQueue(batch, bindings, 0)

		expect(message.retry).not.toHaveBeenCalled()
		expect(message.ack).toHaveBeenCalledTimes(1)
		expect(vi.mocked(updateCampaignStatus)).toHaveBeenCalledTimes(2)
		expect(getStatusUpdaterResult(1)).toEqual(
			expect.objectContaining({
				status: 'failed',
			}),
		)
		expect(vi.mocked(reportQueueError)).toHaveBeenCalledWith(
			expect.any(Error),
			'test-error-token',
			expect.objectContaining({
				queue: 'inialum-mail-send-production',
				reason: 'campaign processing failed',
				campaignId: 'campaign-1',
				attempts: 5,
				willRetry: false,
			}),
		)
	})
})
