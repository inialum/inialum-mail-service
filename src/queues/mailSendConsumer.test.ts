import { LOCAL_SES_API_ENDPOINT } from '../constants/mail'
import { reportQueueError } from '../libs/error/reportQueueError'
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
	timestamp: '2026-03-05T10:00:00.000Z',
	from: 'noreply@mail.inialum.org',
	to: 'user@example.com',
	subject: 'Subject',
	body: {
		text: 'Body text',
		html: '<p>Body text</p>',
	},
}

const bindings = {
	ENVIRONMENT: 'production',
	AWS_ACCESS_KEY_ID: 'test-access-key-id',
	AWS_SECRET_ACCESS_KEY: 'test-secret-access-key',
	ERROR_NOTIFICATION_TOKEN: 'test-error-token',
	MAIL_LOGS_BUCKET: 'mock-r2-bucket',
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
		vi.mocked(sendEmailWithSES).mockReset()
		vi.mocked(saveRecipientFailureLog).mockReset()
		vi.mocked(reportQueueError).mockReset()
	})

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
		expect(message.ack).toHaveBeenCalledTimes(1)
		expect(message.retry).not.toHaveBeenCalled()
		expect(vi.mocked(reportQueueError)).not.toHaveBeenCalled()
	})

	test('should retry message when sending fails', async () => {
		vi.mocked(sendEmailWithSES).mockRejectedValueOnce(new Error('SES error'))
		const message = createMessage(baseMessageBody, 1)
		const batch = createBatch([message])

		await handleMailSendQueue(batch, bindings, 0)

		expect(message.ack).not.toHaveBeenCalled()
		expect(message.retry).toHaveBeenCalledWith({
			delaySeconds: 30,
		})
		expect(vi.mocked(saveRecipientFailureLog)).not.toHaveBeenCalled()
		expect(vi.mocked(reportQueueError)).not.toHaveBeenCalled()
	})

	test('should save failure log on final attempt', async () => {
		vi.mocked(sendEmailWithSES).mockRejectedValueOnce(
			new Error('SES final error'),
		)
		vi.mocked(saveRecipientFailureLog).mockResolvedValueOnce()
		const message = createMessage(baseMessageBody, 5)
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
})
