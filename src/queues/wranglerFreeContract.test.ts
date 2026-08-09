import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import {
	QUEUE_CONSUMER_MAX_BATCH_SIZE,
	RECIPIENTS_PER_CHUNK,
} from '../constants/mail'

describe('wrangler queue consumer Free contract', () => {
	test('keeps max_batch_size=1 for production and staging consumers', () => {
		const wrangler = JSON.parse(
			readFileSync(join(process.cwd(), 'wrangler.json'), 'utf8'),
		) as {
			queues: { consumers: Array<{ max_batch_size: number }> }
			env: {
				staging: {
					queues: { consumers: Array<{ max_batch_size: number }> }
				}
			}
		}

		expect(QUEUE_CONSUMER_MAX_BATCH_SIZE).toBe(1)
		expect(RECIPIENTS_PER_CHUNK).toBeLessThanOrEqual(40)
		expect(wrangler.queues.consumers[0]?.max_batch_size).toBe(1)
		expect(wrangler.env.staging.queues.consumers[0]?.max_batch_size).toBe(1)
	})
})
