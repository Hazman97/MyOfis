import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { AgentConfig, type Agent, type Job, type ProviderPublic, type Run, type Runner, type RunnerCapabilities } from "@agent-office/shared";
import type { Db } from "./db/client.ts";
import { agents, jobs, providers, runners, runs } from "./db/schema.ts";

export const newId = (prefix: string) => `${prefix}_${ulid().toLowerCase()}`;

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 429,
    message: string,
  ) {
    super(message);
  }
}

type AgentRow = typeof agents.$inferSelect;
type ProviderRow = typeof providers.$inferSelect;
type RunnerRow = typeof runners.$inferSelect;

/** `config` may be `{}` for rows created before migration 0001: fill defaults on read. */
export const toAgent = (r: AgentRow): Agent => {
  const config = AgentConfig.parse(r.config ?? {});
  return { ...r, config, kind: config.external ? "external" : "builtin" };
};
export const toJob = (r: typeof jobs.$inferSelect): Job => ({
  ...r,
  ...(r.input?.created_by === "assistant" ? { created_by: "assistant" as const } : {}),
});
export const toRun = (r: typeof runs.$inferSelect): Run => ({
  id: r.id,
  job_id: r.job_id,
  agent_id: r.agent_id,
  runner_id: r.runner_id,
  started_at: r.started_at,
  ended_at: r.ended_at,
  status: r.status,
  tokens_in: r.tokens_in,
  tokens_out: r.tokens_out,
  cost_usd: r.cost_usd,
  log_path: r.log_path,
});

export const toRunner = (r: RunnerRow): Runner => ({
  id: r.id,
  name: r.name,
  status: r.status,
  last_seen_at: r.last_seen_at,
  capabilities: (r.capabilities as RunnerCapabilities | null) ?? null,
});

export const toProviderPublic = (r: ProviderRow): ProviderPublic => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  kind: r.kind,
  base_url: r.base_url,
  models: r.models,
  pricing: r.pricing,
  enabled: r.enabled,
  has_api_key: r.api_key_enc !== null,
  api_key_hint: r.api_key_hint,
});

export const getAgent = (db: Db, id: string) => db.select().from(agents).where(eq(agents.id, id)).get();
export const getJob = (db: Db, id: string) => db.select().from(jobs).where(eq(jobs.id, id)).get();
export const getRun = (db: Db, id: string) => db.select().from(runs).where(eq(runs.id, id)).get();
/** Providers are named by slug inside a workspace (an agent uses its own workspace's providers). */
export const getProviderBySlug = (db: Db, slug: string, workspaceId = "owner") =>
  db.select().from(providers).where(and(eq(providers.slug, slug), eq(providers.workspace_id, workspaceId))).get();
export const getRunner = (db: Db, id: string) => db.select().from(runners).where(eq(runners.id, id)).get();
