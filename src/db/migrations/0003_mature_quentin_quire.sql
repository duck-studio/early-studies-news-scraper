CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`sync_enabled` integer DEFAULT true NOT NULL,
	`sync_frequency` text DEFAULT 'daily' NOT NULL,
	`default_region` text DEFAULT 'UK' NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now'))
);
