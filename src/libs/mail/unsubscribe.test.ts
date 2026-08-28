import { describe, expect, test } from 'vitest'

import {
	LIST_UNSUBSCRIBE_POST_VALUE,
	UNSUBSCRIBE_TOKEN_PLACEHOLDER,
} from '../../constants/unsubscribe'
import {
	applyUnsubscribeTokenPlaceholder,
	buildListUnsubscribeHeaders,
	buildMarketingSendContent,
	isMailQueueRecipient,
	parseQueueRecipient,
} from './unsubscribe'

describe('parseQueueRecipient', () => {
	test('accepts a legacy email string', () => {
		expect(parseQueueRecipient('user@example.com')).toEqual({
			email: 'user@example.com',
		})
		expect(isMailQueueRecipient('user@example.com')).toBe(true)
	})

	test('accepts an object with an optional unsubscribe token', () => {
		expect(
			parseQueueRecipient({
				email: 'user@example.com',
				unsubscribeToken: 'opaque-token',
			}),
		).toEqual({
			email: 'user@example.com',
			unsubscribeToken: 'opaque-token',
		})
		expect(parseQueueRecipient({ email: 'user@example.com' })).toEqual({
			email: 'user@example.com',
		})
	})

	test('rejects empty or invalid recipients', () => {
		expect(parseQueueRecipient('')).toBeNull()
		expect(parseQueueRecipient('   ')).toBeNull()
		expect(parseQueueRecipient({ email: '' })).toBeNull()
		expect(parseQueueRecipient({ email: 1 })).toBeNull()
		expect(parseQueueRecipient(null)).toBeNull()
		expect(isMailQueueRecipient(null)).toBe(false)
	})
})

describe('unsubscribe placeholder and headers', () => {
	const body = {
		text: `Open https://inialum.org/unsubscribe?token=${UNSUBSCRIBE_TOKEN_PLACEHOLDER}`,
		html: `<a href="https://inialum.org/unsubscribe?token=${UNSUBSCRIBE_TOKEN_PLACEHOLDER}">解除</a>`,
	}

	test('replaces the token placeholder in html and text', () => {
		const result = applyUnsubscribeTokenPlaceholder(body, 'abc.def')

		expect(result.placeholderFound).toBe(true)
		expect(result.body.text).toBe(
			'Open https://inialum.org/unsubscribe?token=abc.def',
		)
		expect(result.body.html).toBe(
			'<a href="https://inialum.org/unsubscribe?token=abc.def">解除</a>',
		)
	})

	test('builds RFC 8058 List-Unsubscribe headers', () => {
		expect(
			buildListUnsubscribeHeaders(
				'https://inialum.org/unsubscribe/one-click',
				'abc.def',
			),
		).toEqual([
			{
				name: 'List-Unsubscribe',
				value: '<https://inialum.org/unsubscribe/one-click?token=abc.def>',
			},
			{
				name: 'List-Unsubscribe-Post',
				value: LIST_UNSUBSCRIBE_POST_VALUE,
			},
		])
	})

	test('does not rewrite transactional bodies without a token', () => {
		const result = buildMarketingSendContent({
			body,
			unsubscribeBaseUrl: 'https://inialum.org/unsubscribe/one-click',
		})

		expect(result.headers).toBeUndefined()
		expect(result.body).toEqual(body)
		expect(result.placeholderMissing).toBe(false)
	})

	test('keeps sending when the placeholder is missing but still sets headers', () => {
		const result = buildMarketingSendContent({
			body: { text: 'no placeholder' },
			token: 'abc.def',
			unsubscribeBaseUrl: 'https://inialum.org/unsubscribe/one-click',
		})

		expect(result.placeholderMissing).toBe(true)
		expect(result.body.text).toBe('no placeholder')
		expect(result.headers).toHaveLength(2)
	})
})
