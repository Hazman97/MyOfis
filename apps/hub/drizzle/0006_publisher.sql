CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`path` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `content_drafts` ADD `meta` text;--> statement-breakpoint
ALTER TABLE `content_drafts` ADD `published_url` text;--> statement-breakpoint
ALTER TABLE `content_drafts` ADD `publish_error` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `publish` text;