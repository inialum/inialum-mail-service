import {
	LIST_UNSUBSCRIBE_POST_VALUE,
	UNSUBSCRIBE_TOKEN_PLACEHOLDER,
} from '../../constants/unsubscribe'
import type { MailHeader } from '../../types/Mail'
import type { MailQueueRecipient } from '../../types/MailQueueMessage'

export type ParsedQueueRecipient = {
	email: string
	unsubscribeToken?: string
}

export const parseQueueRecipient = (
	value: unknown,
): ParsedQueueRecipient | null => {
	if (typeof value === 'string') {
		const email = value.trim()
		return email ? { email } : null
	}

	if (!value || typeof value !== 'object' || !('email' in value)) {
		return null
	}

	const emailValue = (value as { email: unknown }).email
	if (typeof emailValue !== 'string') {
		return null
	}

	const email = emailValue.trim()
	if (!email) {
		return null
	}

	const tokenValue = (value as { unsubscribeToken?: unknown }).unsubscribeToken
	if (typeof tokenValue !== 'string' || tokenValue.length === 0) {
		return { email }
	}

	return {
		email,
		unsubscribeToken: tokenValue,
	}
}

export const isMailQueueRecipient = (
	value: unknown,
): value is MailQueueRecipient => parseQueueRecipient(value) !== null

export const applyUnsubscribeTokenPlaceholder = (
	body: { text: string; html?: string },
	token: string,
): { body: { text: string; html?: string }; placeholderFound: boolean } => {
	const placeholderFound =
		body.text.includes(UNSUBSCRIBE_TOKEN_PLACEHOLDER) ||
		Boolean(body.html?.includes(UNSUBSCRIBE_TOKEN_PLACEHOLDER))

	return {
		placeholderFound,
		body: {
			text: body.text.replaceAll(UNSUBSCRIBE_TOKEN_PLACEHOLDER, token),
			html: body.html?.replaceAll(UNSUBSCRIBE_TOKEN_PLACEHOLDER, token),
		},
	}
}

export const buildListUnsubscribeHeaders = (
	unsubscribeBaseUrl: string,
	token: string,
): MailHeader[] => {
	const url = new URL(unsubscribeBaseUrl)
	url.searchParams.set('token', token)

	return [
		{
			name: 'List-Unsubscribe',
			value: `<${url.toString()}>`,
		},
		{
			name: 'List-Unsubscribe-Post',
			value: LIST_UNSUBSCRIBE_POST_VALUE,
		},
	]
}

export const buildMarketingSendContent = ({
	body,
	token,
	unsubscribeBaseUrl,
}: {
	body: { text: string; html?: string }
	token?: string
	unsubscribeBaseUrl?: string
}): {
	body: { text: string; html?: string }
	headers?: MailHeader[]
	placeholderMissing: boolean
} => {
	if (!token) {
		return {
			body,
			placeholderMissing: false,
		}
	}

	const substituted = applyUnsubscribeTokenPlaceholder(body, token)
	const headers = unsubscribeBaseUrl
		? buildListUnsubscribeHeaders(unsubscribeBaseUrl, token)
		: undefined

	return {
		body: substituted.body,
		headers,
		placeholderMissing: !substituted.placeholderFound,
	}
}
