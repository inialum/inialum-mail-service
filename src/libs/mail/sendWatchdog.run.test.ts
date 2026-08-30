import { createDb } from '../../db'
import { reportMailSendWatchdog } from '../error/reportQueueError'
import { runMailSendWatchdog } from './sendWatchdog'

vi.mock('../../db', () => ({
	createDb: vi.fn(),
}))

vi.mock('../error/reportQueueError', () => ({
	reportMailSendWatchdog: vi.fn(),
	reportQueueError: vi.fn(),
}))

const createDbMock = (rows: unknown[]) => {
	vi.mocked(createDb).mockReturnValue({
		select: () => ({
			from: () => ({
				where: () => ({
					limit: async () => rows,
				}),
			}),
		}),
	} as never)
}

const createMessage = (body: {
	type: 'watchdog'
	distributionId: string
	sentRecipientsSnapshot: number
	notifiedStall?: boolean
	notifiedDlq?: boolean
}) => ({
	id: 'watchdog-1',
	body,
	ack: vi.fn(),
	retry: vi.fn(),
})

const bindings = {
	ENVIRONMENT: 'production' as const,
	ERROR_NOTIFICATION_TOKEN: 'token',
	DB: {},
	MAIL_SEND_QUEUE: {
		send: vi.fn(),
	},
	MAIL_SEND_DLQ: {
		metrics: vi.fn(),
	},
}

describe('runMailSendWatchdog', () => {
	beforeEach(() => {
		vi.mocked(reportMailSendWatchdog).mockReset()
		vi.mocked(reportMailSendWatchdog).mockResolvedValue(true)
		vi.mocked(bindings.MAIL_SEND_QUEUE.send).mockReset()
		vi.mocked(bindings.MAIL_SEND_DLQ.metrics).mockReset()
		vi.mocked(bindings.MAIL_SEND_DLQ.metrics).mockResolvedValue({
			backlogCount: 0,
			backlogBytes: 0,
		})
	})

	test('acks a completed distribution when the DLQ is empty', async () => {
		createDbMock([
			{
				status: 'completed',
				sentRecipients: 10,
				uniqueRecipients: 10,
			},
		])
		const message = createMessage({
			type: 'watchdog',
			distributionId: 'dst_1',
			sentRecipientsSnapshot: 10,
		})

		await runMailSendWatchdog({
			bindings: bindings as never,
			queue: 'inialum-mail-send-production',
			message,
		})

		expect(message.ack).toHaveBeenCalledTimes(1)
		expect(bindings.MAIL_SEND_QUEUE.send).not.toHaveBeenCalled()
		expect(vi.mocked(reportMailSendWatchdog)).not.toHaveBeenCalled()
	})

	test('retries when DLQ metrics cannot be read', async () => {
		createDbMock([
			{
				status: 'completed',
				sentRecipients: 10,
				uniqueRecipients: 10,
			},
		])
		vi.mocked(bindings.MAIL_SEND_DLQ.metrics).mockRejectedValue(
			new Error('metrics unavailable'),
		)
		const message = createMessage({
			type: 'watchdog',
			distributionId: 'dst_1',
			sentRecipientsSnapshot: 10,
		})

		await runMailSendWatchdog({
			bindings: bindings as never,
			queue: 'inialum-mail-send-production',
			message,
		})

		expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 300 })
		expect(message.ack).not.toHaveBeenCalled()
		expect(bindings.MAIL_SEND_QUEUE.send).not.toHaveBeenCalled()
		expect(vi.mocked(reportMailSendWatchdog)).not.toHaveBeenCalled()
	})

	test('notifies stall once and reschedules', async () => {
		createDbMock([
			{
				status: 'processing',
				sentRecipients: 211,
				uniqueRecipients: 248,
			},
		])
		const message = createMessage({
			type: 'watchdog',
			distributionId: 'dst_1',
			sentRecipientsSnapshot: 211,
		})

		await runMailSendWatchdog({
			bindings: bindings as never,
			queue: 'inialum-mail-send-production',
			message,
		})

		expect(vi.mocked(reportMailSendWatchdog)).toHaveBeenCalledWith(
			'token',
			expect.objectContaining({
				kind: 'stall',
				distributionId: 'dst_1',
				sentRecipients: 211,
				uniqueRecipients: 248,
				dlqBacklog: 0,
			}),
		)
		expect(bindings.MAIL_SEND_QUEUE.send).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'watchdog',
				notifiedStall: true,
				sentRecipientsSnapshot: 211,
			}),
			{
				contentType: 'json',
				delaySeconds: 300,
			},
		)
		expect(message.ack).toHaveBeenCalledTimes(1)
	})

	test('notifies DLQ backlog once and reschedules', async () => {
		createDbMock([
			{
				status: 'processing',
				sentRecipients: 211,
				uniqueRecipients: 248,
			},
		])
		vi.mocked(bindings.MAIL_SEND_DLQ.metrics).mockResolvedValue({
			backlogCount: 2,
			backlogBytes: 100,
		})
		const message = createMessage({
			type: 'watchdog',
			distributionId: 'dst_1',
			sentRecipientsSnapshot: 160,
		})

		await runMailSendWatchdog({
			bindings: bindings as never,
			queue: 'inialum-mail-send-production',
			message,
		})

		expect(vi.mocked(reportMailSendWatchdog)).toHaveBeenCalledWith(
			'token',
			expect.objectContaining({
				kind: 'dlq',
				dlqBacklog: 2,
				dlqQueue: 'inialum-mail-send-production-dlq',
			}),
		)
		expect(bindings.MAIL_SEND_QUEUE.send).toHaveBeenCalledWith(
			expect.objectContaining({ notifiedDlq: true }),
			expect.any(Object),
		)
	})
})
