import type { SendApiRequestV1 } from '../api/v1/schema/send'

/**
 * Canonical payload for Idempotency-Key hashing.
 * Key order must match Phase 0 contracts.
 */
export const buildSendPayloadCanonical = (data: SendApiRequestV1): string =>
	JSON.stringify({
		body: {
			html: data.body.html ?? null,
			text: data.body.text,
		},
		from: data.from,
		subject: data.subject,
		to: data.to,
	})

export const hashSendPayload = async (
	data: SendApiRequestV1,
): Promise<string> => {
	const canonical = buildSendPayloadCanonical(data)
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(canonical),
	)
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
}
