ALTER TABLE `content_drafts` ADD `run_id` text;--> statement-breakpoint
ALTER TABLE `content_drafts` ADD `feature_id` text;--> statement-breakpoint
ALTER TABLE `content_drafts` ADD `title` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `content_drafts` ADD `self_check` text;--> statement-breakpoint
ALTER TABLE `content_drafts` ADD `decided_at` text;