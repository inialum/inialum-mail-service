import { describe, expect, test } from 'vitest'

import { SESApiError } from '../error/applicationErrors'
import { isInvocationBudgetExhaustedError } from './invocationBudget'

describe('isInvocationBudgetExhaustedError', () => {
	test('detects Cloudflare subrequest budget errors', () => {
		expect(
			isInvocationBudgetExhaustedError(
				new Error('Too many subrequests by single Worker invocation'),
			),
		).toBe(true)
	})

	test('detects wrapped SESApiError causes', () => {
		const cause = new Error('Too many subrequests by single Worker invocation')
		expect(
			isInvocationBudgetExhaustedError(
				new SESApiError(cause.message, { cause }),
			),
		).toBe(true)
	})

	test('ignores unrelated SES failures', () => {
		expect(isInvocationBudgetExhaustedError(new Error('SES throttle'))).toBe(
			false,
		)
	})
})
