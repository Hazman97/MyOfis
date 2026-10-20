import { and, eq, inArray, sql } from "drizzle-orm";
import { OWNER_WORKSPACE, dayKey, type Agent } from "@agent-office/shared";
import type { Db } from "./db/client.ts";
import { agentShares, agents, approvals, contentDrafts, jobs, projects, providers, roomMembers, runs, schedules, uploads, workspaces } from "./db/schema.ts";
import { HttpError, toAgent } from "./repo.ts";

/**
 * Members (owner request, 2026-10-19): every person works in their own workspace. These helpers
 * answer "may this workspace see / use this row?" and return 404 otherwise (never 403, so ids of
 * other people's things are not confirmed). The owner's workspace is "owner".
 */
export { OWNER_WORKSPACE };
export const isOwnerWs = (ws: string) => ws === OWNER_WORKSPACE;

/**
 * Tools a member's own agents may have. They run on the owner's PC, so nothing that touches its
 * files, shell, git, browser or health; no skill proposals (the skills library is the owner's).
 */
export const MEMBER_TOOLS = new Set([
  "read_brief", "read_feature_log", "read_past_drafts", "save_draft", "draft_web_post", "update_web_post", "take_down_web_post", "read_bookings",
  "web_search", "web_fetch", "write_report", "handoff", "consult_agent", "consult_team",
  "memory", "session_search", "skills_list", "skill_view", "video_probe", "video_edit", "video_transcribe", "suggest_edits", "video_tiktok_hd",
]);

export function assertMemberTools(tools: string[]): void {
  const bad = tools.filter((t) => !MEMBER_TOOLS.has(t));
  if (bad.length) throw new HttpError(400, `not allowed for members (they run on the owner's PC): ${bad.join(", ")}`);
}

function notFound(what: string): never {
  throw new HttpError(404, `${what} not found`);
}

/** The share row when the owner shared this agent with `ws`. */
export function shareOf(db: Db, agentId: string, ws: string) {
  return db.select().from(agentShares).where(and(eq(agentShares.agent_id, agentId), eq(agentShares.workspace_id, ws))).get() ?? null;
}

/** An agent this workspace may give work to: its own, or one the owner shared with it. */
export function usableAgent(db: Db, id: string, ws: string) {
  const a = db.select().from(agents).where(eq(agents.id, id)).get();
  if (!a || (a.workspace_id !== ws && !shareOf(db, a.id, ws))) notFound("agent");
  return a;
}

/** An agent this workspace may change (its own). */
export function ownAgent(db: Db, id: string, ws: string) {
  const a = db.select().from(agents).where(and(eq(agents.id, id), eq(agents.workspace_id, ws))).get();
  return a ?? notFound("agent");
}

/** Own agents, then agents shared with this workspace (marked `shared`). */
export function visibleAgents(db: Db, ws: string): Agent[] {
  const own = db.select().from(agents).where(eq(agents.workspace_id, ws)).orderBy(agents.created_at).all().map(toAgent);
  if (isOwnerWs(ws)) return own;
  const ids = db.select({ id: agentShares.agent_id }).from(agentShares).where(eq(agentShares.workspace_id, ws)).all().map((r) => r.id);
  const shared = ids.length ? db.select().from(agents).where(inArray(agents.id, ids)).all().map((a) => ({ ...toAgent(a), shared: true })) : [];
  return [...own, ...shared];
}

export function ownProject(db: Db, id: string, ws: string) {
  return db.select().from(projects).where(and(eq(projects.id, id), eq(projects.workspace_id, ws))).get() ?? notFound("project");
}

export function ownDraft(db: Db, id: string, ws: string) {
  return db.select().from(contentDrafts).where(and(eq(contentDrafts.id, id), eq(contentDrafts.workspace_id, ws))).get() ?? notFound("draft");
}

export function ownJob(db: Db, id: string, ws: string) {
  return db.select().from(jobs).where(and(eq(jobs.id, id), eq(jobs.workspace_id, ws))).get() ?? notFound("job");
}

export function ownRun(db: Db, id: string, ws: string) {
  const run = db.select().from(runs).where(eq(runs.id, id)).get();
  if (!run) notFound("run");
  ownJob(db, run.job_id, ws);
  return run;
}

export function ownApproval(db: Db, id: string, ws: string) {
  const a = db.select().from(approvals).where(eq(approvals.id, id)).get();
  if (!a) notFound("approval");
  ownRun(db, a.run_id, ws);
  return a;
}

export function ownUpload(db: Db, id: string, ws: string) {
  return db.select().from(uploads).where(and(eq(uploads.id, id), eq(uploads.workspace_id, ws))).get() ?? notFound("upload");
}

export function ownSchedule(db: Db, id: string, ws: string) {
  return db.select().from(schedules).where(and(eq(schedules.id, id), eq(schedules.workspace_id, ws))).get() ?? notFound("schedule");
}

export function ownProvider(db: Db, id: string, ws: string) {
  return db.select().from(providers).where(and(eq(providers.id, id), eq(providers.workspace_id, ws))).get() ?? notFound("provider");
}

/** A provider by slug inside one workspace (agents name their provider by slug). */
export function providerBySlug(db: Db, slug: string, ws: string) {
  return db.select().from(providers).where(and(eq(providers.slug, slug), eq(providers.workspace_id, ws))).get() ?? null;
}

// ---------------------------------------------------------------- rooms (2026-10-19)

/** "hq" (the owner's main room), "room" (made by the owner, maybe shared), "personal" (a member's own). */
export function roomOf(db: Db, ws: string) {
  return db.select().from(workspaces).where(eq(workspaces.id, ws)).get() ?? null;
}

/** Whose AI providers a room's agents use: rooms the owner made run on the owner's AI; HQ and personal rooms on their own. */
export function aiWorkspace(db: Db, ws: string): string {
  return roomOf(db, ws)?.kind === "room" ? OWNER_WORKSPACE : ws;
}

/**
 * Agents here may only use the safe member tool set: a member's personal room, or a room with
 * members (friends can edit its agents, and they run on the owner's PC). The owner's private rooms
 * and HQ keep every tool.
 */
export function restrictedWorkspace(db: Db, ws: string): boolean {
  if (isOwnerWs(ws)) return false;
  const room = roomOf(db, ws);
  if (!room || room.kind === "personal") return true;
  return !!db.select({ u: roomMembers.user_id }).from(roomMembers).where(eq(roomMembers.workspace_id, ws)).get();
}

/** Tokens a room ("room" kind, on the owner's AI) may still use today; null when it has no limit of its own. */
export function roomBudgetLeft(db: Db, ws: string): number | null {
  const room = roomOf(db, ws);
  if (!room || room.kind !== "room") return null;
  const since = new Date(`${dayKey(new Date().toISOString())}T00:00:00+08:00`).toISOString();
  const used =
    db
      .select({ n: sql<number>`coalesce(sum(${runs.tokens_in} + ${runs.tokens_out}), 0)` })
      .from(runs)
      .innerJoin(jobs, eq(jobs.id, runs.job_id))
      .where(and(eq(jobs.workspace_id, ws), sql`${runs.started_at} >= ${since}`))
      .get()?.n ?? 0;
  return Math.max(0, room.daily_token_budget - used);
}
