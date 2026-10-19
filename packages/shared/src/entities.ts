import { z } from "zod";

export const TIMEZONE = "Asia/Kuala_Lumpur";

export const JobStatus = z.enum(["queued", "running", "waiting_approval", "done", "failed", "cancelled"]);
export type JobStatus = z.infer<typeof JobStatus>;

export const RunStatus = z.enum(["running", "done", "failed", "cancelled"]);
export type RunStatus = z.infer<typeof RunStatus>;

export const JobTrigger = z.enum(["manual", "schedule", "event", "handoff"]);
export type JobTrigger = z.infer<typeof JobTrigger>;

/** Used by the office view to decide what a character does while a tool runs. */
export const ToolCategory = z.enum([
  "think",
  "code",
  "shell",
  "search",
  "read_docs",
  "browser",
  "git",
  "write",
  "notify",
  "meeting",
]);
export type ToolCategory = z.infer<typeof ToolCategory>;

export const RiskLevel = z.enum(["safe", "review", "dangerous"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

/** Highest risk level an agent may perform without asking. `dangerous` always asks. */
export const PermissionLevel = z.enum(["safe", "review"]);
export type PermissionLevel = z.infer<typeof PermissionLevel>;

export const ProviderKind = z.enum(["anthropic", "openai", "google", "openai_compatible", "mock"]);
export type ProviderKind = z.infer<typeof ProviderKind>;

export const RunnerStatus = z.enum(["online", "offline"]);
export type RunnerStatus = z.infer<typeof RunnerStatus>;

const slug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and dashes only");

export const ModelPricing = z.object({
  input_per_mtok: z.number().nonnegative(),
  output_per_mtok: z.number().nonnegative(),
});
export type ModelPricing = z.infer<typeof ModelPricing>;

// ---------- Agents ----------

/** Per-agent safety settings (spec §7). Added beyond the spec's agent columns. */
/**
 * How the owner likes this agent to work (owner request: "setup agent ikut keinginan user").
 * Separate from the system prompt (the agent's role): set from the agent panel with a few
 * choices and free notes, and always placed after the role so it wins on style.
 */
export const AgentPreferences = z.object({
  language: z.enum(["auto", "ms", "en", "manglish"]).default("auto"),
  tone: z.enum(["auto", "casual", "friendly", "professional", "direct"]).default("auto"),
  length: z.enum(["auto", "short", "detailed"]).default("auto"),
  emoji: z.enum(["auto", "none", "some"]).default("auto"),
  format: z.enum(["auto", "bullets", "paragraphs"]).default("auto"),
  /** Anything else, in the owner's words ("always end with a next step", "call me boss"). */
  notes: z.string().max(1500).default(""),
});
export type AgentPreferences = z.infer<typeof AgentPreferences>;

const PREF_TEXT = {
  language: { ms: "Reply in Bahasa Melayu.", en: "Reply in English.", manglish: "Reply in casual Malaysian English mixed with Malay (Manglish), like a Malaysian colleague." },
  tone: { casual: "Keep the tone casual and relaxed.", friendly: "Be warm and friendly.", professional: "Keep the tone professional and polished.", direct: "Be direct: no small talk, get to the point." },
  length: { short: "Keep replies short: a few lines unless asked for more.", detailed: "Give thorough, detailed replies with explanations." },
  emoji: { none: "Do not use emoji.", some: "A few emoji are welcome where they fit." },
  format: { bullets: "Prefer bullet points over long paragraphs.", paragraphs: "Prefer flowing paragraphs over bullet lists." },
} as const;

/** The preferences as a prompt section, or "" when everything is on auto. */
export function preferencesPrompt(p: Partial<AgentPreferences> | undefined): string {
  if (!p) return "";
  const lines: string[] = [];
  for (const key of ["language", "tone", "length", "emoji", "format"] as const) {
    const v = p[key];
    if (v && v !== "auto") lines.push(`- ${(PREF_TEXT[key] as Record<string, string>)[v]}`);
  }
  const notes = p.notes?.trim();
  if (notes) lines.push(`- The owner also said: "${notes}"`);
  if (!lines.length) return "";
  return `\n\n## How the owner wants you to work (set by the owner; follow these over the style hints above, but never over safety rules)\n${lines.join("\n")}`;
}

export const AgentConfig = z.object({
  /** Command prefixes that run without approval, e.g. "bun test", "git status". Everything else asks. */
  shell_allowlist: z.array(z.string().min(1)).default([]),
  /** Extra absolute paths the agent may READ outside its workspace. Secrets are still blocked. */
  read_paths: z.array(z.string().min(1)).default([]),
  /** Hosts the agent may send read-only HTTP requests to (e.g. "ekadkahwin.com"). Empty = any host. */
  http_allowlist: z.array(z.string().min(1)).default([]),
  /** Upper bound on model <-> tool round trips per run. */
  max_steps: z.number().int().min(1).max(200).default(30),
  /**
   * Which engine runs the agent. "ai-sdk": our own tool loop. "opencode": OpenCode (opencode.ai) does the
   * coding in a cloned repo; Agent Office keeps permissions/approvals and does commit, push and PR itself.
   */
  runtime: z.enum(["ai-sdk", "opencode"]).default("ai-sdk"),
  /** After big jobs (and every 5th chat message) ask the agent what is worth saving to memory or skills (Hermes-style review). */
  self_review: z.boolean().default(true),
  preferences: AgentPreferences.prefault({}),
  /** Which skills from the library this agent sees: "all" (also new ones), or only these names. */
  skills: z.union([z.literal("all"), z.array(z.string().max(64)).max(500)]).default("all"),
});
export type AgentConfig = z.infer<typeof AgentConfig>;

/** The skills an agent gets from the library (its config.skills). */
export const skillsFor = <T extends { name: string }>(config: { skills?: AgentConfig["skills"] }, all: T[]): T[] =>
  !config.skills || config.skills === "all" ? all : all.filter((s) => (config.skills as string[]).includes(s.name));

export const AgentInput = z.object({
  slug,
  name: z.string().min(1).max(80),
  role: z.string().max(80).default(""),
  sprite: z.string().max(200).default("default"),
  provider: slug,
  model: z.string().min(1).max(200),
  system_prompt: z.string().max(50_000).default(""),
  tools: z.array(z.string()).default([]),
  config: AgentConfig.default(AgentConfig.parse({})),
  permission_level: PermissionLevel.default("safe"),
  daily_token_budget: z.number().int().nonnegative().default(200_000),
  runner_id: z.string().nullable().default(null),
  desk_x: z.number().int().default(0),
  desk_y: z.number().int().default(0),
  enabled: z.boolean().default(true),
});
export type AgentInput = z.input<typeof AgentInput>;

/** The owner's workspace id. Every member has their own workspace (2026-10-19). */
export const OWNER_WORKSPACE = "owner";

export const Agent = AgentInput.extend({
  id: z.string(),
  created_at: z.string(),
  /** Whose agent it is. */
  workspace_id: z.string().default(OWNER_WORKSPACE),
  /** Set in a member's list for the owner's agents shared with them (read-only, the owner's AI pays). */
  shared: z.boolean().optional(),
});
export type Agent = z.infer<typeof Agent>;

export const AgentPatch = AgentInput.partial();

// ---------- Jobs / runs ----------

export const JobInput = z.object({
  agent_id: z.string().min(1),
  project_id: z.string().nullable().default(null),
  type: z.string().min(1).max(64).default("task"),
  title: z.string().min(1).max(200),
  input: z.record(z.string(), z.unknown()).default({}),
  trigger: JobTrigger.default("manual"),
  parent_job_id: z.string().nullable().default(null),
});
export type JobInput = z.input<typeof JobInput>;

export const Job = JobInput.extend({
  id: z.string(),
  workspace_id: z.string().default(OWNER_WORKSPACE),
  status: JobStatus,
  created_at: z.string(),
});
export type Job = z.infer<typeof Job>;

export const Run = z.object({
  id: z.string(),
  job_id: z.string(),
  agent_id: z.string(),
  runner_id: z.string(),
  started_at: z.string(),
  ended_at: z.string().nullable(),
  status: RunStatus,
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  cost_usd: z.number(),
  log_path: z.string().nullable(),
});
export type Run = z.infer<typeof Run>;

// ---------- Projects (minimal in Phase 2; briefs + feature log arrive in Phase 4) ----------

const optionalUrl = z
  .string()
  .url()
  .nullable()
  .or(z.literal("").transform(() => null))
  .default(null);

export const ProjectInput = z.object({
  slug,
  name: z.string().min(1).max(120),
  live_url: optionalUrl,
  repo_url: optionalUrl,
  enabled: z.boolean().default(true),
});
export type ProjectInput = z.input<typeof ProjectInput>;

export const Project = ProjectInput.extend({ id: z.string(), brief_path: z.string().nullable() });
export type Project = z.infer<typeof Project>;

// ---------- Schedules ----------

export const JobTemplate = z.object({
  title: z.string().min(1).max(200),
  type: z.string().min(1).max(64).default("task"),
  input: z.record(z.string(), z.unknown()).default({}),
  project_id: z.string().nullable().default(null),
});
export type JobTemplate = z.infer<typeof JobTemplate>;

export const ScheduleInput = z.object({
  agent_id: z.string().min(1),
  /** 5- or 6-field cron, evaluated in Asia/Kuala_Lumpur. */
  cron: z.string().min(9).max(120),
  job_template: JobTemplate,
  enabled: z.boolean().default(true),
});
export type ScheduleInput = z.input<typeof ScheduleInput>;

export const Schedule = ScheduleInput.extend({
  id: z.string(),
  last_run_at: z.string().nullable(),
  next_run_at: z.string().nullable(),
});
export type Schedule = z.infer<typeof Schedule>;

// ---------- Runners ----------

export const RunnerCapabilities = z.object({
  os: z.string(),
  arch: z.string(),
  runtimes: z.array(z.string()),
  max_concurrent_runs: z.number().int().positive().default(1),
  /** Helper programs found on PATH (git, node, ffmpeg, blender…): shown on the Runners page. */
  programs: z.array(z.string()).default([]),
});
export type RunnerCapabilities = z.infer<typeof RunnerCapabilities>;

export const Runner = z.object({
  id: z.string(),
  name: z.string(),
  status: RunnerStatus,
  last_seen_at: z.string().nullable(),
  capabilities: RunnerCapabilities.nullable(),
});
export type Runner = z.infer<typeof Runner>;

// ---------- Providers ----------

export const ProviderInput = z.object({
  slug,
  name: z.string().min(1).max(80),
  kind: ProviderKind,
  base_url: z.string().url().nullable().default(null),
  /** Write-only. Omit to keep the existing key, empty string to clear it. */
  api_key: z.string().max(2000).optional(),
  models: z.array(z.string().min(1)).default([]),
  /** Per-model pricing override (USD per 1M tokens). */
  pricing: z.record(z.string(), ModelPricing).default({}),
  enabled: z.boolean().default(true),
});
export type ProviderInput = z.input<typeof ProviderInput>;

/** What the web UI is allowed to see — never contains the key itself. */
export const ProviderPublic = ProviderInput.omit({ api_key: true }).extend({
  id: z.string(),
  has_api_key: z.boolean(),
  api_key_hint: z.string().nullable(),
});
export type ProviderPublic = z.infer<typeof ProviderPublic>;

/** What the hub sends to a runner for one run. Contains the decrypted key. */
export const ProviderRuntimeConfig = z.object({
  slug: z.string(),
  kind: ProviderKind,
  base_url: z.string().nullable(),
  api_key: z.string().nullable(),
});
export type ProviderRuntimeConfig = z.infer<typeof ProviderRuntimeConfig>;
