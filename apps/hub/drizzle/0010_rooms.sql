CREATE TABLE `room_members` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `workspaces` ADD `kind` text DEFAULT 'room' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `daily_token_budget` integer DEFAULT 200000 NOT NULL;--> statement-breakpoint
-- Everything from before is the "HQ" room; members' existing workspaces are their personal rooms.
UPDATE `workspaces` SET `kind` = 'hq', `name` = 'HQ' WHERE `id` = 'owner';--> statement-breakpoint
UPDATE `workspaces` SET `kind` = 'personal' WHERE `id` IN (SELECT `workspace_id` FROM `users`);
