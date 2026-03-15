/**
 * Payload delivered through Cloudflare Queues for per-recipient SES sending.
 */
export type MailQueueMessage = {
	campaignId: string
	timestamp: string
	from: string
	to: string
	subject: string
	body: {
		text: string
		html?: string
	}
}
