import {
	saveCampaignAcceptedLog,
	saveMailLogToR2,
	saveRecipientFailureLog,
} from './r2Logger'

type MockR2Bucket = {
	put: ReturnType<
		typeof vi.fn<
			(
				key: string,
				value: string,
				options?: { httpMetadata?: { contentType?: string } },
			) => Promise<{ key: string }>
		>
	>
}

const createBucket = (): MockR2Bucket => ({
	put: vi.fn(async (key: string) => ({ key })),
})

describe('r2Logger', () => {
	test('should save mail logs under logs/mail/{status}/{date}', async () => {
		const bucket = createBucket()

		await saveMailLogToR2(bucket as unknown as R2Bucket, {
			environment: 'staging',
			timestamp: '2026-04-02T12:34:56.000Z',
			from: 'noreply@example.com',
			to: ['user@example.com'],
			subject: 'Subject',
			status: 'error',
			messageId: 'campaign-1',
			error: 'queue enqueue failed',
		})

		expect(bucket.put).toHaveBeenCalledWith(
			'staging/logs/mail/error/2026-04-02/12-34-56-campaign-1.json',
			expect.any(String),
			{
				httpMetadata: {
					contentType: 'application/json',
				},
			},
		)
	})

	test('should save campaign accepted logs under logs/campaigns/accepted/{date}', async () => {
		const bucket = createBucket()

		await saveCampaignAcceptedLog(bucket as unknown as R2Bucket, {
			environment: 'staging',
			campaignId: 'campaign-1',
			timestamp: '2026-04-02T12:34:56.000Z',
			from: 'noreply@example.com',
			subject: 'Subject',
			requestedRecipients: 10,
			uniqueRecipients: 9,
			queuedRecipients: 9,
		})

		expect(bucket.put).toHaveBeenCalledWith(
			'staging/logs/campaigns/accepted/2026-04-02/campaign-1.json',
			expect.any(String),
			{
				httpMetadata: {
					contentType: 'application/json',
				},
			},
		)
	})

	test('should save recipient failures under logs/campaigns/failures/{date}', async () => {
		const bucket = createBucket()

		await saveRecipientFailureLog(bucket as unknown as R2Bucket, {
			environment: 'staging',
			campaignId: 'campaign-1',
			timestamp: '2026-04-02T12:34:56.000Z',
			from: 'noreply@example.com',
			to: 'user+test@example.com',
			subject: 'Subject',
			attempts: 5,
			error: 'SES final error',
		})

		expect(bucket.put).toHaveBeenCalledWith(
			'staging/logs/campaigns/failures/2026-04-02/campaign-1-user_test_example.com-attempt5.json',
			expect.any(String),
			{
				httpMetadata: {
					contentType: 'application/json',
				},
			},
		)
	})
})
