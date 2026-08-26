export type DistributionManifest = {
	environment: string
	distributionId: string
	createdAt: string
	from: string
	subject: string
	body: {
		text: string
		html?: string
	}
	kind: 'transactional' | 'marketing'
	source: string
	actor?: string | null
	subscriptionKind?: 'inialum' | 'university' | null
	audienceSnapshot?: unknown
}

const DISTRIBUTION_STATE_ROOT = 'state/distributions'

const manifestKey = (environment: string, distributionId: string) =>
	`${environment}/${DISTRIBUTION_STATE_ROOT}/${distributionId}/manifest.json`

const putJson = async (bucket: R2Bucket, key: string, data: unknown) => {
	await bucket.put(key, JSON.stringify(data, null, 2), {
		httpMetadata: {
			contentType: 'application/json',
		},
	})
}

const getJson = async <T>(bucket: R2Bucket, key: string): Promise<T | null> => {
	const object = await bucket.get(key)
	if (!object) {
		return null
	}

	return object.json<T>()
}

export const saveDistributionManifest = async (
	bucket: R2Bucket,
	manifest: DistributionManifest,
) =>
	putJson(
		bucket,
		manifestKey(manifest.environment, manifest.distributionId),
		manifest,
	)

export const getDistributionManifest = async (
	bucket: R2Bucket,
	environment: string,
	distributionId: string,
) =>
	getJson<DistributionManifest>(
		bucket,
		manifestKey(environment, distributionId),
	)

export const listDistributionManifestKeys = async (
	bucket: R2Bucket,
	environment: string,
	cursor?: string,
) =>
	bucket.list({
		prefix: `${environment}/${DISTRIBUTION_STATE_ROOT}/`,
		cursor,
		limit: 100,
	})
