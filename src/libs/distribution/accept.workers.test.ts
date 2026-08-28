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
})
