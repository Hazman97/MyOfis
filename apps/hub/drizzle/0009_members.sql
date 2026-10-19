CREATE TABLE `agent_shares` (
	`agent_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`daily_token_budget` integer DEFAULT 50000 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`agent_id`, `workspace_id`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`workspace_id` text NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
DROP INDEX `agents_slug_unique`;--> statement-breakpoint
ALTER TABLE `agents` ADD `workspace_id` text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `agents_ws_slug` ON `agents` (`workspace_id`,`slug`);--> statement-breakpoint
DROP INDEX `projects_slug_unique`;--> statement-breakpoint
ALTER TABLE `projects` ADD `workspace_id` text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_ws_slug` ON `projects` (`workspace_id`,`slug`);--> statement-breakpoint
DROP INDEX `providers_slug_unique`;--> statement-breakpoint
ALTER TABLE `providers` ADD `workspace_id` text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `providers_ws_slug` ON `providers` (`workspace_id`,`slug`);--> statement-breakpoint
ALTER TABLE `content_drafts` ADD `workspace_id` text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `workspace_id` text;--> statement-breakpoint
CREATE INDEX `events_ws_idx` ON `events` (`workspace_id`,`id`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `workspace_id` text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
CREATE INDEX `jobs_ws_idx` ON `jobs` (`workspace_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `proposals` ADD `workspace_id` text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE `schedules` ADD `workspace_id` text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE `uploads` ADD `workspace_id` text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
-- The owner's workspace (every existing row belongs to it) and the owner's past events.
INSERT OR IGNORE INTO `workspaces` (`id`, `name`) VALUES ('owner', 'Owner');--> statement-breakpoint
-- One-time backfill of the new column (the append-only rule covers event content; this only labels who may see them).
UPDATE `events` SET `workspace_id` = 'owner' WHERE `type` NOT IN ('runner.online', 'runner.offline', 'system.paused');--> statement-breakpoint
-- session_search gets a workspace column; the hub refills the index at boot (backfillIndex).
DROP TABLE IF EXISTS `search_index`;--> statement-breakpoint
CREATE VIRTUAL TABLE `search_index` USING fts5(
	`run_id` UNINDEXED,
	`agent_id` UNINDEXED,
	`job_type` UNINDEXED,
	`ts` UNINDEXED,
	`workspace_id` UNINDEXED,
	`title`,
	`body`,
	tokenize = 'unicode61 remove_diacritics 2'
);
