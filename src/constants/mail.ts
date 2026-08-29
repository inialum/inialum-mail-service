export const DEFAULT_MAIL_FROM_NAME = 'INIAD同窓会「INIALUM」'

export const LOCAL_SES_API_ENDPOINT = 'http://localhost:8005'

/**
 * Workers Free external subrequest budget is 50 per invocation.
 *
 * Queue consumer contract (production / staging):
 * - wrangler queues consumers max_batch_size = 1
 * - RECIPIENTS_PER_CHUNK ≤ 40 (usual SES sends: 1 × 40 × maxAttempts)
 * - queue consumer SES SDK maxAttempts = 1 (no SDK auto-retry)
 *
 * Leave headroom for best-effort error notification and other outbound calls.
 * Do not size the budget from chunk × batch alone while SDK retries are enabled.
 */
export const RECIPIENTS_PER_CHUNK = 40

/** Keep in sync with wrangler.json queues.*.consumers[].max_batch_size. */
export const QUEUE_CONSUMER_MAX_BATCH_SIZE = 1

/** Keep in sync with wrangler.json queues.*.consumers[].max_retries. */
export const QUEUE_CONSUMER_MAX_RETRIES = 5

/** SES SDK maxAttempts for the queue consumer only (single-send API keeps SDK default). */
export const QUEUE_CONSUMER_SES_MAX_ATTEMPTS = 1

/** Delay before the first (and each follow-up) send-progress watchdog check. */
export const WATCHDOG_DELAY_SECONDS = 300
