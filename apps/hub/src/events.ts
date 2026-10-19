import { and, asc, eq, gt, isNull, or } from "drizzle-orm";
import { AgentEvent, EventBody, OWNER_WORKSPACE, apply, initialState, redact, type OfficeState } from "@agent-office/shared";
import type { Db } from "./db/client.ts";
import { agents, contentDrafts, events, jobs, projects, proposals, runs } from "./db/schema.ts";
import type { Storage } from "./storage.ts";

export interface EventMeta {
  run_id?: string | null;
  agent_id?: string | null;
  /** Who may see it; worked out from the run / job / draft / agent when not given. null = everyone. */
  workspace_id?: string | null;
}

/** Seen by every workspace: the shared machinery, not anyone's work. */
const GLOBAL_TYPES = new Set(["runner.online", "runner.offline", "system.paused"]);

/** The workspace an event belongs to (members, 2026-10-19): the job's for run/job events, else the draft's, project's or agent's. */
function workspaceOf(tx: Db, body: EventBody, meta: EventMeta): string | null {
  if (meta.workspace_id !== undefined) return meta.workspace_id;
  if (GLOBAL_TYPES.has(body.type)) return null;
  const p = body.payload as Record<string, unknown>;
  const jobWs = (id: string) => tx.select({ w: jobs.workspace_id }).from(jobs).where(eq(jobs.id, id)).get()?.w;
  if (meta.run_id) {
    const r = tx.select({ job_id: runs.job_id }).from(runs).where(eq(runs.id, meta.run_id)).get();
    const w = r && jobWs(r.job_id);
    if (w) return w;
  }
  if (typeof p.job_id === "string") {
    const w = jobWs(p.job_id);
    if (w) return w;
  }
  if (typeof p.draft_id === "string") {
    const w = tx.select({ w: contentDrafts.workspace_id }).from(contentDrafts).where(eq(contentDrafts.id, p.draft_id)).get()?.w;
    if (w) return w;
  }
  if (typeof p.proposal_id === "string") {
    const w = tx.select({ w: proposals.workspace_id }).from(proposals).where(eq(proposals.id, p.proposal_id)).get()?.w;
    if (w) return w;
  }
  if (typeof p.project_id === "string") {
    const w = tx.select({ w: projects.workspace_id }).from(projects).where(eq(projects.id, p.project_id)).get()?.w;
    if (w) return w;
  }
  if (meta.agent_id) {
    const w = tx.select({ w: agents.workspace_id }).from(agents).where(eq(agents.id, meta.agent_id)).get()?.w;
    if (w) return w;
  }
  return OWNER_WORKSPACE;
}

export const visibleTo = (event: { workspace_id?: string | null }, ws: string) => event.workspace_id == null || event.workspace_id === ws;

export type Emit = (body: EventBody, meta?: EventMeta) => AgentEvent;
type Listener = (event: AgentEvent) => void;

const REBUILD_PAGE = 5000;

/**
 * Append-only event log + the in-memory state reduced from it.
 *
 * Writes go through `transact`, so projection updates (jobs/runs tables) and
 * the events describing them commit atomically. Listeners and the in-memory
 * state only see events after the transaction commits.
 */
export class EventStore {
  /** Everything (the hub's own view: dispatch, budgets). */
  state: OfficeState = initialState();
  /** What each workspace sees (built on first use, kept up to date). */
  readonly #views = new Map<string, OfficeState>();
  readonly #listeners = new Set<Listener>();
  #logTail: Promise<void> = Promise.resolve();

  /** Resolves once all queued run-log writes are on disk (used by tests and shutdown). */
  flushLogs(): Promise<void> {
    return this.#logTail;
  }

  constructor(
    private readonly db: Db,
    private readonly storage: Storage,
  ) {}

  /** Rebuild in-memory state from the full log (called once at boot). */
  rebuild(): void {
    const s = initialState();
    let after = 0;
    for (;;) {
      const page = this.list(after, REBUILD_PAGE);
      for (const e of page) apply(s, e);
      if (page.length < REBUILD_PAGE) break;
      after = page[page.length - 1]!.id;
    }
    this.state = s;
    this.#views.clear();
  }

  /** The office as one workspace sees it: its own events plus the shared machinery. */
  stateFor(workspaceId: string): OfficeState {
    let s = this.#views.get(workspaceId);
    if (!s) {
      s = initialState();
      let after = 0;
      for (;;) {
        const page = this.list(after, REBUILD_PAGE, undefined, workspaceId);
        for (const e of page) apply(s, e);
        if (page.length < REBUILD_PAGE) break;
        after = page[page.length - 1]!.id;
      }
      this.#views.set(workspaceId, s);
    }
    return s;
  }

  transact<T>(fn: (tx: Db, emit: Emit) => T): T {
    const pending: AgentEvent[] = [];
    const result = this.db.transaction((tx) => {
      const emit: Emit = (body, meta = {}) => {
        const clean = EventBody.parse(redact(body));
        const ts = new Date().toISOString();
        const workspace_id = workspaceOf(tx as unknown as Db, clean, meta);
        const row = tx
          .insert(events)
          .values({
            ts,
            run_id: meta.run_id ?? null,
            agent_id: meta.agent_id ?? null,
            workspace_id,
            type: clean.type,
            payload: clean.payload as Record<string, unknown>,
          })
          .returning({ id: events.id })
          .get();
        const event = { id: row.id, ts, run_id: meta.run_id ?? null, agent_id: meta.agent_id ?? null, workspace_id, ...clean } as AgentEvent;
        pending.push(event);
        return event;
      };
      return fn(tx as unknown as Db, emit);
    });
    for (const e of pending) this.#publish(e);
    return result;
  }

  /** Convenience for a single event with no projection changes. */
  emit(body: EventBody, meta?: EventMeta): AgentEvent {
    return this.transact((_tx, emit) => emit(body, meta));
  }

  /** Events after `afterId`; only one run's, and/or only what a workspace may see. */
  list(afterId: number, limit = 500, runId?: string, workspaceId?: string): AgentEvent[] {
    const where = and(
      gt(events.id, afterId),
      runId ? eq(events.run_id, runId) : undefined,
      workspaceId ? or(isNull(events.workspace_id), eq(events.workspace_id, workspaceId)) : undefined,
    );
    const rows = this.db.select().from(events).where(where).orderBy(asc(events.id)).limit(limit).all();
    return rows.map((r) => AgentEvent.parse(r));
  }

  subscribe(fn: Listener): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #publish(event: AgentEvent): void {
    apply(this.state, event);
    for (const [ws, view] of this.#views) if (visibleTo(event, ws)) apply(view, event);
    if (event.run_id) {
      const key = `runs/${event.run_id}.ndjson`;
      const line = JSON.stringify(event) + "\n";
      // Serialise appends so log lines keep event order.
      this.#logTail = this.#logTail
        .then(() => this.storage.append(key, line))
        .catch((err) => console.error("[hub] failed to write run log", err));
    }
    for (const fn of this.#listeners) {
      try {
        fn(event);
      } catch (err) {
        console.error("[hub] event listener failed", err);
      }
    }
  }
}
