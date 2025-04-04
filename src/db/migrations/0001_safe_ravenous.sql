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
	`summary_workflow_errors` integer,
	`error_message` text
);
--> statement-breakpoint
CREATE INDEX `sync_runs_started_at_idx` ON `sync_runs` (`started_at`);--> statement-breakpoint
CREATE INDEX `sync_runs_status_idx` ON `sync_runs` (`status`);--> statement-breakpoint
CREATE INDEX `sync_runs_trigger_type_idx` ON `sync_runs` (`trigger_type`);