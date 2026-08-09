import {
	getCampaignChunkProgress,
	getCampaignManifest,
	getCampaignStatus,
	saveCampaignChunkProgress,
	saveCampaignManifest,
	saveCampaignStatus,
	updateCampaignStatus,
} from './campaignStore'

type MockR2Object = {
	json: () => Promise<unknown>
}

type MockR2Bucket = {
	get: ReturnType<typeof vi.fn<(key: string) => Promise<MockR2Object | null>>>
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
	get: vi.fn(),
	put: vi.fn(async (key: string) => ({ key })),
})

describe('campaignStore', () => {
	test('should save manifest into the state namespace', async () => {
		const bucket = createBucket()

		await saveCampaignManifest(bucket as unknown as R2Bucket, {
			environment: 'staging',
			campaignId: 'campaign-1',
			createdAt: '2026-04-02T00:00:00.000Z',
			from: 'noreply@example.com',
			subject: 'Subject',
			body: {
				text: 'hello',
				html: '<p>hello</p>',
			},
			recipients: ['user@example.com'],
			requestedRecipients: 1,
			uniqueRecipients: 1,
			chunkCount: 1,
		})

		expect(bucket.put).toHaveBeenCalledWith(
			'staging/state/campaigns/campaign-1/manifest.json',
			expect.any(String),
			{
				httpMetadata: {
					contentType: 'application/json',
				},
			},
		)
	})

	test('should save status into the state namespace', async () => {
		const bucket = createBucket()

		await saveCampaignStatus(bucket as unknown as R2Bucket, {
			environment: 'staging',
			campaignId: 'campaign-1',
			status: 'accepted',
			requestedRecipients: 1,
			uniqueRecipients: 1,
			processedRecipients: 0,
			sentRecipients: 0,
			failedRecipients: 0,
			createdAt: '2026-04-02T00:00:00.000Z',
		})

		expect(bucket.put).toHaveBeenCalledWith(
			'staging/state/campaigns/campaign-1/status.json',
			expect.any(String),
			{
				httpMetadata: {
					contentType: 'application/json',
				},
			},
		)
	})

	test('should save chunk progress into the state namespace', async () => {
		const bucket = createBucket()

		await saveCampaignChunkProgress(bucket as unknown as R2Bucket, {
			environment: 'staging',
			campaignId: 'campaign-1',
			chunkIndex: 2,
			nextRecipientOffset: 10,
			currentRecipientAttempts: 1,
		})

		expect(bucket.put).toHaveBeenCalledWith(
			'staging/state/campaigns/campaign-1/chunks/2.json',
			expect.any(String),
			{
				httpMetadata: {
					contentType: 'application/json',
				},
			},
		)
	})

	test('should read manifest from the state namespace', async () => {
		const bucket = createBucket()
		const manifest = {
			environment: 'staging',
			campaignId: 'campaign-1',
		}
		bucket.get.mockResolvedValue({
			json: async () => manifest,
		})

		await expect(
			getCampaignManifest(
				bucket as unknown as R2Bucket,
				'staging',
				'campaign-1',
			),
		).resolves.toEqual(manifest)
		expect(bucket.get).toHaveBeenCalledTimes(1)
		expect(bucket.get).toHaveBeenCalledWith(
			'staging/state/campaigns/campaign-1/manifest.json',
		)
	})

	test('should read status from the state namespace first', async () => {
		const bucket = createBucket()
		const status = {
			environment: 'staging',
			campaignId: 'campaign-1',
			status: 'processing',
		}
		bucket.get.mockResolvedValue({
			json: async () => status,
		})

		await expect(
			getCampaignStatus(bucket as unknown as R2Bucket, 'staging', 'campaign-1'),
		).resolves.toEqual(status)
		expect(bucket.get).toHaveBeenCalledTimes(1)
		expect(bucket.get).toHaveBeenCalledWith(
			'staging/state/campaigns/campaign-1/status.json',
		)
	})

	test('should read chunk progress from the state namespace', async () => {
		const bucket = createBucket()
		const progress = {
			environment: 'staging',
			campaignId: 'campaign-1',
			chunkIndex: 0,
			nextRecipientOffset: 3,
			currentRecipientAttempts: 2,
		}
		bucket.get.mockResolvedValue({
			json: async () => progress,
		})

		await expect(
			getCampaignChunkProgress(
				bucket as unknown as R2Bucket,
				'staging',
				'campaign-1',
				0,
			),
		).resolves.toEqual(progress)
		expect(bucket.get).toHaveBeenCalledTimes(1)
		expect(bucket.get).toHaveBeenCalledWith(
			'staging/state/campaigns/campaign-1/chunks/0.json',
		)
	})

	test('should write updated status back into the state namespace', async () => {
		const bucket = createBucket()
		bucket.get.mockResolvedValue({
			json: async () => ({
				environment: 'staging',
				campaignId: 'campaign-1',
				status: 'accepted',
				requestedRecipients: 1,
				uniqueRecipients: 1,
				processedRecipients: 0,
				sentRecipients: 0,
				failedRecipients: 0,
				createdAt: '2026-04-02T00:00:00.000Z',
			}),
		})

		await updateCampaignStatus(
			bucket as unknown as R2Bucket,
			'staging',
			'campaign-1',
			(current) => ({
				...current,
				status: 'processing',
			}),
		)

		expect(bucket.put).toHaveBeenCalledWith(
			'staging/state/campaigns/campaign-1/status.json',
			expect.any(String),
			{
				httpMetadata: {
					contentType: 'application/json',
				},
			},
		)
	})
})
