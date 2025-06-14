CREATE TABLE `mail_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_address` text NOT NULL,
	`to_address` text NOT NULL,
	`subject` text NOT NULL,
	`status` text NOT NULL,
	`status_code` integer,
	`error_message` text,
	`provider` text NOT NULL,
	`created_at` integer NOT NULL
);
