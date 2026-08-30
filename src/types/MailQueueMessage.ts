/**
 * Payload delivered through Cloudflare Queues for chunk-based SES sending.
 *
 * Recipients may be a legacy email string (in-flight transactional messages)
 * or an object that carries an opaque marketing unsubscribe token.
 */
export type MailQueueRecipient =
	| string
	| {
			email: string
			unsubscribeToken?: string
	  }

export type MailQueueMessage = {
	campaignId: string
	chunkIndex: number
	recipients: MailQueueRecipient[]
	distributionId?: string
}

/** Delayed progress / DLQ inspection. Distinct from in-flight chunk payloads. */
export type MailWatchdogMessage = {
	type: 'watchdog'
	distributionId: string
	sentRecipientsSnapshot: number
	notifiedStall?: boolean
	notifiedDlq?: boolean
}
