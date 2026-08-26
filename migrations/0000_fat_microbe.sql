CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`distribution_id` text NOT NULL,
	`status` text DEFAULT 'accepted' NOT NULL,
	`chunk_count` integer NOT NULL,
	`requested_recipients` integer NOT NULL,
	`unique_recipients` integer NOT NULL,
	`processed_recipients` integer DEFAULT 0 NOT NULL,
	`sent_recipients` integer DEFAULT 0 NOT NULL,
	`failed_recipients` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	FOREIGN KEY (`distribution_id`) REFERENCES `distributions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `campaigns_distribution_id_idx` ON `campaigns` (`distribution_id`);--> statement-breakpoint
CREATE TABLE `distributions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`subscription_kind` text,
	`source` text NOT NULL,
	`actor` text,
	`audience_snapshot` text,
	`from_address` text NOT NULL,
	`subject` text NOT NULL,
	`status` text DEFAULT 'accepted' NOT NULL,
	`requested_recipients` integer NOT NULL,
	`unique_recipients` integer NOT NULL,
	`processed_recipients` integer DEFAULT 0 NOT NULL,
	`sent_recipients` integer DEFAULT 0 NOT NULL,
	`failed_recipients` integer DEFAULT 0 NOT NULL,
	`idempotency_key` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `distributions_idempotency_key_unique` ON `distributions` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `distributions_created_at_idx` ON `distributions` (`created_at`);--> statement-breakpoint
CREATE INDEX `distributions_status_source_idx` ON `distributions` (`status`,`source`);--> statement-breakpoint
CREATE TABLE `recipients` (
	`id` text PRIMARY KEY NOT NULL,
	`distribution_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`email` text NOT NULL,
	`email_normalized` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`provider_message_id` text,
	`last_error` text,
	`duplicate_possible` integer DEFAULT false NOT NULL,
	`unsubscribe_token` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`distribution_id`) REFERENCES `distributions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipients_distribution_status_idx` ON `recipients` (`distribution_id`,`status`);--> statement-breakpoint
CREATE INDEX `recipients_campaign_id_idx` ON `recipients` (`campaign_id`);--> statement-breakpoint
CREATE INDEX `recipients_email_normalized_idx` ON `recipients` (`email_normalized`);--> statement-breakpoint
CREATE UNIQUE INDEX `recipients_campaign_email_unique` ON `recipients` (`campaign_id`,`email_normalized`);