-- Full-text index over past work (Hermes-style session_search): one row per finished run.
-- Filled by the hub when a run ends (and backfilled at boot). Not managed by drizzle-kit.
CREATE VIRTUAL TABLE IF NOT EXISTS `search_index` USING fts5(
	`run_id` UNINDEXED,
	`agent_id` UNINDEXED,
	`job_type` UNINDEXED,
	`ts` UNINDEXED,
	`title`,
	`body`,
	tokenize = 'unicode61 remove_diacritics 2'
);
