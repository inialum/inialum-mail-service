import { describe, expect, test } from 'vitest'

import wrangler from '../../wrangler.json'
import {
	QUEUE_CONSUMER_MAX_BATCH_SIZE,
	QUEUE_CONSUMER_MAX_RETRIES,
	RECIPIENTS_PER_CHUNK,
} from '../constants/mail'

describe('wrangler Free + staging isolation contract', () => {
	test('queue consumer stays within Free external subrequest budget', () => {
		expect(QUEUE_CONSUMER_MAX_BATCH_SIZE).toBe(1)
		expect(RECIPIENTS_PER_CHUNK).toBeLessThanOrEqual(40)
		expect(wrangler.queues.consumers[0]?.max_batch_size).toBe(
			QUEUE_CONSUMER_MAX_BATCH_SIZE,
		)
		expect(wrangler.env.staging.queues.consumers[0]?.max_batch_size).toBe(
			QUEUE_CONSUMER_MAX_BATCH_SIZE,
		)
		expect(wrangler.queues.consumers[0]?.max_retries).toBe(
			QUEUE_CONSUMER_MAX_RETRIES,
		)
		expect(wrangler.env.staging.queues.consumers[0]?.max_retries).toBe(
			QUEUE_CONSUMER_MAX_RETRIES,
		)
	})

	test('staging R2 bucket is separated from production', () => {
		expect(wrangler.r2_buckets[0]?.bucket_name).toBe(
			'inialum-mail-service-logs',
		)
		expect(wrangler.env.staging.r2_buckets[0]?.bucket_name).toBe(
			'inialum-mail-service-logs-staging',
		)
		expect(wrangler.env.staging.r2_buckets[0]?.bucket_name).not.toBe(
			wrangler.r2_buckets[0]?.bucket_name,
		)
	})

	test('production and staging each bind a dedicated D1 database', () => {
		expect(wrangler.d1_databases[0]?.database_name).toBe('inialum-mail-db')
		expect(wrangler.env.staging.d1_databases[0]?.database_name).toBe(
			'inialum-mail-db-staging',
		)
		expect(wrangler.env.staging.d1_databases[0]?.database_id).not.toBe(
			wrangler.d1_databases[0]?.database_id,
		)
	})
})
