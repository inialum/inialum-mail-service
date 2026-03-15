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

export const reportQueueError = async (
	error: Error,
	token: string,
	context: QueueErrorContext,
) => {
	try {
		await notifyError(error, {
			token,
			title: `[Queue] ${context.reason}`,
			description: buildDescription(error, context),
			serviceName: SERVICE_NAME,
			environment: context.environment,
		})
	} catch (notificationError) {
		console.error('Failed to report queue error:', notificationError)
	}
}
