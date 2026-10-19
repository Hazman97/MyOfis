import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { AgentConfig, EditSuggestionsInput, PublishInfo, RenderInfo, SelfCheck, Transcript, WebPost } from "@agent-office/shared";

export interface ProjectPublish {
  url: string;
  secret_enc: string | null;
  secret_hint: string | null;
  /** From the site's GET endpoint, refreshed on "Test". */
  info: PublishInfo | null;
  checked_at: string | null;
}

// Timestamps are ISO-8601 text and JSON is stored as text: both stay portable to Cloudflare D1.
const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();
const bool = (name: string) => integer(name, { mode: "boolean" });
/** Whose data a row is (members, 2026-10-19). The owner's workspace is the fixed id "owner". */
const ws = () => text("workspace_id").notNull().default("owner");

/**
 * Rooms (owner request, 2026-10-19): "HQ" (id "owner", everything from before), rooms the owner
 * makes for a sub-business ("Sewa Baju") and shares with friends, and each member's personal room.
 * Agents in the owner's rooms run on the owner's AI, within the room's daily token limit.
 */
export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["hq", "room", "personal"] }).notNull().default("room"),
  /** Tokens per day the room may use on the owner's AI ("room" kind). */
  daily_token_budget: integer("daily_token_budget").notNull().default(200000),
  created_at: text("created_at").notNull().default(now),
});

/** Who (besides the owner, who sees every room) may enter a shared room. */
export const roomMembers = sqliteTable(
  "room_members",
  {
    workspace_id: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    created_at: text("created_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.workspace_id, t.user_id] })],
);

/** People who may log in (Cloudflare Access email). The owner is created from OWNER_EMAIL. */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull().default(""),
  role: text("role", { enum: ["owner", "member"] }).notNull().default("member"),
  workspace_id: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  disabled: bool("disabled").notNull().default(false),
  created_at: text("created_at").notNull().default(now),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: json<unknown>("value").notNull(),
});

export const runners = sqliteTable("runners", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  token_hash: text("token_hash").notNull(),
  last_seen_at: text("last_seen_at"),
  status: text("status", { enum: ["online", "offline"] }).notNull().default("offline"),
  capabilities: json<Record<string, unknown>>("capabilities"),
  created_at: text("created_at").notNull().default(now),
});

/** One-time pairing codes. Stored hashed; single use; short TTL. */
export const pairingCodes = sqliteTable("pairing_codes", {
  code_hash: text("code_hash").primaryKey(),
  expires_at: text("expires_at").notNull(),
  used_at: text("used_at"),
  runner_id: text("runner_id"),
});

/** LLM providers. Added beyond the spec so the owner can configure presets and custom endpoints. */
export const providers = sqliteTable(
  "providers",
  {
  id: text("id").primaryKey(),
  workspace_id: ws(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["anthropic", "openai", "google", "openai_compatible", "mock"] }).notNull(),
  base_url: text("base_url"),
  /** AES-256-GCM ciphertext (see crypto.ts). Never sent to the browser. */
  api_key_enc: text("api_key_enc"),
  api_key_hint: text("api_key_hint"),
  models: json<string[]>("models").notNull().default(sql`'[]'`),
  pricing: json<Record<string, { input_per_mtok: number; output_per_mtok: number }>>("pricing")
    .notNull()
    .default(sql`'{}'`),
  enabled: bool("enabled").notNull().default(true),
  created_at: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("providers_ws_slug").on(t.workspace_id, t.slug)],
);

