CREATE TABLE `versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`app_id` integer NOT NULL,
	`commit_hash` text NOT NULL,
	`is_favorite` integer DEFAULT false NOT NULL,
	`neon_branch_id` text,
	`db_timestamp` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `versions_app_id_idx` ON `versions` (`app_id`);--> statement-breakpoint
CREATE INDEX `versions_commit_hash_idx` ON `versions` (`commit_hash`);--> statement-breakpoint
CREATE INDEX `versions_created_at_idx` ON `versions` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `versions_app_commit_unique` ON `versions` (`app_id`,`commit_hash`);--> statement-breakpoint
DROP TABLE `favorites`;--> statement-breakpoint
DROP TABLE `snapshots`;