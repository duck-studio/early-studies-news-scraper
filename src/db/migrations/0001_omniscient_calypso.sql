PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_headlines` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`headline` text NOT NULL,
	`snippet` text,
	`source` text NOT NULL,
	`raw_date` text,
	`normalized_date` text,
	`category` text,
	`publication_url` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`publication_url`) REFERENCES `publications`(`url`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_headlines`("id", "url", "headline", "snippet", "source", "raw_date", "normalized_date", "category", "publication_url", "created_at", "updated_at") SELECT "id", "url", "headline", "snippet", "source", "raw_date", "normalized_date", "category", "publication_url", "created_at", "updated_at" FROM `headlines`;--> statement-breakpoint
DROP TABLE `headlines`;--> statement-breakpoint
ALTER TABLE `__new_headlines` RENAME TO `headlines`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `headlines_url_unique` ON `headlines` (`url`);--> statement-breakpoint
CREATE INDEX `headlines_publication_url_idx` ON `headlines` (`publication_url`);--> statement-breakpoint
CREATE INDEX `headlines_normalized_date_idx` ON `headlines` (`normalized_date`);--> statement-breakpoint
CREATE INDEX `headlines_headline_idx` ON `headlines` (`headline`);--> statement-breakpoint
CREATE INDEX `headlines_headline_date_idx` ON `headlines` (`headline`,`normalized_date`);--> statement-breakpoint
CREATE INDEX `headlines_url_idx` ON `headlines` (`url`);--> statement-breakpoint
CREATE INDEX `headlines_category_idx` ON `headlines` (`category`);--> statement-breakpoint
ALTER TABLE `publications` DROP COLUMN `id`;