import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const mailLogs = sqliteTable('mail_logs', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	fromAddress: text('from_address').notNull(),
	toAddress: text('to_address').notNull(),
	subject: text('subject').notNull(),
	status: text('status', { enum: ['success', 'failed'] }).notNull(),
	statusCode: integer('status_code'),
	errorMessage: text('error_message'),
	provider: text('provider', { enum: ['ses', 'sendgrid'] }).notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.$defaultFn(() => new Date())
		.notNull(),
})

// Types inferred from the schema
export type MailLog = typeof mailLogs.$inferSelect
export type NewMailLog = typeof mailLogs.$inferInsert
