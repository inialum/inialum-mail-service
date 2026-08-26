import type { DistributionKind, SubscriptionKind } from '../../db/values'
import type { IncomingRecipient } from './recipients'
import { dedupeRecipients, normalizeEmail } from './recipients'

export type DistributionPayload = {
	kind: DistributionKind
	subscriptionKind?: SubscriptionKind | null
	source: string
	actor?: string | null
	audienceSnapshot?: unknown
	from: string
	subject: string
	body: {
		text: string
		html?: string
	}
	recipients: IncomingRecipient[]
}

const sortRecipients = (recipients: IncomingRecipient[]) =>
	[...recipients].sort((left, right) =>
		normalizeEmail(left.email).localeCompare(normalizeEmail(right.email)),
	)

export const buildDistributionPayloadCanonical = (
	data: DistributionPayload,
): string => {
	const recipients = sortRecipients(dedupeRecipients(data.recipients)).map(
		(recipient) => ({
			email: recipient.email,
			unsubscribeToken: recipient.unsubscribeToken ?? null,
		}),
	)

	return JSON.stringify({
		actor: data.actor ?? null,
		audienceSnapshot: data.audienceSnapshot ?? null,
		body: {
			html: data.body.html ?? null,
			text: data.body.text,
		},
		from: data.from,
		kind: data.kind,
		recipients,
		source: data.source,
		subject: data.subject,
		subscriptionKind: data.subscriptionKind ?? null,
	})
}

export const hashDistributionPayload = async (
	data: DistributionPayload,
): Promise<string> => {
	const canonical = buildDistributionPayloadCanonical(data)
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(canonical),
	)
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
}
