import { eq } from 'drizzle-orm'

import { createDb } from '../../db'
import { distributions } from '../../db/schema'
import { testEnv } from '../../types/testEnv'
import {
	acceptDistribution,
	DistributionAcceptanceIncompleteError,
} from './accept'
import { applyD1Migrations } from 'cloudflare:test'

describe('distribution acceptance', () => {
	beforeEach(async () => {
		await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
	})

	test('does not report an incomplete failed acceptance as accepted on retry', async () => {
		const idempotencyKey = `accept-failure-${crypto.randomUUID()}`
		const input = {
			kind: 'transactional' as const,
			source: 'accept-test',
			from: 'noreply@mail.inialum.org',
			subject: 'Acceptance failure',
			body: { text: 'hi' },
			recipients: [{ email: 'user@example.com' }],
			idempotencyKey,
			enqueue: true,
		}

		await expect(
			acceptDistribution(
				{
					...testEnv,
					MAIL_SEND_QUEUE: {
						send: async () => undefined,
						sendBatch: async () => {
							throw new Error('queue unavailable')
						},
					},
				},
				input,
			),
		).rejects.toThrow('queue unavailable')

		await expect(acceptDistribution(testEnv, input)).rejects.toBeInstanceOf(
			DistributionAcceptanceIncompleteError,
		)

		const db = createDb(testEnv.DB)
		const rows = await db
			.select()
			.from(distributions)
			.where(eq(distributions.idempotencyKey, idempotencyKey))
		expect(rows).toHaveLength(1)
		expect(rows[0]?.acceptanceCompletedAt).toBeNull()
		expect(rows[0]?.status).toBe('failed')
	})

	test('enqueues a five-minute watchdog after chunk messages', async () => {
		const send = vi.fn()
		const sendBatch = vi.fn()

		const accepted = await acceptDistribution(
			{
				...testEnv,
				MAIL_SEND_QUEUE: {
					send,
					sendBatch,
				},
			},
			{
				kind: 'transactional',
				source: 'accept-test',
				from: 'noreply@mail.inialum.org',
				subject: 'Watchdog enqueue',
				body: { text: 'hi' },
				recipients: [{ email: 'user@example.com' }],
				enqueue: true,
			},
		)

		expect(sendBatch).toHaveBeenCalled()
		expect(send).toHaveBeenCalledWith(
			{
				type: 'watchdog',
				distributionId: accepted.distributionId,
				sentRecipientsSnapshot: 0,
			},
			{
				contentType: 'json',
				delaySeconds: 300,
			},
		)
	})

	test('keeps the distribution accepted when watchdog enqueue fails', async () => {
		const sendBatch = vi.fn()
		const consoleError = vi
			.spyOn(console, 'error')
			.mockImplementation(() => undefined)

		const accepted = await acceptDistribution(
			{
				...testEnv,
				MAIL_SEND_QUEUE: {
					send: async () => {
						throw new Error('watchdog queue unavailable')
					},
					sendBatch,
				},
			},
			{
				kind: 'transactional',
				source: 'accept-test',
				from: 'noreply@mail.inialum.org',
				subject: 'Best-effort watchdog',
				body: { text: 'hi' },
				recipients: [{ email: 'user@example.com' }],
				enqueue: true,
			},
		)

		expect(sendBatch).toHaveBeenCalled()
		expect(accepted.status).toBe('accepted')

		const db = createDb(testEnv.DB)
		const [row] = await db
			.select()
			.from(distributions)
			.where(eq(distributions.id, accepted.distributionId))
		expect(row?.status).toBe('accepted')
		expect(row?.acceptanceCompletedAt).not.toBeNull()
		expect(consoleError).toHaveBeenCalledWith(
			expect.stringContaining('mail_send_queue.watchdog_enqueue_failed'),
		)

		consoleError.mockRestore()
	})
})
