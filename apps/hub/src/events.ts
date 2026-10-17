import { and, asc, eq, gt } from "drizzle-orm";
import { AgentEvent, EventBody, apply, initialState, redact, type OfficeState } from "@agent-office/shared";
import type { Db } from "./db/client.ts";
import { events } from "./db/schema.ts";
import type { Storage } from "./storage.ts";

export interface EventMeta {
  run_id?: string | null;
  agent_id?: string | null;
}

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
  state: OfficeState = initialState();
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
  }

  transact<T>(fn: (tx: Db, emit: Emit) => T): T {
    const pending: AgentEvent[] = [];
    const result = this.db.transaction((tx) => {
      const emit: Emit = (body, meta = {}) => {
        const clean = EventBody.parse(redact(body));
        const ts = new Date().toISOString();
        const row = tx
          .insert(events)
          .values({
            ts,
            run_id: meta.run_id ?? null,
            agent_id: meta.agent_id ?? null,
            type: clean.type,
            payload: clean.payload as Record<string, unknown>,
          })
          .returning({ id: events.id })
          .get();
        const event = { id: row.id, ts, run_id: meta.run_id ?? null, agent_id: meta.agent_id ?? null, ...clean } as AgentEvent;
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

  list(afterId: number, limit = 500, runId?: string): AgentEvent[] {
    const where = runId ? and(gt(events.id, afterId), eq(events.run_id, runId)) : gt(events.id, afterId);
    const rows = this.db.select().from(events).where(where).orderBy(asc(events.id)).limit(limit).all();
    return rows.map((r) => AgentEvent.parse(r));
  }

  subscribe(fn: Listener): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #publish(event: AgentEvent): void {
    apply(this.state, event);
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
