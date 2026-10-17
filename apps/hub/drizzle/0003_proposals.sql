CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`agent_id` text NOT NULL,
	`run_id` text,
	`name` text NOT NULL,
	`action` text NOT NULL,
	`content` text NOT NULL,
	`previous` text,
	`reason` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`decided_at` text
);
--> statement-breakpoint
CREATE INDEX `proposals_status_idx` ON `proposals` (`status`,`created_at`);