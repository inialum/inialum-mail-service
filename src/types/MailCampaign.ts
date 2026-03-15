export type MailCampaignBody = {
	text: string
	html?: string
}

export type MailCampaignManifest = {
	environment: string
	campaignId: string
	createdAt: string
	from: string
	subject: string
	body: MailCampaignBody
	recipients: string[]
	requestedRecipients: number
	uniqueRecipients: number
	chunkCount: number
}

export type MailCampaignStatusType =
	| 'accepted'
	| 'processing'
	| 'completed'
	| 'partial_failed'
	| 'failed'

export type MailCampaignStatus = {
	environment: string
	campaignId: string
	status: MailCampaignStatusType
	requestedRecipients: number
	uniqueRecipients: number
	processedRecipients: number
	sentRecipients: number
	failedRecipients: number
	createdAt: string
	startedAt?: string
	completedAt?: string
}

export type MailCampaignChunkProgress = {
	environment: string
	campaignId: string
	chunkIndex: number
	nextRecipientOffset: number
	currentRecipientAttempts: number
	completedAt?: string
}
