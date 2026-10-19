CREATE TABLE `project_docs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT 'owner' NOT NULL,
	`project_id` text,
	`upload_id` text NOT NULL,
	`title` text NOT NULL,
	`content_type` text NOT NULL,
	`pages` integer DEFAULT 0 NOT NULL,
	`chars` integer DEFAULT 0 NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `project_docs_ws_idx` ON `project_docs` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `project_log` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT 'owner' NOT NULL,
	`project_id` text,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`owner` text DEFAULT '' NOT NULL,
	`due_date` text,
	`status` text DEFAULT 'open' NOT NULL,
	`source_doc_id` text,
	`agent_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`done_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `project_log_ws_idx` ON `project_log` (`workspace_id`,`status`,`due_date`);--> statement-breakpoint
-- Full-text index over project documents, one row per page (Project Assistant). Not managed by drizzle-kit.
CREATE VIRTUAL TABLE IF NOT EXISTS `docs_index` USING fts5(
	`doc_id` UNINDEXED,
	`workspace_id` UNINDEXED,
	`project_id` UNINDEXED,
	`page` UNINDEXED,
	`title`,
	`body`,
	tokenize = 'unicode61 remove_diacritics 2'
);
