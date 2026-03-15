import { LOCAL_SES_API_ENDPOINT } from '../constants/mail'
import { saveRecipientFailureLog } from '../libs/mail/r2Logger'
import { sendEmailWithSES } from '../libs/mail/ses'
import type { Bindings } from '../types/Bindings'
import type { MailQueueMessage } from '../types/MailQueueMessage'

const SEND_INTERVAL_MS = 125
const FINAL_ATTEMPT_COUNT = 5
const RETRY_DELAY_SECONDS = 30

const sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms)
	})

const isMailBody = (
	value: unknown,
): value is {
	text: string
	html?: string
} => {
	if (!value || typeof value !== 'object') {
		return false
	}

	const body = value as { text?: unknown; html?: unknown }
	if (typeof body.text !== 'string') {
		return false
	}
	if (body.html !== undefined && typeof body.html !== 'string') {
		return false
	}

	return true
}

const isMailQueueMessage = (value: unknown): value is MailQueueMessage => {
	if (!value || typeof value !== 'object') {
		return false
	}

	const message = value as Partial<MailQueueMessage>
	return (
		typeof message.campaignId === 'string' &&
		typeof message.timestamp === 'string' &&
		typeof message.from === 'string' &&
		typeof message.to === 'string' &&
		typeof message.subject === 'string' &&
		isMailBody(message.body)
	)
}

export const handleMailSendQueue = async (
	batch: MessageBatch<unknown>,
	bindings: Bindings,
	sendIntervalMs: number = SEND_INTERVAL_MS,
) => {
	const endpoint =
		bindings.ENVIRONMENT === 'production' || bindings.ENVIRONMENT === 'staging'
			? undefined
			: LOCAL_SES_API_ENDPOINT

	for (const message of batch.messages) {
		if (!isMailQueueMessage(message.body)) {
			console.error(
				'Invalid queue payload detected. Message will be acknowledged.',
			)
			message.ack()
			continue
		}

		try {
			await sendEmailWithSES(
				{
					fromAddress: message.body.from,
					toAddresses: [message.body.to],
					subject: message.body.subject,
					body: message.body.body,
				},
				{
					accessKeyId: bindings.AWS_ACCESS_KEY_ID,
					secretAccessKey: bindings.AWS_SECRET_ACCESS_KEY,
				},
				endpoint,
			)
			message.ack()
		} catch (error) {
			if (message.attempts >= FINAL_ATTEMPT_COUNT) {
				try {
					await saveRecipientFailureLog(bindings.MAIL_LOGS_BUCKET, {
						environment: bindings.ENVIRONMENT,
						campaignId: message.body.campaignId,
						timestamp: new Date().toISOString(),
						from: message.body.from,
						to: message.body.to,
						subject: message.body.subject,
						attempts: message.attempts,
						error: error instanceof Error ? error.message : String(error),
					})
				} catch (logError) {
					console.error('Failed to save recipient failure log to R2:', logError)
				}
			}

			message.retry({
				delaySeconds: RETRY_DELAY_SECONDS,
			})
		}

		if (sendIntervalMs > 0) {
			await sleep(sendIntervalMs)
		}
	}
}
