CREATE TABLE `edit_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT 'owner' NOT NULL,
	`run_id` text NOT NULL,
	`attachments` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `edit_suggestions_run` ON `edit_suggestions` (`run_id`);--> statement-breakpoint
ALTER TABLE `uploads` ADD `transcript` text;