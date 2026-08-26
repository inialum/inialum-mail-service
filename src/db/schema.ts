import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from 'drizzle-orm/sqlite-core'

import {
	distributionKinds,
	distributionStatuses,
	recipientStatuses,
	subscriptionKinds,
} from './values'

export const distributions = sqliteTable(
	'distributions',
	{
		id: text('id').primaryKey(),
		kind: text('kind', { enum: distributionKinds }).notNull(),
		subscriptionKind: text('subscription_kind', {
			enum: subscriptionKinds,
		}),
		source: text('source').notNull(),
		actor: text('actor'),
		audienceSnapshot: text('audience_snapshot'),
		fromAddress: text('from_address').notNull(),
		subject: text('subject').notNull(),
		status: text('status', { enum: distributionStatuses })
			.notNull()
			.default('accepted'),
		requestedRecipients: integer('requested_recipients').notNull(),
		uniqueRecipients: integer('unique_recipients').notNull(),
		processedRecipients: integer('processed_recipients').notNull().default(0),
		sentRecipients: integer('sent_recipients').notNull().default(0),
		failedRecipients: integer('failed_recipients').notNull().default(0),
		idempotencyKey: text('idempotency_key'),
		createdAt: text('created_at').notNull(),
		startedAt: text('started_at'),
		completedAt: text('completed_at'),
	},
	(table) => [
		uniqueIndex('distributions_idempotency_key_unique').on(
			table.idempotencyKey,
		),
		index('distributions_created_at_idx').on(table.createdAt),
		index('distributions_status_source_idx').on(table.status, table.source),
	],
)

export const campaigns = sqliteTable(
	'campaigns',
	{
		id: text('id').primaryKey(),
		distributionId: text('distribution_id')
			.notNull()
			.references(() => distributions.id, { onDelete: 'cascade' }),
		status: text('status', { enum: distributionStatuses })
			.notNull()
			.default('accepted'),
		chunkCount: integer('chunk_count').notNull(),
		requestedRecipients: integer('requested_recipients').notNull(),
		uniqueRecipients: integer('unique_recipients').notNull(),
		processedRecipients: integer('processed_recipients').notNull().default(0),
		sentRecipients: integer('sent_recipients').notNull().default(0),
		failedRecipients: integer('failed_recipients').notNull().default(0),
		createdAt: text('created_at').notNull(),
		startedAt: text('started_at'),
		completedAt: text('completed_at'),
	},
	(table) => [index('campaigns_distribution_id_idx').on(table.distributionId)],
)

export const recipients = sqliteTable(
	'recipients',
	{
		id: text('id').primaryKey(),
		distributionId: text('distribution_id')
			.notNull()
			.references(() => distributions.id, { onDelete: 'cascade' }),
		campaignId: text('campaign_id')
			.notNull()
			.references(() => campaigns.id, { onDelete: 'cascade' }),
		email: text('email').notNull(),
		emailNormalized: text('email_normalized').notNull(),
		status: text('status', { enum: recipientStatuses })
			.notNull()
			.default('pending'),
		attemptCount: integer('attempt_count').notNull().default(0),
		providerMessageId: text('provider_message_id'),
		lastError: text('last_error'),
		duplicatePossible: integer('duplicate_possible', { mode: 'boolean' })
			.notNull()
			.default(false),
		unsubscribeToken: text('unsubscribe_token'),
		createdAt: text('created_at').notNull(),
		updatedAt: text('updated_at').notNull(),
	},
	(table) => [
		index('recipients_distribution_status_idx').on(
			table.distributionId,
			table.status,
		),
		index('recipients_campaign_id_idx').on(table.campaignId),
		index('recipients_email_normalized_idx').on(table.emailNormalized),
		uniqueIndex('recipients_campaign_email_unique').on(
			table.campaignId,
			table.emailNormalized,
		),
	],
)
