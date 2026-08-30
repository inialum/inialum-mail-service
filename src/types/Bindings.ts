import type { EnvironmentType } from '@inialum/error-notification-service-hono-middleware'

export type QueueBacklogMetrics = {
	backlogCount: number
	backlogBytes: number
	oldestMessageTimestamp?: number
}

export type Bindings = Omit<
	CloudflareBindings,
	'BACKFILL_DRY_RUN' | 'ENVIRONMENT' | 'UNSUBSCRIBE_BASE_URL' | 'MAIL_SEND_DLQ'
> & {
	ENVIRONMENT: EnvironmentType
	BACKFILL_DRY_RUN?: string
	UNSUBSCRIBE_BASE_URL?: string
	TOKEN_SECRET: string
	ERROR_NOTIFICATION_TOKEN: string
	AWS_ACCESS_KEY_ID: string
	AWS_SECRET_ACCESS_KEY: string
	MAIL_SEND_DLQ: {
		metrics: () => Promise<QueueBacklogMetrics>
	}
}
