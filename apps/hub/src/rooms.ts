import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Identity } from "./auth.ts";
import type { Hub } from "./core.ts";
import { agents, contentDrafts, projects, roomMembers, schedules, users, workspaces } from "./db/schema.ts";
import { HttpError, newId } from "./repo.ts";
import { OWNER_WORKSPACE, roomBudgetLeft } from "./scope.ts";

/**
 * Rooms (owner request, 2026-10-19): "HQ" holds everything from before; the owner makes a room
 * per sub-business ("Sewa Baju"), moves the agents and projects it needs into it, and shares it
 * with friends. The owner (admin) can enter every room, members' personal rooms included.
 */
export const RoomInput = z.object({
  name: z.string().trim().min(1).max(60),
  daily_token_budget: z.number().int().min(1000).max(50_000_000).default(200_000),
});
export const RoomPatch = RoomInput.partial();
export const RoomMembersInput = z.object({ user_ids: z.array(z.string()).max(50) });

export interface RoomView {
  id: string;
  name: string;
  kind: "hq" | "room" | "personal";
  daily_token_budget: number;
  /** Tokens left today on the owner's AI ("room" kind only). */
  left_today: number | null;
  members: { id: string; email: string; name: string }[];
  agents: number;
  projects: number;
  current: boolean;
}

export class Rooms {
  constructor(private readonly hub: Hub) {}

  /** Rooms this person may enter (the owner: all of them). */
  list(me: Identity): RoomView[] {
    const db = this.hub.db;
    let rows = db.select().from(workspaces).orderBy(workspaces.created_at).all();
    if (me.role !== "owner") {
      const mine = new Set([me.home_workspace_id, ...db.select({ w: roomMembers.workspace_id }).from(roomMembers).where(eq(roomMembers.user_id, me.user_id)).all().map((r) => r.w)]);
      rows = rows.filter((r) => mine.has(r.id));
    }
    const order = { hq: 0, room: 1, personal: 2 } as const;
    return rows.sort((a, b) => order[a.kind] - order[b.kind]).map((r) => this.#view(r, me));
  }

  create(input: unknown): RoomView {
    const data = RoomInput.parse(input);
    const id = newId("ws");
    this.hub.db.insert(workspaces).values({ id, name: data.name, kind: "room", daily_token_budget: data.daily_token_budget }).run();
    return this.#view(this.#room(id), null);
  }

  update(id: string, input: unknown): RoomView {
    const room = this.#room(id);
    const patch = RoomPatch.parse(input);
    this.hub.db.update(workspaces).set(patch).where(eq(workspaces.id, room.id)).run();
    this.hub.dispatch();
    return this.#view(this.#room(id), null);
  }

  /** Who may enter a shared room (members only; the owner always can). */
  setMembers(id: string, input: unknown): RoomView {
    const room = this.#room(id);
    if (room.kind !== "room") throw new HttpError(400, "only rooms you made can be shared");
    const { user_ids } = RoomMembersInput.parse(input);
    const found = user_ids.length ? this.hub.db.select({ id: users.id }).from(users).where(and(inArray(users.id, user_ids), eq(users.role, "member"))).all() : [];
    if (found.length !== new Set(user_ids).size) throw new HttpError(400, "unknown member");
    this.hub.db.transaction((tx) => {
      tx.delete(roomMembers).where(eq(roomMembers.workspace_id, id)).run();
      for (const u of found) tx.insert(roomMembers).values({ workspace_id: id, user_id: u.id }).run();
    });
    return this.#view(this.#room(id), null);
  }

  /** Move one of the owner's agents to another room (its schedules go with it). */
  moveAgent(agentId: string, to: string): void {
    const db = this.hub.db;
    this.#room(to);
    const a = db.select().from(agents).where(eq(agents.id, agentId)).get();
    if (!a) throw new HttpError(404, "agent not found");
    if (db.select({ id: agents.id }).from(agents).where(and(eq(agents.slug, a.slug), eq(agents.workspace_id, to))).get()) throw new HttpError(409, `that room already has an agent called "${a.slug}"`);
    db.transaction((tx) => {
      tx.update(agents).set({ workspace_id: to }).where(eq(agents.id, agentId)).run();
      tx.update(schedules).set({ workspace_id: to }).where(eq(schedules.agent_id, agentId)).run();
    });
    this.hub.dispatch();
  }

  /** Move a project (its brief folder and its drafts) to another room. */
  moveProject(projectId: string, to: string): void {
    const db = this.hub.db;
    this.#room(to);
    const p = db.select().from(projects).where(eq(projects.id, projectId)).get();
    if (!p) throw new HttpError(404, "project not found");
    if (db.select({ id: projects.id }).from(projects).where(and(eq(projects.slug, p.slug), eq(projects.workspace_id, to))).get()) throw new HttpError(409, `that room already has a project called "${p.slug}"`);
    const from = join(this.hub.config.projectsDir, this.hub.content.briefPath(p).replace(/^projects\//, "").replace(/\/brief\.yaml$/, ""));
    const moved = { ...p, workspace_id: to };
    const target = join(this.hub.config.projectsDir, this.hub.content.briefPath(moved).replace(/^projects\//, "").replace(/\/brief\.yaml$/, ""));
    if (existsSync(from) && !existsSync(target)) {
      mkdirSync(dirname(target), { recursive: true });
      renameSync(from, target);
    }
    db.transaction((tx) => {
      tx.update(projects).set({ workspace_id: to, brief_path: p.brief_path ? this.hub.content.briefPath(moved) : null }).where(eq(projects.id, projectId)).run();
      tx.update(contentDrafts).set({ workspace_id: to }).where(eq(contentDrafts.project_id, projectId)).run();
    });
  }

  #room(id: string) {
    const r = this.hub.db.select().from(workspaces).where(eq(workspaces.id, id)).get();
    if (!r) throw new HttpError(404, "room not found");
    return r;
  }

  #view(r: typeof workspaces.$inferSelect, me: Identity | null): RoomView {
    const db = this.hub.db;
    const members = db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(r.kind === "personal" ? eq(users.workspace_id, r.id) : inArray(users.id, db.select({ id: roomMembers.user_id }).from(roomMembers).where(eq(roomMembers.workspace_id, r.id))))
      .all();
    return {
      id: r.id,
      name: r.kind === "personal" && members[0] ? `${members[0].name || members[0].email} (personal)` : r.name,
      kind: r.kind,
      daily_token_budget: r.daily_token_budget,
      left_today: roomBudgetLeft(db, r.id),
      members,
      agents: db.select({ id: agents.id }).from(agents).where(eq(agents.workspace_id, r.id)).all().length,
      projects: db.select({ id: projects.id }).from(projects).where(eq(projects.workspace_id, r.id)).all().length,
      current: me ? me.workspace_id === r.id : false,
    };
  }
}

export { OWNER_WORKSPACE };
