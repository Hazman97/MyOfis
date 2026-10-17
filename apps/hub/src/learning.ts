import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import {
  MEMORY_LIMITS,
  MemoryOp,
  applyMemoryOps,
  memoryContentProblem,
  parseSkill,
  SkillName,
  type MemoryResult,
  type MemoryTarget,
} from "@agent-office/shared";
import type { Db } from "./db/client.ts";
import { proposals, settings } from "./db/schema.ts";
import type { EventStore } from "./events.ts";
import { HttpError, newId } from "./repo.ts";

/**
 * Hermes-style learning: bounded memory stores (per-agent notes + the shared
 * owner profile), skills as SKILL.md files the owner approves, and a full-text
 * index over past runs for session_search.
 */
export interface SkillRecord {
  name: string;
  description: string;
  content: string;
}

export interface SkillUsage {
  /** Runs that opened the skill with skill_view. */
  runs: number;
  last_used_at: string | null;
  /** Of those runs: failed, or a draft from it was rejected. */
  bad_runs: number;
  /** Why it may be worth deleting, or null. */
  stale: string | null;
}

const STALE_AFTER_MS = 60 * 24 * 60 * 60 * 1000;

export interface Proposal {
  id: string;
  kind: "skill" | "memory";
  agent_id: string;
  run_id: string | null;
  name: string;
  action: string;
  content: string;
  previous: string | null;
  reason: string;
  status: "pending" | "approved" | "rejected";
  error: string | null;
  warnings: string[];
  created_at: string;
  decided_at: string | null;
}

export interface SearchHit {
  run_id: string;
  agent_id: string;
  job_type: string;
  ts: string;
  title: string;
  snippet: string;
}

const memKey = (target: MemoryTarget, agentId: string) => (target === "user" ? "memory.user" : `memory.agent.${agentId}`);
const APPROVAL_KEY = "memory.write_approval";

export class Learning {
  constructor(
    private readonly db: Db,
    private readonly store: EventStore,
    readonly skillsDir: string,
  ) {}

  // ---------------------------------------------------------------- memory

