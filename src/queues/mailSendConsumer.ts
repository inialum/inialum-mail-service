import { LOCAL_SES_API_ENDPOINT } from '../constants/mail'
import { reportQueueError } from '../libs/error/reportQueueError'
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

const toError = (error: unknown) =>
	error instanceof Error ? error : new Error(String(error))

const logQueueEvent = (event: string, data: Record<string, unknown>) => {
	console.error(
		JSON.stringify({
			event,
			...data,
		}),
	)
}

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
	const summary = {
		processed: 0,
		succeeded: 0,
		retried: 0,
		invalid: 0,
	}
	const endpoint =
		bindings.ENVIRONMENT === 'production' || bindings.ENVIRONMENT === 'staging'
			? undefined
			: LOCAL_SES_API_ENDPOINT

	console.log(
		JSON.stringify({
			event: 'mail_send_queue.batch_started',
			queue: batch.queue,
			environment: bindings.ENVIRONMENT,
			messageCount: batch.messages.length,
		}),
	)

	for (const message of batch.messages) {
		summary.processed += 1

		if (!isMailQueueMessage(message.body)) {
			summary.invalid += 1
			const invalidPayloadError = new Error('Invalid queue payload detected')
			logQueueEvent('mail_send_queue.invalid_payload', {
				queue: batch.queue,
				environment: bindings.ENVIRONMENT,
				messageId: message.id,
				attempts: message.attempts,
			})
			await reportQueueError(
				invalidPayloadError,
				bindings.ERROR_NOTIFICATION_TOKEN,
				{
					queue: batch.queue,
					environment: bindings.ENVIRONMENT,
					reason: 'invalid payload acknowledged',
					messageId: message.id,
					attempts: message.attempts,
					willRetry: false,
				},
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
			summary.succeeded += 1
			message.ack()
		} catch (error) {
			const resolvedError = toError(error)
			const willRetry = message.attempts < FINAL_ATTEMPT_COUNT

			summary.retried += 1
			logQueueEvent('mail_send_queue.delivery_failed', {
				queue: batch.queue,
				environment: bindings.ENVIRONMENT,
				messageId: message.id,
				campaignId: message.body.campaignId,
				recipient: message.body.to,
				attempts: message.attempts,
				willRetry,
				errorName: resolvedError.name,
				errorMessage: resolvedError.message,
			})

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
						error: resolvedError.message,
					})
				} catch (logError) {
					console.error('Failed to save recipient failure log to R2:', logError)
				}

				await reportQueueError(
					resolvedError,
					bindings.ERROR_NOTIFICATION_TOKEN,
					{
						queue: batch.queue,
						environment: bindings.ENVIRONMENT,
						reason: 'final delivery failure',
						messageId: message.id,
						campaignId: message.body.campaignId,
						recipient: message.body.to,
						attempts: message.attempts,
						willRetry: false,
					},
				)
			}

			message.retry({
				delaySeconds: RETRY_DELAY_SECONDS,
			})
		}

		if (sendIntervalMs > 0) {
			await sleep(sendIntervalMs)
		}
	}

	console.log(
		JSON.stringify({
			event: 'mail_send_queue.batch_completed',
			queue: batch.queue,
			environment: bindings.ENVIRONMENT,
			...summary,
		}),
	)
}
