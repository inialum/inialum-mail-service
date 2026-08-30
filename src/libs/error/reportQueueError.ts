import {
	type EnvironmentType,
	notifyError,
} from '@inialum/error-notification-service-javascript-sdk'

import { ERROR_NOTIFICATION_TIMEOUT_MS } from '../../constants/config'

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

export type MailSendWatchdogAlert = {
	kind: 'stall' | 'dlq'
	environment: EnvironmentType
	queue: string
	dlqQueue: string
	distributionId: string
	status: string
	sentRecipients: number
	uniqueRecipients: number
	dlqBacklog: number
}

const SERVICE_NAME = 'inialum-mail-service'

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
		await notifyError(error, {
			token,
			title: `[Queue] ${context.reason}`,
			description: buildDescription(error, context),
			serviceName: SERVICE_NAME,
			environment: context.environment,
			timeout: ERROR_NOTIFICATION_TIMEOUT_MS,
		})
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

const buildWatchdogDescription = (alert: MailSendWatchdogAlert) => {
	const lines = [
		alert.kind === 'dlq'
			? 'Unprocessed messages are in the send dead-letter queue. Recover them manually. Do not attach a permanent consumer to the DLQ.'
			: 'Send progress has not increased since the previous watchdog check.',
		`distributionId: ${alert.distributionId}`,
		`status: ${alert.status}`,
		`sent: ${alert.sentRecipients} / ${alert.uniqueRecipients}`,
		`dlqBacklog: ${alert.dlqBacklog}`,
		`queue: ${alert.queue}`,
		`dlqQueue: ${alert.dlqQueue}`,
		`environment: ${alert.environment}`,
	]

	if (alert.kind === 'stall' && alert.dlqBacklog > 0) {
		lines[0] =
			'Send progress is frozen. Unprocessed messages may be in the dead-letter queue. Recover them manually. Do not attach a permanent consumer to the DLQ.'
	}

	return lines.join('\n')
}

/**
 * Best-effort stall / DLQ notification for system operators.
 * @returns true when the notification request completed without throwing.
 */
export const reportMailSendWatchdog = async (
	token: string,
	alert: MailSendWatchdogAlert,
): Promise<boolean> => {
	const title =
		alert.kind === 'dlq'
			? 'Mail send DLQ has unprocessed messages'
			: 'Mail send stalled'
	const error = new Error(title)

	try {
		await notifyError(error, {
			token,
			title,
			description: buildWatchdogDescription(alert),
			serviceName: SERVICE_NAME,
			environment: alert.environment,
			timeout: ERROR_NOTIFICATION_TIMEOUT_MS,
		})
		return true
	} catch (notificationError) {
		console.error(
			JSON.stringify({
				event: 'mail_send_queue.notification_failed',
				notification_failed: true,
				queue: alert.queue,
				environment: alert.environment,
				reason: alert.kind,
				distributionId: alert.distributionId,
				error:
					notificationError instanceof Error
						? notificationError.message
						: String(notificationError),
			}),
		)
		return false
	}
}
