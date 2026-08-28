export type RecipientOutcomeStatus = 'sent' | 'failed'

export type RecipientOutcome = {
	environment: string
	distributionId?: string
	campaignId: string
	recipientId: string
	email: string
	status: RecipientOutcomeStatus
	providerMessageId?: string
	attempts: number
	duplicatePossible: boolean
	error?: string
	timestamp: string
}

const OUTCOME_ROOT = 'outcomes'

export const recipientOutcomeKey = (
	environment: string,
	campaignId: string,
	recipientId: string,
) => `${environment}/${OUTCOME_ROOT}/${campaignId}/${recipientId}.json`

const putJsonIfAbsent = async (bucket: R2Bucket, key: string, data: unknown) =>
	bucket.put(key, JSON.stringify(data, null, 2), {
		onlyIf: { etagDoesNotMatch: '*' },
		httpMetadata: {
			contentType: 'application/json',
		},
	})

const getJson = async <T>(bucket: R2Bucket, key: string): Promise<T | null> => {
	const object = await bucket.get(key)
	if (!object) {
		return null
	}

	return object.json<T>()
}

export const saveRecipientOutcome = async (
	bucket: R2Bucket,
	outcome: RecipientOutcome,
) => {
	const stored = await putJsonIfAbsent(
		bucket,
		recipientOutcomeKey(
			outcome.environment,
			outcome.campaignId,
			outcome.recipientId,
		),
		outcome,
	)
	if (stored) {
		return { outcome, created: true as const }
	}

	const existing = await getRecipientOutcome(
		bucket,
		outcome.environment,
		outcome.campaignId,
		outcome.recipientId,
	)
	if (!existing) {
		throw new Error(
			'Recipient outcome conditional write failed without a winner',
		)
	}

	return { outcome: existing, created: false as const }
}

export const getRecipientOutcome = async (
	bucket: R2Bucket,
	environment: string,
	campaignId: string,
	recipientId: string,
) =>
	getJson<RecipientOutcome>(
		bucket,
		recipientOutcomeKey(environment, campaignId, recipientId),
	)

export const listRecipientOutcomes = async (
	bucket: R2Bucket,
	environment: string,
	cursor?: string,
) =>
	bucket.list({
		prefix: `${environment}/${OUTCOME_ROOT}/`,
		cursor,
		limit: 100,
	})
