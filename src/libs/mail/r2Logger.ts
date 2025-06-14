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

export interface MailLogData {
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
	const date = new Date(logData.timestamp)
	const dateStr = date.toISOString().split('T')[0]
	const timeStr = date
		.toISOString()
		.split('T')[1]
		.split('.')[0]
		.replace(/:/g, '-')

	const key = `mail-service/${dateStr}/${timeStr}-${logData.messageId}.json`

	await bucket.put(key, JSON.stringify(logData, null, 2), {
		httpMetadata: {
			contentType: 'application/json',
		},
	})
}

export function generateMessageId(): string {
	return crypto.randomUUID()
}
