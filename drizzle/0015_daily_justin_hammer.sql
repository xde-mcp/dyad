ALTER TABLE `apps` RENAME COLUMN "neon_branch_id" TO "neon_development_branch_id";--> statement-breakpoint
ALTER TABLE `apps` ADD `neon_preview_branch_id` text;