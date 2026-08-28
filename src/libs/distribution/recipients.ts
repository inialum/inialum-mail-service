import { RECIPIENTS_PER_CAMPAIGN } from '../../constants/distribution'
import { RECIPIENTS_PER_CHUNK } from '../../constants/mail'

export type IncomingRecipient = {
	email: string
	unsubscribeToken?: string
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase()

export const dedupeRecipients = (
	recipients: IncomingRecipient[],
): IncomingRecipient[] => {
	const seen = new Set<string>()
	const deduped: IncomingRecipient[] = []

	for (const recipient of recipients) {
		const email = recipient.email.trim()
		const key = normalizeEmail(email)

		if (!email || seen.has(key)) {
			continue
		}

		seen.add(key)
		deduped.push({
			email,
			unsubscribeToken: recipient.unsubscribeToken,
		})
	}

	return deduped
}

export const chunkItems = <T>(items: T[], size: number): T[][] => {
	const chunks: T[][] = []

	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size))
	}

	return chunks
}

export const splitIntoCampaigns = (
	recipients: IncomingRecipient[],
	size: number = RECIPIENTS_PER_CAMPAIGN,
) => chunkItems(recipients, size)

export const splitIntoChunks = (
	recipients: IncomingRecipient[],
	size: number = RECIPIENTS_PER_CHUNK,
) => chunkItems(recipients, size)