  #get<T>(key: string, fallback: T): T {
    const row = this.db.select().from(settings).where(eq(settings.key, key)).get();
    return (row?.value as T | undefined) ?? fallback;
  }

  #set(key: string, value: unknown): void {
    this.db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
  }

  entries(target: MemoryTarget, agentId: string): string[] {
    const v = this.#get<unknown>(memKey(target, agentId), []);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  }

  get writeApproval(): boolean {
    return this.#get<unknown>(APPROVAL_KEY, false) === true;
  }

  set writeApproval(on: boolean) {
    this.#set(APPROVAL_KEY, on);
  }

  /** Apply ops now (or stage them when write approval is on). */
  memoryOps(agentId: string, runId: string | null, target: MemoryTarget, ops: MemoryOp[], reason = ""): MemoryResult | { ok: true; staged: string } {
    if (this.writeApproval) {
      const id = newId("prp");
      this.db.insert(proposals).values({ id, kind: "memory", agent_id: agentId, run_id: runId, name: target, action: "ops", content: JSON.stringify(ops), reason }).run();
      return { ok: true, staged: id };
    }
    return this.#apply(agentId, target, ops);
  }

  #apply(agentId: string, target: MemoryTarget, ops: MemoryOp[]): MemoryResult {
    const r = applyMemoryOps(this.entries(target, agentId), ops, MEMORY_LIMITS[target]);
    if (r.ok) this.#set(memKey(target, agentId), r.entries);
    return r;
  }

  /** Owner edits a store directly (still within the limit, still scanned). */
  replaceEntries(agentId: string, target: MemoryTarget, entries: string[]): string[] {
    const ops = entries.map((content) => ({ action: "add" as const, content }));
    const r = applyMemoryOps([], ops, MEMORY_LIMITS[target]);
    if (!r.ok) throw new HttpError(400, r.error);
    this.#set(memKey(target, agentId), r.entries);
    return r.entries;
  }

  // ---------------------------------------------------------------- skills

  #skillFile(name: string) {
    SkillName.parse(name);
    return join(this.skillsDir, name, "SKILL.md");
  }

  skills(): SkillRecord[] {
    if (!existsSync(this.skillsDir)) return [];
    const out: SkillRecord[] = [];
    for (const dir of readdirSync(this.skillsDir, { withFileTypes: true })) {
      if (!dir.isDirectory() || dir.name.startsWith(".")) continue;
      const file = join(this.skillsDir, dir.name, "SKILL.md");
      if (!existsSync(file)) continue;
      try {
        const content = readFileSync(file, "utf8");
        const s = parseSkill(content);
        out.push({ name: s.name, description: s.description, content });
      } catch (err) {
        console.error(`[hub] skill ${dir.name} skipped: ${(err as Error).message}`);
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * How each skill is doing, from the events we already keep: runs that opened it with
   * skill_view, when it was last used, and how many of those runs failed or had a draft
   * rejected. `stale` says why the owner might want to delete it.
   */
  skillsWithUsage(now = Date.now()): (SkillRecord & { usage: SkillUsage })[] {
    const rows = this.#sqlite()
      .query(
        `WITH uses AS (
           SELECT json_extract(payload, '$.args.name') AS name, run_id, MAX(ts) AS ts
           FROM events
           WHERE type = 'agent.tool_call' AND json_extract(payload, '$.tool') = 'skill_view' AND run_id IS NOT NULL
           GROUP BY name, run_id)
         SELECT u.name AS name, COUNT(*) AS runs, MAX(u.ts) AS last_used_at,
           SUM(CASE WHEN r.status = 'failed'
                 OR EXISTS (SELECT 1 FROM content_drafts d WHERE d.run_id = u.run_id AND d.status = 'rejected')
               THEN 1 ELSE 0 END) AS bad_runs
         FROM uses u LEFT JOIN runs r ON r.id = u.run_id
         GROUP BY u.name`,
      )
      .all() as { name: string; runs: number; last_used_at: string; bad_runs: number }[];
    const byName = new Map(rows.map((r) => [r.name, r]));
    return this.skills().map((s) => {
      const u = byName.get(s.name);
      const since = u?.last_used_at ? Date.parse(u.last_used_at) : statSync(join(this.skillsDir, s.name, "SKILL.md")).mtimeMs;
      const usage: SkillUsage = { runs: u?.runs ?? 0, last_used_at: u?.last_used_at ?? null, bad_runs: u?.bad_runs ?? 0, stale: null };
      if (now - since > STALE_AFTER_MS) usage.stale = u ? "not used in 60 days" : "never used in 60 days";
      else if (usage.runs >= 3 && usage.bad_runs / usage.runs >= 0.5) usage.stale = "most runs that used it failed or had a draft rejected";
      return { ...s, usage };
    });
  }

  skill(name: string): SkillRecord | null {
    const file = this.#skillFile(name);
    if (!existsSync(file)) return null;
    const content = readFileSync(file, "utf8");
    return { name, description: parseSkill(content).description, content };
  }

  /** Owner writes (import) or an approved proposal: validate, then write-then-rename. */
  writeSkill(content: string): SkillRecord {
    let s;
    try {
      s = parseSkill(content);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    const file = this.#skillFile(s.name);
    mkdirSync(join(this.skillsDir, s.name), { recursive: true });
    writeFileSync(`${file}.tmp`, content.endsWith("\n") ? content : `${content}\n`);
    renameSync(`${file}.tmp`, file);
    return { name: s.name, description: s.description, content };
  }

  deleteSkill(name: string): void {
    SkillName.parse(name);
    rmSync(join(this.skillsDir, name), { recursive: true, force: true });
  }

  /** An agent wants to create, patch or delete a skill: stage it for the owner. */
  proposeSkill(agentId: string, runId: string, p: { name: string; action: "create" | "patch" | "delete"; content: string; reason: string }): { id: string } | { error: string } {
    const existing = this.skill(p.name);
    if (p.action !== "delete") {
      try {
        const parsed = parseSkill(p.content);
        if (parsed.name !== p.name) return { error: `frontmatter name "${parsed.name}" does not match "${p.name}"` };
      } catch (err) {
        return { error: (err as Error).message };
      }
      if (p.action === "create" && existing) return { error: `skill "${p.name}" already exists; use patch` };
      if (p.action === "patch" && !existing) return { error: `skill "${p.name}" does not exist; use create` };
    } else if (!existing) return { error: `skill "${p.name}" does not exist` };
    const id = newId("prp");
    this.store.transact((tx, emit) => {
      tx.insert(proposals)
        .values({ id, kind: "skill", agent_id: agentId, run_id: runId, name: p.name, action: p.action, content: p.content, previous: existing?.content ?? null, reason: p.reason })
        .run();
      emit({ type: "skill.proposed", payload: { proposal_id: id, name: p.name, action: p.action } }, { run_id: runId, agent_id: agentId });
    });
    return { id };
  }

  // ---------------------------------------------------------------- proposals

  #toProposal(r: typeof proposals.$inferSelect): Proposal {
    const warnings: string[] = [];
    if (r.kind === "skill") {
      const problem = memoryContentProblem(r.content);
      if (problem) warnings.push(problem);
      if (/\b(curl|wget|Invoke-WebRequest|rm -rf|del \/s)\b/i.test(r.content)) warnings.push("tells the agent to run download/delete commands: read carefully");
    }
    return { ...r, warnings } as Proposal;
  }

  proposals(status?: "pending"): Proposal[] {
    const q = this.db.select().from(proposals);
    return (status ? q.where(eq(proposals.status, status)) : q).orderBy(desc(proposals.created_at)).limit(200).all().map((r) => this.#toProposal(r));
  }

  decide(id: string, decision: "approve" | "reject"): Proposal {
    const row = this.db.select().from(proposals).where(eq(proposals.id, id)).get();
    if (!row) throw new HttpError(404, "proposal not found");
    if (row.status !== "pending") throw new HttpError(409, `proposal is already ${row.status}`);
    let status: "approved" | "rejected" = decision === "approve" ? "approved" : "rejected";
    let error: string | null = null;
    if (status === "approved") {
      try {
        if (row.kind === "skill") {
          if (row.action === "delete") this.deleteSkill(row.name);
          else this.writeSkill(row.content);
        } else {
          const r = this.#apply(row.agent_id, row.name as MemoryTarget, MemoryOp.array().parse(JSON.parse(row.content)));
          if (!r.ok) throw new Error(r.error);
        }
      } catch (err) {
        status = "rejected";
        error = (err as Error).message;
      }
    }
    const at = new Date().toISOString();
    this.store.transact((tx, emit) => {
      tx.update(proposals).set({ status, error, decided_at: at }).where(and(eq(proposals.id, id), eq(proposals.status, "pending"))).run();
      if (row.kind === "skill") emit({ type: "skill.decided", payload: { proposal_id: id, name: row.name, status } }, { agent_id: row.agent_id });
    });
    return this.#toProposal({ ...row, status, error, decided_at: at });
  }

  // ---------------------------------------------------------------- session search (FTS5)

  index(run: { run_id: string; agent_id: string; job_type: string; ts: string; title: string; body: string }): void {
    const sqlite = this.#sqlite();
    sqlite.query("DELETE FROM search_index WHERE run_id = ?").run(run.run_id);
    sqlite.query("INSERT INTO search_index (run_id, agent_id, job_type, ts, title, body) VALUES (?, ?, ?, ?, ?, ?)").run(run.run_id, run.agent_id, run.job_type, run.ts, run.title, run.body.slice(0, 50_000));
  }

  indexed(runId: string): boolean {
    return !!this.#sqlite().query("SELECT 1 FROM search_index WHERE run_id = ?").get(runId);
  }

  search(query: string, agentId: string | null, limit = 8): SearchHit[] {
    // words only, each quoted: user text never becomes FTS syntax
    const terms = query.match(/[\p{L}\p{N}]{2,}/gu)?.slice(0, 12) ?? [];
    if (!terms.length) return [];
    const match = terms.map((t) => `"${t}"`).join(" OR ");
    const where = agentId ? "search_index MATCH ? AND agent_id = ?" : "search_index MATCH ?";
    const args = agentId ? [match, agentId] : [match];
    return this.#sqlite()
      .query(`SELECT run_id, agent_id, job_type, ts, title, snippet(search_index, 5, '[', ']', ' … ', 24) AS snippet FROM search_index WHERE ${where} ORDER BY rank LIMIT ${Math.min(limit, 20)}`)
      .all(...args) as SearchHit[];
  }

  #sqlite() {
    return (this.db as unknown as { $client: import("bun:sqlite").Database }).$client;
  }
}
