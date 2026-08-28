/** Child campaign size. Matches the legacy POST /send-multiple recipient cap. */
export const RECIPIENTS_PER_CAMPAIGN = 400

/** Phase 5 POST /distributions unique-recipient cap (Workers Free CPU). */
export const MAX_DISTRIBUTION_RECIPIENTS = 800

export const HISTORY_RETENTION_MS = 365 * 24 * 60 * 60 * 1000

/** Keep in sync with wrangler.json triggers.crons. JST 02:00. */
export const MAIL_CRON_EXPRESSION = '0 17 * * *'

/** D1 bound-parameter budget is 100; each recipient row has 13 columns. */
export const RECIPIENTS_PER_INSERT = 6

export const D1_MAX_BATCH_STATEMENTS = 100

export const DEFAULT_LIST_LIMIT = 20

export const MAX_LIST_LIMIT = 100
