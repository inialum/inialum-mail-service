import {
	getCampaignManifest,
	getCampaignStatus,
	saveCampaignManifest,
	saveCampaignStatus,
	updateCampaignStatus,
} from './campaignStore'
import { saveRecipientFailureLog } from './r2Logger'
import { env } from 'cloudflare:workers'

describe('Workers storage integration', () => {
	test('round-trips campaign manifest and status through R2', async () => {
		const campaignId = `workers-storage-${crypto.randomUUID()}`
		const manifest = {
			environment: 'test',
			campaignId,
			createdAt: '2026-04-02T00:00:00.000Z',
			from: 'noreply@example.com',
			subject: 'Subject',
			body: { text: 'hello', html: '<p>hello</p>' },
			recipients: ['user@example.com'],
			requestedRecipients: 1,
			uniqueRecipients: 1,
			chunkCount: 1,
		}
		const status = {
			environment: 'test',
			campaignId,
			status: 'accepted' as const,
			requestedRecipients: 1,
			uniqueRecipients: 1,
			processedRecipients: 0,
			sentRecipients: 0,
			failedRecipients: 0,
			createdAt: '2026-04-02T00:00:00.000Z',
		}

		await saveCampaignManifest(env.MAIL_LOGS_BUCKET, manifest)
		await saveCampaignStatus(env.MAIL_LOGS_BUCKET, status)

		expect(
			await getCampaignManifest(env.MAIL_LOGS_BUCKET, 'test', campaignId),
		).toEqual(manifest)
		expect(
			await updateCampaignStatus(
				env.MAIL_LOGS_BUCKET,
				'test',
				campaignId,
				(current) => ({ ...current, status: 'processing' }),
			),
		).toMatchObject({ status: 'processing' })
		expect(
			await getCampaignStatus(env.MAIL_LOGS_BUCKET, 'test', campaignId),
		).toMatchObject({ status: 'processing' })
	})

	test('stores recipient failure logs with JSON metadata in R2', async () => {
		const campaignId = `workers-failure-${crypto.randomUUID()}`
		const key = `test/logs/campaigns/failures/2026-04-02/${campaignId}-user_test_example.com-attempt5.json`

		await saveRecipientFailureLog(env.MAIL_LOGS_BUCKET, {
			environment: 'test',
			campaignId,
			timestamp: '2026-04-02T12:34:56.000Z',
			from: 'noreply@example.com',
			to: 'user+test@example.com',
			subject: 'Subject',
			attempts: 5,
			error: 'SES final error',
		})

		const object = await env.MAIL_LOGS_BUCKET.get(key)
		if (!object) {
			throw new Error(`R2 object was not written: ${key}`)
		}

		expect(object.httpMetadata?.contentType).toBe('application/json')
		expect(await object.json()).toMatchObject({
			campaignId,
			to: 'user+test@example.com',
			attempts: 5,
		})
	})
})
