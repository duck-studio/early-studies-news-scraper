CREATE TABLE `headlines` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`headline` text NOT NULL,
	`snippet` text,
	`source` text NOT NULL,
	`raw_date` text,
	`normalized_date` text,
	`category` text,
	`publication_id` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`publication_id`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `headlines_url_unique` ON `headlines` (`url`);--> statement-breakpoint
CREATE INDEX `headlines_publication_id_idx` ON `headlines` (`publication_id`);--> statement-breakpoint
CREATE INDEX `headlines_normalized_date_idx` ON `headlines` (`normalized_date`);--> statement-breakpoint
CREATE INDEX `headlines_headline_idx` ON `headlines` (`headline`);--> statement-breakpoint
CREATE INDEX `headlines_headline_date_idx` ON `headlines` (`headline`,`normalized_date`);--> statement-breakpoint
CREATE INDEX `headlines_url_idx` ON `headlines` (`url`);--> statement-breakpoint
CREATE INDEX `headlines_category_idx` ON `headlines` (`category`);--> statement-breakpoint
CREATE TABLE `publication_regions` (
	`publication_id` text NOT NULL,
	`region_id` text NOT NULL,
	PRIMARY KEY(`publication_id`, `region_id`),
	FOREIGN KEY (`publication_id`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`region_id`) REFERENCES `regions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pub_regions_pub_id_idx` ON `publication_regions` (`publication_id`);--> statement-breakpoint
CREATE INDEX `pub_regions_region_id_idx` ON `publication_regions` (`region_id`);--> statement-breakpoint
CREATE TABLE `publications` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`category` text,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publications_url_idx` ON `publications` (`url`);--> statement-breakpoint
CREATE INDEX `publications_category_idx` ON `publications` (`category`);--> statement-breakpoint
CREATE TABLE `regions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `regions_name_idx` ON `regions` (`name`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`sync_enabled` integer DEFAULT true NOT NULL,
	`sync_frequency` text DEFAULT 'daily' NOT NULL,
	`default_region` text DEFAULT 'UK' NOT NULL,
	`serper_api_key` text,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger_type` text NOT NULL,
	`status` text DEFAULT 'started' NOT NULL,
	`started_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`finished_at` integer,
	`date_range_option` text,
	`custom_tbs` text,
	`max_queries_per_publication` integer,
	`summary_publications_fetched` integer,
	`summary_total_headlines_fetched` integer,
	`summary_headlines_within_range` integer,
	`summary_workflows_triggered` integer,
	`error_message` text
);
--> statement-breakpoint
CREATE INDEX `sync_runs_started_at_idx` ON `sync_runs` (`started_at`);--> statement-breakpoint
CREATE INDEX `sync_runs_status_idx` ON `sync_runs` (`status`);--> statement-breakpoint
CREATE INDEX `sync_runs_trigger_type_idx` ON `sync_runs` (`trigger_type`);