import type {
	MailCampaignChunkProgress,
	MailCampaignManifest,
	MailCampaignStatus,
	MailCampaignStatusType,
} from '../../types/MailCampaign'

const CAMPAIGN_STATE_ROOT = 'state/campaigns'

const campaignBaseKey = (
	environment: string,
	campaignId: string,
	root: string = CAMPAIGN_STATE_ROOT,
) => `${environment}/${root}/${campaignId}`

const manifestKey = (environment: string, campaignId: string, root?: string) =>
	`${campaignBaseKey(environment, campaignId, root)}/manifest.json`

const statusKey = (environment: string, campaignId: string, root?: string) =>
	`${campaignBaseKey(environment, campaignId, root)}/status.json`

const chunkProgressKey = (
	environment: string,
	campaignId: string,
	chunkIndex: number,
	root?: string,
) =>
	`${campaignBaseKey(environment, campaignId, root)}/chunks/${chunkIndex}.json`

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

export const getCampaignManifest = async (
	bucket: R2Bucket,
	environment: string,
	campaignId: string,
) => getJson<MailCampaignManifest>(bucket, manifestKey(environment, campaignId))

export const saveCampaignManifest = async (
	bucket: R2Bucket,
	manifest: MailCampaignManifest,
) =>
	putJson(
		bucket,
		manifestKey(manifest.environment, manifest.campaignId),
		manifest,
	)

export const getCampaignStatus = async (
	bucket: R2Bucket,
	environment: string,
	campaignId: string,
) => getJson<MailCampaignStatus>(bucket, statusKey(environment, campaignId))

export const saveCampaignStatus = async (
	bucket: R2Bucket,
	status: MailCampaignStatus,
) => putJson(bucket, statusKey(status.environment, status.campaignId), status)

export const updateCampaignStatus = async (
	bucket: R2Bucket,
	environment: string,
	campaignId: string,
	updater: (current: MailCampaignStatus) => MailCampaignStatus,
) => {
	const current = await getCampaignStatus(bucket, environment, campaignId)
	if (!current) {
		throw new Error(`Campaign status not found: ${campaignId}`)
	}

	const next = updater(current)
	await saveCampaignStatus(bucket, next)
	return next
}

export const getCampaignChunkProgress = async (
	bucket: R2Bucket,
	environment: string,
	campaignId: string,
	chunkIndex: number,
) =>
	getJson<MailCampaignChunkProgress>(
		bucket,
		chunkProgressKey(environment, campaignId, chunkIndex),
	)

export const saveCampaignChunkProgress = async (
	bucket: R2Bucket,
	progress: MailCampaignChunkProgress,
) =>
	putJson(
		bucket,
		chunkProgressKey(
			progress.environment,
			progress.campaignId,
			progress.chunkIndex,
		),
		progress,
	)

export const resolveCampaignStatus = ({
	processedRecipients,
	uniqueRecipients,
	sentRecipients,
	failedRecipients,
}: Pick<
	MailCampaignStatus,
	| 'processedRecipients'
	| 'uniqueRecipients'
	| 'sentRecipients'
	| 'failedRecipients'
>): MailCampaignStatusType => {
	if (processedRecipients < uniqueRecipients) {
		return 'processing'
	}

	if (failedRecipients === 0) {
		return 'completed'
	}

	if (sentRecipients === 0) {
		return 'failed'
	}

	return 'partial_failed'
}
