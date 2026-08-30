import { evaluateMailSendWatchdog, isMailWatchdogMessage } from './sendWatchdog'

const baseMessage = {
	type: 'watchdog' as const,
	distributionId: 'dst_1',
	sentRecipientsSnapshot: 0,
}

describe('isMailWatchdogMessage', () => {
	test('accepts a watchdog payload', () => {
		expect(isMailWatchdogMessage(baseMessage)).toBe(true)
	})

	test('rejects a chunk payload', () => {
		expect(
			isMailWatchdogMessage({
				campaignId: 'cmp_1',
				chunkIndex: 0,
				recipients: ['user@example.com'],
			}),
		).toBe(false)
	})
})

describe('evaluateMailSendWatchdog', () => {
	test('stops when the distribution is complete and the DLQ is empty', () => {
		const result = evaluateMailSendWatchdog({
			distribution: {
				status: 'completed',
				sentRecipients: 10,
				uniqueRecipients: 10,
			},
			dlqBacklog: 0,
			message: { ...baseMessage, sentRecipientsSnapshot: 10 },
		})

		expect(result.shouldStop).toBe(true)
		expect(result.shouldReschedule).toBe(false)
		expect(result.shouldNotifyStall).toBe(false)
		expect(result.shouldNotifyDlq).toBe(false)
	})

	test('notifies once when sent is frozen while processing', () => {
		const first = evaluateMailSendWatchdog({
			distribution: {
				status: 'processing',
				sentRecipients: 211,
				uniqueRecipients: 248,
			},
			dlqBacklog: 0,
			message: { ...baseMessage, sentRecipientsSnapshot: 211 },
		})

		expect(first.shouldNotifyStall).toBe(true)
		expect(first.shouldNotifyDlq).toBe(false)
		expect(first.shouldReschedule).toBe(true)
		expect(first.nextMessage.notifiedStall).toBe(true)

		const second = evaluateMailSendWatchdog({
			distribution: {
				status: 'processing',
				sentRecipients: 211,
				uniqueRecipients: 248,
			},
			dlqBacklog: 0,
			message: first.nextMessage,
		})

		expect(second.shouldNotifyStall).toBe(false)
		expect(second.shouldReschedule).toBe(true)
	})

	test('notifies once when the DLQ has a backlog', () => {
		const first = evaluateMailSendWatchdog({
			distribution: {
				status: 'processing',
				sentRecipients: 211,
				uniqueRecipients: 248,
			},
			dlqBacklog: 2,
			message: { ...baseMessage, sentRecipientsSnapshot: 160 },
		})

		expect(first.shouldNotifyDlq).toBe(true)
		expect(first.nextMessage.notifiedDlq).toBe(true)
		expect(first.nextMessage.sentRecipientsSnapshot).toBe(211)

		const second = evaluateMailSendWatchdog({
			distribution: {
				status: 'processing',
				sentRecipients: 211,
				uniqueRecipients: 248,
			},
			dlqBacklog: 2,
			message: first.nextMessage,
		})

		expect(second.shouldNotifyDlq).toBe(false)
	})

	test('reschedules a completed distribution until the DLQ is empty', () => {
		const result = evaluateMailSendWatchdog({
			distribution: {
				status: 'completed',
				sentRecipients: 248,
				uniqueRecipients: 248,
			},
			dlqBacklog: 1,
			message: { ...baseMessage, sentRecipientsSnapshot: 248 },
		})

		expect(result.shouldStop).toBe(false)
		expect(result.shouldNotifyStall).toBe(false)
		expect(result.shouldNotifyDlq).toBe(true)
		expect(result.shouldReschedule).toBe(true)
	})

	test('does not notify stall when sent advanced', () => {
		const result = evaluateMailSendWatchdog({
			distribution: {
				status: 'processing',
				sentRecipients: 40,
				uniqueRecipients: 248,
			},
			dlqBacklog: 0,
			message: { ...baseMessage, sentRecipientsSnapshot: 0 },
		})

		expect(result.shouldNotifyStall).toBe(false)
		expect(result.shouldReschedule).toBe(true)
		expect(result.nextMessage.sentRecipientsSnapshot).toBe(40)
	})
})
