import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { dayKey } from "@agent-office/shared";
import type { Hub } from "./core.ts";
import { agents, approvals, contentDrafts, jobs, proposals, runs, schedules, workspaces } from "./db/schema.ts";
import { roomBudgetLeft } from "./scope.ts";

/**
 * Facts for Ketua's morning briefing (job type "daily_briefing"), gathered by the hub at run time
 * so the agent never guesses: yesterday's work, what waits for the owner, costs, room limits.
 * Everything is limited to one room (the job's workspace).
 */
export function briefingFacts(hub: Hub, ws: string, now = new Date()) {
  const db = hub.db;
  const today = dayKey(now.toISOString());
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000).toISOString());
  const start = (day: string) => new Date(`${day}T00:00:00+08:00`).toISOString();
  const names = new Map(db.select({ id: agents.id, name: agents.name }).from(agents).all().map((a) => [a.id, a.name]));

  const ran = db
    .select({ status: runs.status, agent_id: runs.agent_id, title: jobs.title, type: jobs.type, tokens: runs.tokens_in, out: runs.tokens_out })
    .from(runs)
    .innerJoin(jobs, eq(jobs.id, runs.job_id))
    .where(and(eq(jobs.workspace_id, ws), gte(runs.started_at, start(yesterday)), lt(runs.started_at, start(today))))
    .all();
  const byAgent = new Map<string, { done: number; failed: number; tokens: number; titles: string[] }>();
  for (const r of ran) {
    const name = names.get(r.agent_id) ?? "An agent";
    const a = byAgent.get(name) ?? { done: 0, failed: 0, tokens: 0, titles: [] };
    if (r.status === "done") a.done++;
    if (r.status === "failed") a.failed++;
    a.tokens += r.tokens + r.out;
    if (r.status === "done" && r.type !== "chat" && a.titles.length < 3) a.titles.push(r.title);
    byAgent.set(name, a);
  }
  const failed = ran.filter((r) => r.status === "failed").slice(0, 5).map((r) => ({ agent: names.get(r.agent_id) ?? "An agent", job: r.title }));

  const pendingDrafts = db
    .select({ title: contentDrafts.title, platform: contentDrafts.platform, kind: contentDrafts.kind })
    .from(contentDrafts)
    .where(and(eq(contentDrafts.workspace_id, ws), eq(contentDrafts.status, "draft")))
    .orderBy(desc(contentDrafts.created_at))
    .all();
  const wsRuns = db.select({ id: runs.id }).from(runs).innerJoin(jobs, eq(jobs.id, runs.job_id)).where(eq(jobs.workspace_id, ws));
  const pendingApprovals = db.select({ action: approvals.action }).from(approvals).where(and(eq(approvals.status, "pending"), inArray(approvals.run_id, wsRuns))).all();
  const pendingSkills = ws === "owner" ? db.select({ id: proposals.id }).from(proposals).where(and(eq(proposals.status, "pending"), eq(proposals.workspace_id, "owner"))).all().length : 0;

  const cost = hub.store.stateFor(ws).cost_by_day;
  const rooms = db
    .select()
    .from(workspaces)
    .where(eq(workspaces.kind, "room"))
    .all()
    .filter((r) => ws === "owner" || r.id === ws)
    .map((r) => ({ room: r.name, daily_limit: r.daily_token_budget, left_today: roomBudgetLeft(db, r.id) }));

  return {
    date: today,
    yesterday: {
      date: yesterday,
      by_agent: [...byAgent.entries()].map(([agent, a]) => ({ agent, ...a })),
      failed,
    },
    waiting_for_owner: {
      drafts: pendingDrafts.length,
      draft_titles: pendingDrafts.slice(0, 5).map((d) => `${d.title} (${d.platform} ${d.kind})`),
      approvals: pendingApprovals.length,
      approval_actions: pendingApprovals.slice(0, 5).map((a) => a.action),
      skill_proposals: pendingSkills,
    },
    cost_usd: { yesterday: Math.round((cost[yesterday] ?? 0) * 100) / 100, today_so_far: Math.round((cost[today] ?? 0) * 100) / 100 },
    rooms,
    schedules_on: db
      .select({ cron: schedules.cron, template: schedules.job_template, agent_id: schedules.agent_id })
      .from(schedules)
      .where(and(eq(schedules.workspace_id, ws), eq(schedules.enabled, true)))
      .all()
      .map((s) => ({ agent: names.get(s.agent_id) ?? "", cron: s.cron, title: String((s.template as { title?: unknown }).title ?? "") })),
  };
}
