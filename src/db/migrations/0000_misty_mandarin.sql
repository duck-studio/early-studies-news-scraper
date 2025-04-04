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
	FOREIGN KEY (`publication_id`) REFERENCES `publications`(`url`) ON UPDATE no action ON DELETE cascade
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
	`publication_url` text NOT NULL,
	`region_name` text NOT NULL,
	PRIMARY KEY(`publication_url`, `region_name`),
	FOREIGN KEY (`publication_url`) REFERENCES `publications`(`url`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`region_name`) REFERENCES `regions`(`name`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pub_regions_pub_url_idx` ON `publication_regions` (`publication_url`);--> statement-breakpoint
CREATE INDEX `pub_regions_region_name_idx` ON `publication_regions` (`region_name`);--> statement-breakpoint
CREATE TABLE `publications` (
	`id` text,
	`name` text NOT NULL,
	`url` text PRIMARY KEY NOT NULL,
	`category` text,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE INDEX `publications_category_idx` ON `publications` (`category`);--> statement-breakpoint
CREATE TABLE `regions` (
	`name` text PRIMARY KEY NOT NULL
);
