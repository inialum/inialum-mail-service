import { eq } from 'drizzle-orm'

import { WATCHDOG_DELAY_SECONDS } from '../../constants/mail'
import { createDb } from '../../db'
import { distributions } from '../../db/schema'
import type { DistributionStatus } from '../../db/values'
import type { Bindings } from '../../types/Bindings'
import type { MailWatchdogMessage } from '../../types/MailQueueMessage'
import { reportMailSendWatchdog } from '../error/reportQueueError'

const TERMINAL_STATUSES: ReadonlySet<DistributionStatus> = new Set([
	'completed',
	'partial_failed',
	'failed',
])

export type WatchdogDistributionSnapshot = {
	status: DistributionStatus
	sentRecipients: number
	uniqueRecipients: number
}

export type WatchdogEvaluation = {
	shouldStop: boolean
	shouldNotifyStall: boolean
	shouldNotifyDlq: boolean
	shouldReschedule: boolean
	nextMessage: MailWatchdogMessage
}

export const isMailWatchdogMessage = (
	value: unknown,
): value is MailWatchdogMessage => {
	if (!value || typeof value !== 'object') {
		return false
	}

	const message = value as Partial<MailWatchdogMessage>
	return (
		message.type === 'watchdog' &&
		typeof message.distributionId === 'string' &&
		typeof message.sentRecipientsSnapshot === 'number' &&
		(message.notifiedStall === undefined ||
			typeof message.notifiedStall === 'boolean') &&
		(message.notifiedDlq === undefined ||
			typeof message.notifiedDlq === 'boolean')
	)
}

export const evaluateMailSendWatchdog = ({
	distribution,
	dlqBacklog,
	message,
}: {
	distribution: WatchdogDistributionSnapshot | null
	dlqBacklog: number
	message: MailWatchdogMessage
}): WatchdogEvaluation => {
	const terminal = distribution
		? TERMINAL_STATUSES.has(distribution.status)
		: true
	const sentRecipients = distribution?.sentRecipients ?? 0
	const stalled =
		distribution !== null &&
		!terminal &&
		distribution.sentRecipients === message.sentRecipientsSnapshot
	const dlqPending = dlqBacklog > 0
	const notifiedStall = Boolean(message.notifiedStall)
	const notifiedDlq = Boolean(message.notifiedDlq)
	const shouldStop = terminal && !dlqPending

	return {
		shouldStop,
		shouldNotifyStall: stalled && !notifiedStall,
		shouldNotifyDlq: dlqPending && !notifiedDlq,
		shouldReschedule: !shouldStop,
		nextMessage: {
			type: 'watchdog',
			distributionId: message.distributionId,
			sentRecipientsSnapshot: sentRecipients,
			notifiedStall: notifiedStall || stalled,
			notifiedDlq: notifiedDlq || dlqPending,
		},
	}
}

const readDlqBacklog = async (bindings: Bindings) => {
	try {
		const metrics = await bindings.MAIL_SEND_DLQ.metrics()
		return metrics.backlogCount
	} catch (error) {
		console.error(
			JSON.stringify({
				event: 'mail_send_queue.dlq_metrics_failed',
				environment: bindings.ENVIRONMENT,
				error: error instanceof Error ? error.message : String(error),
			}),
		)
		return 0
	}
}

export const runMailSendWatchdog = async ({
	bindings,
	queue,
	message,
}: {
	bindings: Bindings
	queue: string
	message: {
		id: string
		body: MailWatchdogMessage
		ack: () => void
		retry: (options?: { delaySeconds?: number }) => void
	}
}) => {
	const db = createDb(bindings.DB)
	const [distribution] = await db
		.select({
			status: distributions.status,
			sentRecipients: distributions.sentRecipients,
			uniqueRecipients: distributions.uniqueRecipients,
		})
		.from(distributions)
		.where(eq(distributions.id, message.body.distributionId))
		.limit(1)

	const dlqBacklog = await readDlqBacklog(bindings)
	const evaluation = evaluateMailSendWatchdog({
		distribution: distribution ?? null,
		dlqBacklog,
		message: message.body,
	})
	const alertBase = {
		environment: bindings.ENVIRONMENT,
		queue,
		dlqQueue: `${queue}-dlq`,
		distributionId: message.body.distributionId,
		status: distribution?.status ?? 'unknown',
		sentRecipients: distribution?.sentRecipients ?? 0,
		uniqueRecipients: distribution?.uniqueRecipients ?? 0,
		dlqBacklog,
	}

	if (evaluation.shouldNotifyStall) {
		await reportMailSendWatchdog(bindings.ERROR_NOTIFICATION_TOKEN, {
			...alertBase,
			kind: 'stall',
		})
	}

	if (evaluation.shouldNotifyDlq) {
		await reportMailSendWatchdog(bindings.ERROR_NOTIFICATION_TOKEN, {
			...alertBase,
			kind: 'dlq',
		})
	}

	if (!evaluation.shouldReschedule) {
		message.ack()
		return
	}

	try {
		await bindings.MAIL_SEND_QUEUE.send(evaluation.nextMessage, {
			contentType: 'json',
			delaySeconds: WATCHDOG_DELAY_SECONDS,
		})
		message.ack()
	} catch (error) {
		console.error(
			JSON.stringify({
				event: 'mail_send_queue.watchdog_requeue_failed',
				environment: bindings.ENVIRONMENT,
				distributionId: message.body.distributionId,
				messageId: message.id,
				error: error instanceof Error ? error.message : String(error),
			}),
		)
		message.retry({ delaySeconds: WATCHDOG_DELAY_SECONDS })
	}
}
