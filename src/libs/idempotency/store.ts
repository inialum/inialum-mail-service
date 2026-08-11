import type { IdempotencyStore, StoredResponse } from 'hono-idempotency'
import {
	type D1DatabaseLike,
	d1Store,
} from 'hono-idempotency/stores/cloudflare-d1'

import {
	IDEMPOTENCY_IN_PROGRESS_TTL_MS,
	IDEMPOTENCY_REPLAY_TTL_MS,
	IDEMPOTENCY_TABLE,
} from '../../constants/idempotency'

export type MailIdempotencyStore = IdempotencyStore & {
	/** Persist an ambiguous response when hono-idempotency next requests deletion. */
	completeOnNextDelete: (response: StoredResponse) => void
}

/**
 * D1 store for hono-idempotency with three Phase 0 extras:
 * - reclaim stuck `processing` rows after the in-progress TTL (Worker kill / hang)
 * - delete TTL-expired primary keys before lock so replay expiry can reuse a key
 * - replay an ambiguous timeout response instead of allowing an unsafe resend
 */
export const createMailIdempotencyStore = (
	database: D1DatabaseLike,
): MailIdempotencyStore => {
	const inner = d1Store({
		database,
		tableName: IDEMPOTENCY_TABLE,
		ttl: IDEMPOTENCY_REPLAY_TTL_MS / 1000,
	})

	const replayThreshold = () => Date.now() - IDEMPOTENCY_REPLAY_TTL_MS
	const processingThreshold = () => Date.now() - IDEMPOTENCY_IN_PROGRESS_TTL_MS
	let innerInitialized = false
	let completionOnDelete: StoredResponse | undefined

	const getInnerRecord = async (key: string) => {
		const record = await inner.get(key)
		innerInitialized = true
		return record
	}

	const ensureInnerInitialized = async (key: string) => {
		if (!innerInitialized) {
			await getInnerRecord(key)
		}
	}

	const deleteExpiredRow = async (key: string) => {
		return database
			.prepare(
				`DELETE FROM ${IDEMPOTENCY_TABLE} WHERE key = ? AND created_at < ?`,
			)
			.bind(key, replayThreshold())
			.run()
	}

	const deleteStaleProcessingRow = async (key: string) => {
		return database
			.prepare(
				`DELETE FROM ${IDEMPOTENCY_TABLE} WHERE key = ? AND status = ? AND created_at <= ?`,
			)
			.bind(key, 'processing', processingThreshold())
			.run()
	}

	return {
		async get(key) {
			const record = await getInnerRecord(key)
			if (
				record?.status === 'processing' &&
				Date.now() - record.createdAt >= IDEMPOTENCY_IN_PROGRESS_TTL_MS
			) {
				const result = await deleteStaleProcessingRow(key)
				if (result.meta.changes > 0) {
					return undefined
				}
				return getInnerRecord(key)
			}
			return record
		},
		async lock(key, record) {
			await ensureInnerInitialized(key)
			await deleteExpiredRow(key)
			await deleteStaleProcessingRow(key)
			return inner.lock(key, record)
		},
		complete: (key, response) => inner.complete(key, response),
		async delete(key) {
			if (completionOnDelete) {
				const response = completionOnDelete
				completionOnDelete = undefined
				await inner.complete(key, response)
				return
			}
			await inner.delete(key)
		},
		purge: () => inner.purge(),
		completeOnNextDelete(response) {
			completionOnDelete = response
		},
	}
}
