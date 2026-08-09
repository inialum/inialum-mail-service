import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import {
	QUEUE_CONSUMER_MAX_BATCH_SIZE,
	QUEUE_CONSUMER_MAX_RETRIES,
	RECIPIENTS_PER_CHUNK,
} from '../constants/mail'

describe('wrangler queue consumer Free contract', () => {
	test('keeps production and staging consumers aligned with the Free contract', () => {
		const wrangler = JSON.parse(
			readFileSync(join(process.cwd(), 'wrangler.json'), 'utf8'),
		) as {
			queues: {
				consumers: Array<{ max_batch_size: number; max_retries: number }>
			}
			env: {
				staging: {
					queues: {
						consumers: Array<{
							max_batch_size: number
							max_retries: number
						}>
					}
				}
			}
		}

		expect(QUEUE_CONSUMER_MAX_BATCH_SIZE).toBe(1)
		expect(RECIPIENTS_PER_CHUNK).toBeLessThanOrEqual(40)
		expect(wrangler.queues.consumers[0]?.max_batch_size).toBe(1)
		expect(wrangler.env.staging.queues.consumers[0]?.max_batch_size).toBe(1)
		expect(wrangler.queues.consumers[0]?.max_retries).toBe(
			QUEUE_CONSUMER_MAX_RETRIES,
		)
		expect(wrangler.env.staging.queues.consumers[0]?.max_retries).toBe(
			QUEUE_CONSUMER_MAX_RETRIES,
		)
	})
})