export const agents = sqliteTable(
  "agents",
  {
  id: text("id").primaryKey(),
  workspace_id: ws(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default(""),
  sprite: text("sprite").notNull().default("default"),
  model: text("model").notNull(),
  /** Provider slug. */
  provider: text("provider").notNull(),
  system_prompt: text("system_prompt").notNull().default(""),
  tools: json<string[]>("tools").notNull().default(sql`'[]'`),
  /** Per-agent safety settings (AgentConfig: shell/read/http allowlists, max steps). Added beyond the spec. */
  config: json<AgentConfig>("config").notNull().default(sql`'{}'`),
  permission_level: text("permission_level", { enum: ["safe", "review"] }).notNull().default("safe"),
  daily_token_budget: integer("daily_token_budget").notNull().default(200000),
  runner_id: text("runner_id").references(() => runners.id, { onDelete: "set null" }),
  desk_x: integer("desk_x").notNull().default(0),
  desk_y: integer("desk_y").notNull().default(0),
  enabled: bool("enabled").notNull().default(true),
  created_at: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("agents_ws_slug").on(t.workspace_id, t.slug)],
);

/** Owner agents shared with a member's workspace: they run on the owner's provider, within a daily limit per member. */
export const agentShares = sqliteTable(
  "agent_shares",
  {
    agent_id: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    workspace_id: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    daily_token_budget: integer("daily_token_budget").notNull().default(50000),
    created_at: text("created_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.agent_id, t.workspace_id] })],
);

export const projects = sqliteTable(
  "projects",
  {
  id: text("id").primaryKey(),
  workspace_id: ws(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  brief_path: text("brief_path"),
  repo_url: text("repo_url"),
  live_url: text("live_url"),
  /** The website's publish endpoint (Publisher): URL, encrypted shared secret, what it accepts. */
  publish: json<ProjectPublish>("publish"),
  enabled: bool("enabled").notNull().default(true),
  },
  (t) => [uniqueIndex("projects_ws_slug").on(t.workspace_id, t.slug)],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    /** The workspace the work is for (a member using a shared agent: the member's). */
    workspace_id: ws(),
    agent_id: text("agent_id")
      .notNull()
      .references(() => agents.id),
    project_id: text("project_id").references(() => projects.id),
    type: text("type").notNull(),
    title: text("title").notNull(),
    input: json<Record<string, unknown>>("input").notNull().default(sql`'{}'`),
    trigger: text("trigger", { enum: ["manual", "schedule", "event", "handoff"] }).notNull(),
    parent_job_id: text("parent_job_id"),
    status: text("status", {
      enum: ["queued", "running", "waiting_approval", "done", "failed", "cancelled"],
    }).notNull(),
    created_at: text("created_at").notNull().default(now),
  },
  (t) => [index("jobs_status_idx").on(t.status, t.created_at), index("jobs_ws_idx").on(t.workspace_id, t.created_at)],
);

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    job_id: text("job_id")
      .notNull()
      .references(() => jobs.id),
    agent_id: text("agent_id")
      .notNull()
      .references(() => agents.id),
    runner_id: text("runner_id")
      .notNull()
      .references(() => runners.id),
    started_at: text("started_at").notNull().default(now),
    ended_at: text("ended_at"),
    status: text("status", { enum: ["running", "done", "failed", "cancelled"] }).notNull(),
    tokens_in: integer("tokens_in").notNull().default(0),
    tokens_out: integer("tokens_out").notNull().default(0),
    cost_usd: real("cost_usd").notNull().default(0),
    log_path: text("log_path"),
    /** Highest runner message seq applied; used to drop duplicates after reconnects. Added beyond the spec. */
    last_seq: integer("last_seq").notNull().default(-1),
    /** True once the runner confirmed it picked the run up. */
    accepted: bool("accepted").notNull().default(false),
  },
  (t) => [index("runs_job_idx").on(t.job_id), index("runs_status_idx").on(t.status)],
);

/** Append-only. Never UPDATE or DELETE rows here. */
export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ts: text("ts").notNull(),
    run_id: text("run_id"),
    agent_id: text("agent_id"),
    /** Who may see it: a workspace id, or null for everyone (runners, pause). */
    workspace_id: text("workspace_id"),
    type: text("type").notNull(),
    payload: json<Record<string, unknown>>("payload").notNull(),
  },
  (t) => [
    index("events_ts_idx").on(t.ts),
    index("events_agent_idx").on(t.agent_id, t.id),
    index("events_run_idx").on(t.run_id, t.id),
    index("events_ws_idx").on(t.workspace_id, t.id),
  ],
);

export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  run_id: text("run_id")
    .notNull()
    .references(() => runs.id),
  agent_id: text("agent_id")
    .notNull()
    .references(() => agents.id),
  action: text("action").notNull(),
  risk_level: text("risk_level", { enum: ["safe", "review", "dangerous"] }).notNull(),
  details: json<Record<string, unknown>>("details").notNull().default(sql`'{}'`),
  status: text("status", { enum: ["pending", "approved", "rejected", "expired"] }).notNull().default("pending"),
  decided_via: text("decided_via", { enum: ["web", "telegram"] }),
  decided_at: text("decided_at"),
  created_at: text("created_at").notNull().default(now),
});

export const schedules = sqliteTable("schedules", {
  id: text("id").primaryKey(),
  workspace_id: ws(),
  agent_id: text("agent_id")
    .notNull()
    .references(() => agents.id),
  cron: text("cron").notNull(),
  job_template: json<Record<string, unknown>>("job_template").notNull(),
  enabled: bool("enabled").notNull().default(true),
  last_run_at: text("last_run_at"),
});

export const featureLog = sqliteTable("feature_log", {
  id: text("id").primaryKey(),
  project_id: text("project_id")
    .notNull()
    .references(() => projects.id),
  title: text("title").notNull(),
  user_facing_note: text("user_facing_note").notNull(),
  source_pr_url: text("source_pr_url"),
  released_at: text("released_at").notNull().default(now),
  screenshot_path: text("screenshot_path"),
  announced: bool("announced").notNull().default(false),
});

