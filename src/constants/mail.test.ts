import { describe, expect, test } from 'vitest'

import {
	QUEUE_CONSUMER_MAX_BATCH_SIZE,
	QUEUE_CONSUMER_MAX_RETRIES,
	QUEUE_CONSUMER_SES_MAX_ATTEMPTS,
	RECIPIENTS_PER_CHUNK,
} from './mail'

describe('Workers Free mail delivery constants', () => {
	test('keeps queue consumer batch size at 1', () => {
		expect(QUEUE_CONSUMER_MAX_BATCH_SIZE).toBe(1)
	})

	test('keeps recipients per chunk within the Free external-subrequest budget', () => {
		expect(RECIPIENTS_PER_CHUNK).toBeLessThanOrEqual(40)
		expect(RECIPIENTS_PER_CHUNK).toBeGreaterThan(0)
	})

	test('disables SES SDK retries for the queue consumer', () => {
		expect(QUEUE_CONSUMER_SES_MAX_ATTEMPTS).toBe(1)
	})

	test('caps queue retries before DLQ delivery', () => {
		expect(QUEUE_CONSUMER_MAX_RETRIES).toBe(5)
	})
})
