/** D1 table created and managed automatically by hono-idempotency. */
export const IDEMPOTENCY_TABLE = 'idempotency_keys'

/** TTL for reclaiming stale `processing` locks (ms). Must exceed SES timeout. */
export const IDEMPOTENCY_IN_PROGRESS_TTL_MS = 60_000

/** Logical replay window (ms). Bulk physical cleanup runs in the scheduled handler via store.purge(). */
export const IDEMPOTENCY_REPLAY_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** SES await timeout; keep below the in-progress TTL. */
export const IDEMPOTENCY_SES_TIMEOUT_MS = 45_000

export const IDEMPOTENCY_RETRY_AFTER_SECONDS = 5

/** Matches Phase 0 contract (library default is 256). */
export const IDEMPOTENCY_MAX_KEY_LENGTH = 255
