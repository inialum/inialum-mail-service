import { notifyError } from '@inialum/error-notification-service-javascript-sdk'

import { reportMailSendWatchdog } from './reportQueueError'

vi.mock('@inialum/error-notification-service-javascript-sdk', () => ({
	notifyError: vi.fn(),
}))

describe('reportMailSendWatchdog', () => {
	beforeEach(() => {
		vi.mocked(notifyError).mockReset()
		vi.mocked(notifyError).mockResolvedValue(undefined)
	})

	test('uses a status-neutral description when progress is frozen', async () => {
		await reportMailSendWatchdog('token', {
			kind: 'stall',
			environment: 'production',
			queue: 'inialum-mail-send-production',
			dlqQueue: 'inialum-mail-send-production-dlq',
			distributionId: 'dst_1',
			status: 'accepted',
			sentRecipients: 211,
			uniqueRecipients: 248,
			dlqBacklog: 0,
		})

		expect(vi.mocked(notifyError)).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({
				title: 'Mail send stalled',
				serviceName: 'inialum-mail-service',
				description: expect.stringContaining(
					'Send progress has not increased since the previous watchdog check.',
				),
			}),
		)
	})

	test('uses the DLQ title when the holding queue has messages', async () => {
		await reportMailSendWatchdog('token', {
			kind: 'dlq',
			environment: 'production',
			queue: 'inialum-mail-send-production',
			dlqQueue: 'inialum-mail-send-production-dlq',
			distributionId: 'dst_1',
			status: 'processing',
			sentRecipients: 211,
			uniqueRecipients: 248,
			dlqBacklog: 2,
		})

		expect(vi.mocked(notifyError)).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({
				title: 'Mail send DLQ has unprocessed messages',
				description: expect.stringContaining(
					'Do not attach a permanent consumer to the DLQ',
				),
			}),
		)
	})
})
