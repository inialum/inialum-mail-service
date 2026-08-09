import {
	migrateLegacyObjectKeys,
	parseLegacyMailLogStatus,
	planLegacyObjectMigration,
} from './r2KeyMigration'

type MockObjectBody = {
	text: ReturnType<typeof vi.fn<() => Promise<string>>>
	httpMetadata?: R2HTTPMetadata
	customMetadata?: Record<string, string>
}

type MockBucket = {
	list: ReturnType<typeof vi.fn<() => Promise<R2Objects>>>
	head: ReturnType<typeof vi.fn<(key: string) => Promise<R2Object | null>>>
	get: ReturnType<typeof vi.fn<(key: string) => Promise<MockObjectBody | null>>>
	put: ReturnType<
		typeof vi.fn<
			(
				key: string,
				value: string,
				options?: R2PutOptions,
			) => Promise<{ key: string }>
		>
	>
	delete: ReturnType<typeof vi.fn<(key: string | string[]) => Promise<void>>>
}

const createBucket = (): MockBucket => ({
	list: vi.fn(),
	head: vi.fn(),
	get: vi.fn(),
	put: vi.fn(async (key: string) => ({ key })),
	delete: vi.fn(async () => undefined),
})

describe('r2KeyMigration', () => {
	test('should map legacy campaign state keys into the state namespace', () => {
		expect(
			planLegacyObjectMigration(
				'staging/multiple/campaigns/campaign-1/manifest.json',
			),
		).toEqual({
			category: 'campaign_state',
			sourceKey: 'staging/multiple/campaigns/campaign-1/manifest.json',
			targetKey: 'staging/state/campaigns/campaign-1/manifest.json',
		})
		expect(
			planLegacyObjectMigration(
				'staging/multiple/campaigns/campaign-1/chunks/2.json',
			),
		).toEqual({
			category: 'campaign_state',
			sourceKey: 'staging/multiple/campaigns/campaign-1/chunks/2.json',
			targetKey: 'staging/state/campaigns/campaign-1/chunks/2.json',
		})
	})

	test('should map legacy accepted and failure logs into the logs namespace', () => {
		expect(
			planLegacyObjectMigration(
				'staging/multiple/campaigns/2026-04-02/campaign-1.json',
			),
		).toEqual({
			category: 'campaign_accepted_log',
			sourceKey: 'staging/multiple/campaigns/2026-04-02/campaign-1.json',
			targetKey: 'staging/logs/campaigns/accepted/2026-04-02/campaign-1.json',
		})
		expect(
			planLegacyObjectMigration(
				'staging/multiple/failures/2026-04-02/campaign-1-user_example.com-attempt5.json',
			),
		).toEqual({
			category: 'campaign_failure_log',
			sourceKey:
				'staging/multiple/failures/2026-04-02/campaign-1-user_example.com-attempt5.json',
			targetKey:
				'staging/logs/campaigns/failures/2026-04-02/campaign-1-user_example.com-attempt5.json',
		})
	})

	test('should parse legacy mail log status from payload text', () => {
		expect(
			parseLegacyMailLogStatus(
				JSON.stringify({
					status: 'error',
				}),
			),
		).toBe('error')
		expect(() =>
			parseLegacyMailLogStatus(
				JSON.stringify({
					status: 'unknown',
				}),
			),
		).toThrow('Legacy mail log payload does not include a valid status')
	})

	test('should map legacy mail logs after resolving status from payload', () => {
		expect(
			planLegacyObjectMigration(
				'staging/multiple/2026-04-02/12-34-56-campaign-1.json',
				'error',
			),
		).toEqual({
			category: 'mail_log',
			sourceKey: 'staging/multiple/2026-04-02/12-34-56-campaign-1.json',
			targetKey: 'staging/logs/mail/error/2026-04-02/12-34-56-campaign-1.json',
		})
	})

	test('should plan legacy migrations in dry-run mode', async () => {
		const bucket = createBucket()
		bucket.list.mockResolvedValue({
			objects: [
				{
					key: 'staging/multiple/campaigns/campaign-1/manifest.json',
				},
				{
					key: 'staging/multiple/failures/2026-04-02/campaign-1-user_example.com-attempt5.json',
				},
			] as R2Object[],
			delimitedPrefixes: [],
			truncated: false,
		})

		const result = await migrateLegacyObjectKeys(
			bucket as unknown as R2Bucket,
			'staging',
			{
				limit: 10,
			},
		)

		expect(result.planned).toBe(2)
		expect(result.migrated).toBe(0)
		expect(bucket.put).not.toHaveBeenCalled()
	})

	test('should copy and delete a legacy mail log when apply mode is enabled', async () => {
		const bucket = createBucket()
		bucket.list.mockResolvedValue({
			objects: [
				{
					key: 'staging/multiple/2026-04-02/12-34-56-campaign-1.json',
				},
			] as R2Object[],
			delimitedPrefixes: [],
			truncated: false,
		})
		bucket.head.mockResolvedValue(null)
		bucket.get.mockResolvedValue({
			text: vi.fn(async () =>
				JSON.stringify({
					status: 'error',
					messageId: 'campaign-1',
				}),
			),
			httpMetadata: {
				contentType: 'application/json',
			},
			customMetadata: {
				source: 'legacy',
			},
		})

		const result = await migrateLegacyObjectKeys(
			bucket as unknown as R2Bucket,
			'staging',
			{
				apply: true,
				deleteSource: true,
			},
		)

		expect(result.migrated).toBe(1)
		expect(result.deleted).toBe(1)
		expect(bucket.put).toHaveBeenCalledWith(
			'staging/logs/mail/error/2026-04-02/12-34-56-campaign-1.json',
			expect.any(String),
			{
				httpMetadata: {
					contentType: 'application/json',
				},
				customMetadata: {
					source: 'legacy',
				},
			},
		)
		expect(bucket.delete).toHaveBeenCalledWith(
			'staging/multiple/2026-04-02/12-34-56-campaign-1.json',
		)
	})

	test('should skip existing targets unless overwrite is enabled', async () => {
		const bucket = createBucket()
		bucket.list.mockResolvedValue({
			objects: [
				{
					key: 'staging/multiple/campaigns/campaign-1/status.json',
				},
			] as R2Object[],
			delimitedPrefixes: [],
			truncated: false,
		})
		bucket.head.mockResolvedValue({
			key: 'staging/state/campaigns/campaign-1/status.json',
		} as R2Object)

		const result = await migrateLegacyObjectKeys(
			bucket as unknown as R2Bucket,
			'staging',
			{
				apply: true,
			},
		)

		expect(result.skipped).toBe(1)
		expect(bucket.put).not.toHaveBeenCalled()
	})
})
