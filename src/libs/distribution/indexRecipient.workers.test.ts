import { eq } from 'drizzle-orm'

import { createDb } from '../../db'
import { recipients } from '../../db/schema'
import { testEnv } from '../../types/testEnv'
import { getRecipientOutcome } from '../mail/outcomeStore'
import { acceptDistribution } from './accept'
import {
	finalizeRecipientDelivery,
	getExistingSentOutcome,
} from './indexRecipient'
import { applyD1Migrations } from 'cloudflare:test'

describe('recipient outcome indexing', () => {
	beforeEach(async () => {
		await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
	})

	test('writes a sent outcome and does not overwrite it on later failure', async () => {
		const accepted = await acceptDistribution(testEnv, {
			kind: 'transactional',
			source: 'index-test',
			from: 'noreply@mail.inialum.org',
			subject: 'Index',
			body: { text: 'hi' },
			recipients: [{ email: 'user@example.com' }],
			enqueue: false,
		})
		const campaignId = accepted.campaignIds[0] ?? 'missing'

		await finalizeRecipientDelivery({
			database: testEnv.DB,
			bucket: testEnv.MAIL_LOGS_BUCKET,
			environment: 'test',
			campaignId,
			email: 'user@example.com',
			status: 'sent',
			providerMessageId: 'ses-1',
			attempts: 1,
		})

		const existing = await getExistingSentOutcome({
			database: testEnv.DB,
			bucket: testEnv.MAIL_LOGS_BUCKET,
			environment: 'test',
			campaignId,
			email: 'user@example.com',
		})
		expect(existing?.outcome.providerMessageId).toBe('ses-1')

		await finalizeRecipientDelivery({
			database: testEnv.DB,
			bucket: testEnv.MAIL_LOGS_BUCKET,
			environment: 'test',
			campaignId,
			email: 'user@example.com',
			status: 'failed',
			error: 'should not overwrite',
			attempts: 2,
		})

		const db = createDb(testEnv.DB)
		const [row] = await db
			.select()
			.from(recipients)
			.where(eq(recipients.emailNormalized, 'user@example.com'))
		expect(row?.status).toBe('sent')
		const outcome = await getRecipientOutcome(
			testEnv.MAIL_LOGS_BUCKET,
			'test',
			campaignId,
			row?.id ?? 'missing',
		)
		expect(outcome?.status).toBe('sent')
		expect(outcome?.providerMessageId).toBe('ses-1')
	})

	test('records duplicate_possible when SES may have already accepted the send', async () => {
		const accepted = await acceptDistribution(testEnv, {
			kind: 'transactional',
			source: 'dup-test',
			from: 'noreply@mail.inialum.org',
			subject: 'Dup',
			body: { text: 'hi' },
			recipients: [{ email: 'dup@example.com' }],
			enqueue: false,
		})
		const campaignId = accepted.campaignIds[0] ?? 'missing'

		await finalizeRecipientDelivery({
			database: testEnv.DB,
			bucket: testEnv.MAIL_LOGS_BUCKET,
			environment: 'test',
			campaignId,
			email: 'dup@example.com',
			status: 'sent',
			providerMessageId: 'ses-dup',
			attempts: 1,
			duplicatePossible: true,
		})

		const db = createDb(testEnv.DB)
		const [row] = await db
			.select()
			.from(recipients)
			.where(eq(recipients.emailNormalized, 'dup@example.com'))
		expect(row?.duplicatePossible).toBe(true)
		expect(row?.status).toBe('sent')
	})
})
