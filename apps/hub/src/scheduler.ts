import { Cron } from "croner";
import { eq } from "drizzle-orm";
import { JobTemplate, TIMEZONE, type Schedule } from "@agent-office/shared";
import type { Hub } from "./core.ts";
import { agents, schedules } from "./db/schema.ts";
import { HttpError } from "./repo.ts";

type Row = typeof schedules.$inferSelect;

/** Throws a 400 if croner cannot parse the pattern. */
export function assertValidCron(pattern: string): void {
  try {
    new Cron(pattern, { timezone: TIMEZONE, paused: true }).stop();
  } catch (err) {
    throw new HttpError(400, `invalid cron "${pattern}": ${(err as Error).message}`);
  }
}

/**
 * Turns enabled `schedules` rows into croner timers (Asia/Kuala_Lumpur).
 * Call `reload()` after any schedule change.
 */
export class Scheduler {
  readonly #timers = new Map<string, Cron>();

  constructor(private readonly hub: Hub) {}

  start(): void {
    this.reload();
  }

  stop(): void {
    for (const t of this.#timers.values()) t.stop();
    this.#timers.clear();
  }

  reload(): void {
    this.stop();
    for (const row of this.hub.db.select().from(schedules).where(eq(schedules.enabled, true)).all()) {
      this.#timers.set(
        row.id,
        new Cron(
          row.cron,
          {
            name: row.id,
            timezone: TIMEZONE,
            protect: true, // never overlap a slow callback with the next tick
            catch: (err) => console.error(`[scheduler] schedule ${row.id} failed`, err),
          },
          () => void this.fire(row.id),
        ),
      );
    }
  }

  nextRun(id: string): string | null {
    return this.#timers.get(id)?.nextRun()?.toISOString() ?? null;
  }

  toSchedule(row: Row): Schedule {
    return {
      id: row.id,
      agent_id: row.agent_id,
      cron: row.cron,
      job_template: JobTemplate.parse(row.job_template),
      enabled: row.enabled,
      last_run_at: row.last_run_at,
      next_run_at: row.enabled ? this.nextRun(row.id) : null,
    };
  }

  /**
   * Create the job for a schedule. Skipped (returns null) while the system is
   * paused or the agent is disabled, so nothing piles up for later.
   */
  fire(id: string, opts: { force?: boolean } = {}): string | null {
    const { db } = this.hub;
    const row = db.select().from(schedules).where(eq(schedules.id, id)).get();
    if (!row || (!row.enabled && !opts.force)) return null;
    const agent = db.select().from(agents).where(eq(agents.id, row.agent_id)).get();
    if (!agent?.enabled) {
      console.log(`[scheduler] skip ${id}: agent disabled`);
      return null;
    }
    if (this.hub.paused && !opts.force) {
      console.log(`[scheduler] skip ${id}: system paused`);
      return null;
    }
    const tpl = JobTemplate.parse(row.job_template);
    db.update(schedules).set({ last_run_at: new Date().toISOString() }).where(eq(schedules.id, id)).run();
    const job = this.hub.createJob({ ...tpl, agent_id: row.agent_id, trigger: "schedule" });
    return job.id;
  }
}
