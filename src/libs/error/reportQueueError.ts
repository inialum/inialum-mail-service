import {
	type EnvironmentType,
	notifyError,
} from '@inialum/error-notification-service-javascript-sdk'

type QueueErrorContext = {
	queue: string
	environment: EnvironmentType
	reason: string
	messageId?: string
	campaignId?: string
	recipient?: string
	attempts?: number
	willRetry?: boolean
}

const SERVICE_NAME = 'inialum-mail-service'
/** Best-effort notification; SDK has no native timeout / retry knobs. */
const NOTIFICATION_TIMEOUT_MS = 3_000

const buildDescription = (error: Error, context: QueueErrorContext) => {
	return [
		error.message,
		`reason: ${context.reason}`,
		`queue: ${context.queue}`,
		`environment: ${context.environment}`,
		context.messageId ? `messageId: ${context.messageId}` : undefined,
		context.campaignId ? `campaignId: ${context.campaignId}` : undefined,
		context.recipient ? `recipient: ${context.recipient}` : undefined,
		typeof context.attempts === 'number'
			? `attempts: ${context.attempts}`
			: undefined,
		typeof context.willRetry === 'boolean'
			? `willRetry: ${context.willRetry}`
			: undefined,
	]
		.filter((line): line is string => Boolean(line))
		.join('\n')
}

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`error notification timed out after ${timeoutMs}ms`))
		}, timeoutMs)

		promise.then(
			(value) => {
				clearTimeout(timer)
				resolve(value)
			},
			(error) => {
				clearTimeout(timer)
				reject(error)
			},
		)
	})
}

/**
 * Best-effort error notification.
 * @returns true when the notification request completed without throwing.
 */
export const reportQueueError = async (
	error: Error,
	token: string,
	context: QueueErrorContext,
): Promise<boolean> => {
	try {
		await withTimeout(
			notifyError(error, {
				token,
				title: `[Queue] ${context.reason}`,
				description: buildDescription(error, context),
				serviceName: SERVICE_NAME,
				environment: context.environment,
			}),
			NOTIFICATION_TIMEOUT_MS,
		)
		return true
	} catch (notificationError) {
		console.error(
			JSON.stringify({
				event: 'mail_send_queue.notification_failed',
				notification_failed: true,
				queue: context.queue,
				environment: context.environment,
				reason: context.reason,
				messageId: context.messageId,
				campaignId: context.campaignId,
				recipient: context.recipient,
				attempts: context.attempts,
				error:
					notificationError instanceof Error
						? notificationError.message
						: String(notificationError),
			}),
		)
		return false
	}
}