export const contentDrafts = sqliteTable("content_drafts", {
  id: text("id").primaryKey(),
  workspace_id: ws(),
  project_id: text("project_id")
    .notNull()
    .references(() => projects.id),
  agent_id: text("agent_id")
    .notNull()
    .references(() => agents.id),
  platform: text("platform").notNull(),
  kind: text("kind").notNull(),
  body: text("body").notNull(),
  status: text("status", { enum: ["draft", "approved", "rejected", "edited", "published"] })
    .notNull()
    .default("draft"),
  owner_feedback: text("owner_feedback"),
  original_body: text("original_body").notNull(),
  created_at: text("created_at").notNull().default(now),
  // Added in Phase 4 (beyond the spec's columns): where it came from and the agent's own review.
  run_id: text("run_id"),
  feature_id: text("feature_id"),
  title: text("title").notNull().default(""),
  self_check: json<SelfCheck>("self_check"),
  decided_at: text("decided_at"),
  // Publisher (web_post drafts): the post fields, and the publish result.
  meta: json<WebPost>("meta"),
  published_url: text("published_url"),
  publish_error: text("publish_error"),
  /** Approved, but goes out at this time (ISO) instead of now; cleared once tried. */
  publish_at: text("publish_at"),
});

/**
 * Things agents want to save that wait for the owner (Phase 4.5, Hermes-style learning):
 * kind "skill" = a SKILL.md create/patch/delete; kind "memory" = memory ops when write approval is on.
 */
export const proposals = sqliteTable(
  "proposals",
  {
    id: text("id").primaryKey(),
    workspace_id: ws(),
    kind: text("kind", { enum: ["skill", "memory"] }).notNull(),
    agent_id: text("agent_id").notNull(),
    run_id: text("run_id"),
    /** Skill name, or the memory target ("memory" | "user"). */
    name: text("name").notNull(),
    action: text("action").notNull(),
    /** Full new SKILL.md, or the JSON memory ops. */
    content: text("content").notNull(),
    previous: text("previous"),
    reason: text("reason").notNull().default(""),
    status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
    error: text("error"),
    created_at: text("created_at").notNull().default(now),
    decided_at: text("decided_at"),
  },
  (t) => [index("proposals_status_idx").on(t.status, t.created_at)],
);

/** Files the owner sends in chat (photos, videos) and videos Editor renders. Stored under FILES_DIR/uploads/. */
export const uploads = sqliteTable("uploads", {
  id: text("id").primaryKey(),
  workspace_id: ws(),
  name: text("name").notNull(),
  content_type: text("content_type").notNull(),
  size: integer("size").notNull(),
  path: text("path").notNull(),
  /** Set when a run made the file (Editor's render); null for the owner's own uploads. */
  run_id: text("run_id"),
  /** For renders: the edit plan and source files, so the Video Studio can show and re-render it. */
  render: json<RenderInfo>("render"),
  /** Videos: the speech, word by word (whisper.cpp on the runner; video_transcribe). */
  transcript: json<Transcript>("transcript"),
  created_at: text("created_at").notNull().default(now),
});

/** Editor's edit options for a set of videos (tool suggest_edits); the chat and the Video Studio show them. */
export const editSuggestions = sqliteTable(
  "edit_suggestions",
  {
    id: text("id").primaryKey(),
    workspace_id: ws(),
    run_id: text("run_id").notNull(),
    /** The job's files in order (plan.clips[].video points into it). */
    attachments: json<{ id: string; name: string; content_type: string }[]>("attachments").notNull(),
    data: json<EditSuggestionsInput>("data").notNull(),
    created_at: text("created_at").notNull().default(now),
  },
  (t) => [index("edit_suggestions_run").on(t.run_id)],
);

/**
 * Project documents (owner request, 2026-10-19: a project assistant that knows every file of a
 * project: minutes, brochures, specs). The text is extracted on the owner's PC and indexed per
 * page in the FTS table `docs_index` (migration 0011, not managed by Drizzle).
 */
export const projectDocs = sqliteTable(
  "project_docs",
  {
    id: text("id").primaryKey(),
    workspace_id: ws(),
    project_id: text("project_id").references(() => projects.id),
    upload_id: text("upload_id").notNull(),
    title: text("title").notNull(),
    content_type: text("content_type").notNull(),
    pages: integer("pages").notNull().default(0),
    chars: integer("chars").notNull().default(0),
    /** Written by the assistant after reading it (summary, decisions, action items). */
    summary: text("summary").notNull().default(""),
    created_at: text("created_at").notNull().default(now),
  },
  (t) => [index("project_docs_ws_idx").on(t.workspace_id, t.created_at)],
);

/** What happened in a project: decisions, action items (who / when), meetings, risks, dates, notes. */
export const projectLog = sqliteTable(
  "project_log",
  {
    id: text("id").primaryKey(),
    workspace_id: ws(),
    project_id: text("project_id").references(() => projects.id),
    kind: text("kind", { enum: ["decision", "action", "meeting", "risk", "date", "note"] }).notNull(),
    text: text("text").notNull(),
    owner: text("owner").notNull().default(""),
    /** YYYY-MM-DD (Malaysia), for actions and dates. */
    due_date: text("due_date"),
    status: text("status", { enum: ["open", "done"] }).notNull().default("open"),
    source_doc_id: text("source_doc_id"),
    agent_id: text("agent_id"),
    created_at: text("created_at").notNull().default(now),
    done_at: text("done_at"),
  },
  (t) => [index("project_log_ws_idx").on(t.workspace_id, t.status, t.due_date)],
);
