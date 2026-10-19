import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { OWNER_WORKSPACE, dayKey } from "@agent-office/shared";
import type { Hub } from "./core.ts";
import { agentShares, agents, jobs, runs, users, workspaces } from "./db/schema.ts";
import { HttpError, newId } from "./repo.ts";

/**
 * Members (owner request, 2026-10-19): friends log in to the owner's MyOfis with their own email
 * (Cloudflare Access) and get their own workspace: projects, drafts, chats, providers and agents.
 * The owner may share some of his agents with a member; those run on the owner's AI within a
 * daily token limit per member. Members are never deleted here (their data stays): disable them.
 */
export const MemberInvite = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().max(80).default(""),
});
export const MemberUpdate = z.object({ name: z.string().trim().max(80).optional(), disabled: z.boolean().optional() });
export const MemberShares = z.object({
  shares: z.array(z.object({ agent_id: z.string(), daily_token_budget: z.number().int().min(1000).max(5_000_000).default(50_000) })).max(50),
});

export interface MemberView {
  id: string;
  email: string;
  name: string;
  disabled: boolean;
  workspace_id: string;
  created_at: string;
  shares: { agent_id: string; agent_name: string; daily_token_budget: number; used_today: number }[];
  /** All tokens this member's work used today (shared agents on the owner's AI + their own agents). */
  tokens_today: number;
}

export class Members {
  constructor(private readonly hub: Hub) {}

  list(): MemberView[] {
    return this.hub.db
      .select()
      .from(users)
      .where(eq(users.role, "member"))
      .orderBy(users.created_at)
      .all()
      .map((u) => this.#view(u));
  }

  invite(input: unknown): MemberView {
    const { email, name } = MemberInvite.parse(input);
    const owner = this.hub.config.cfAccess.ownerEmail.trim().toLowerCase();
    if (email === owner) throw new HttpError(400, "that is the owner's email");
    if (this.hub.db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()) throw new HttpError(409, "this email is already a member");
    const wsId = newId("ws");
    const userId = newId("usr");
    this.hub.db.transaction((tx) => {
      tx.insert(workspaces).values({ id: wsId, name: name || email, kind: "personal" }).run();
      tx.insert(users).values({ id: userId, email, name, role: "member", workspace_id: wsId }).run();
    });
    return this.#view(this.#user(userId));
  }

  update(id: string, input: unknown): MemberView {
    const u = this.#user(id);
    const patch = MemberUpdate.parse(input);
    this.hub.db.update(users).set(patch).where(eq(users.id, u.id)).run();
    if (patch.name) this.hub.db.update(workspaces).set({ name: patch.name }).where(eq(workspaces.id, u.workspace_id)).run();
    return this.#view(this.#user(id));
  }

  /** Replace which of the owner's agents this member may use, and the daily limit for each. */
  setShares(id: string, input: unknown): MemberView {
    const u = this.#user(id);
    const { shares } = MemberShares.parse(input);
    for (const s of shares) {
      const a = this.hub.db.select().from(agents).where(eq(agents.id, s.agent_id)).get();
      if (!a || a.workspace_id !== OWNER_WORKSPACE) throw new HttpError(400, "only your own agents can be shared");
    }
    this.hub.db.transaction((tx) => {
      tx.delete(agentShares).where(eq(agentShares.workspace_id, u.workspace_id)).run();
      for (const s of shares) tx.insert(agentShares).values({ agent_id: s.agent_id, workspace_id: u.workspace_id, daily_token_budget: s.daily_token_budget }).run();
    });
    this.hub.dispatch();
    return this.#view(u);
  }

  #user(id: string) {
    const u = this.hub.db.select().from(users).where(and(eq(users.id, id), eq(users.role, "member"))).get();
    if (!u) throw new HttpError(404, "member not found");
    return u;
  }

  #usedToday(workspaceId: string, agentId?: string): number {
    const since = new Date(`${dayKey(new Date().toISOString())}T00:00:00+08:00`).toISOString();
    return (
      this.hub.db
        .select({ n: sql<number>`coalesce(sum(${runs.tokens_in} + ${runs.tokens_out}), 0)` })
        .from(runs)
        .innerJoin(jobs, eq(jobs.id, runs.job_id))
        .where(and(eq(jobs.workspace_id, workspaceId), agentId ? eq(runs.agent_id, agentId) : undefined, sql`${runs.started_at} >= ${since}`))
        .get()?.n ?? 0
    );
  }

  #view(u: typeof users.$inferSelect): MemberView {
    const shares = this.hub.db
      .select({ agent_id: agentShares.agent_id, daily_token_budget: agentShares.daily_token_budget, agent_name: agents.name })
      .from(agentShares)
      .innerJoin(agents, eq(agents.id, agentShares.agent_id))
      .where(eq(agentShares.workspace_id, u.workspace_id))
      .all()
      .map((s) => ({ ...s, used_today: this.#usedToday(u.workspace_id, s.agent_id) }));
    return { id: u.id, email: u.email, name: u.name, disabled: u.disabled, workspace_id: u.workspace_id, created_at: u.created_at, shares, tokens_today: this.#usedToday(u.workspace_id) };
  }
}
