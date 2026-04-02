type R2Bucket = {
	put(
		key: string,
		value: string,
		options?: { httpMetadata?: { contentType?: string } },
	): Promise<R2Object>
}

type R2Object = {
	key: string
}

const putJson = async (bucket: R2Bucket, key: string, data: unknown) => {
	await bucket.put(key, JSON.stringify(data, null, 2), {
		httpMetadata: {
			contentType: 'application/json',
		},
	})
}

const getDateStr = (timestamp: string) =>
	new Date(timestamp).toISOString().split('T')[0]

const getTimeStr = (timestamp: string) =>
	new Date(timestamp)
		.toISOString()
		.split('T')[1]
		.split('.')[0]
		.replace(/:/g, '-')

const sanitizeKeyPart = (input: string) =>
	input.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128)

export interface MailLogData {
	environment: string
	timestamp: string
	from: string
	to: string[]
	subject: string
	status: 'success' | 'error'
	messageId: string
	error?: string
}

export async function saveMailLogToR2(
	bucket: R2Bucket,
	logData: MailLogData,
): Promise<void> {
	const dateStr = getDateStr(logData.timestamp)
	const timeStr = getTimeStr(logData.timestamp)
	const key = `${logData.environment}/logs/mail/${logData.status}/${dateStr}/${timeStr}-${logData.messageId}.json`

	await putJson(bucket, key, logData)
}

export interface CampaignAcceptedLogData {
	environment: string
	campaignId: string
	timestamp: string
	from: string
	subject: string
	requestedRecipients: number
	uniqueRecipients: number
	queuedRecipients: number
}

export async function saveCampaignAcceptedLog(
	bucket: R2Bucket,
	logData: CampaignAcceptedLogData,
): Promise<void> {
	const dateStr = getDateStr(logData.timestamp)
	const key = `${logData.environment}/logs/campaigns/accepted/${dateStr}/${logData.campaignId}.json`
	await putJson(bucket, key, logData)
}

export interface RecipientFailureLogData {
	environment: string
	campaignId: string
	timestamp: string
	from: string
	to: string
	subject: string
	attempts: number
	error: string
}

export async function saveRecipientFailureLog(
	bucket: R2Bucket,
	logData: RecipientFailureLogData,
): Promise<void> {
	const dateStr = getDateStr(logData.timestamp)
	const recipient = sanitizeKeyPart(logData.to)
	const key = `${logData.environment}/logs/campaigns/failures/${dateStr}/${logData.campaignId}-${recipient}-attempt${logData.attempts}.json`
	await putJson(bucket, key, logData)
}

export function generateMessageId(): string {
	return crypto.randomUUID()
}
