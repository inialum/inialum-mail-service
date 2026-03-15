/**
 * Payload delivered through Cloudflare Queues for chunk-based SES sending.
 */
export type MailQueueMessage = {
	campaignId: string
	chunkIndex: number
	recipients: string[]
}
