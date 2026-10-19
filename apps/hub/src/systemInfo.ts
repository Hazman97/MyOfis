import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { is, sql } from "drizzle-orm";
import { SQLiteTable, getTableConfig } from "drizzle-orm/sqlite-core";
import { EVENT_TYPES } from "@agent-office/shared";
import { TOOL_REGISTRY } from "@agent-office/tools";
import type { Hub } from "./core.ts";
import * as schema from "./db/schema.ts";
import type { Integrations } from "./integrations.ts";

/**
 * What the System page shows (owner request: "the whole system in one page"), built from the
 * running code so it never goes stale: package versions, the database schema (for the ERD),
 * counts, and which integrations are connected. No secrets: only booleans and names.
 */
export interface SystemTable {
  name: string;
  columns: { name: string; type: string; not_null: boolean; primary: boolean }[];
  foreign_keys: { columns: string[]; table: string; foreign_columns: string[] }[];
  note?: string;
}

const REPO_ROOT = join(import.meta.dir, "../../..");
const PACKAGES = ["", "apps/hub", "apps/runner", "apps/web", "packages/shared", "packages/tools", "packages/agents"];
/** The libraries worth showing; everything else is noise on the page. */
const KEY_LIBS = new Set([
  "hono", "drizzle-orm", "drizzle-kit", "zod", "jose", "croner", "yaml", "ai", "@ai-sdk/anthropic", "@ai-sdk/openai", "@ai-sdk/google",
  "@ai-sdk/openai-compatible", "vue", "vue-router", "pinia", "phaser", "easystarjs", "tailwindcss", "vite", "lucide-vue-next", "mermaid",
  "playwright", "typescript", "pixelmatch",
]);

export function schemaTables(): SystemTable[] {
  const tables: SystemTable[] = (Object.values(schema) as unknown[])
    .filter((v): v is SQLiteTable => is(v, SQLiteTable))
    .map((t) => {
      const c = getTableConfig(t);
      return {
        name: c.name,
        columns: c.columns.map((col) => ({ name: col.name, type: col.getSQLType(), not_null: col.notNull, primary: col.primary })),
        foreign_keys: c.foreignKeys.map((fk) => {
          const r = fk.reference();
          return { columns: r.columns.map((x) => x.name), table: getTableConfig(r.foreignTable).name, foreign_columns: r.foreignColumns.map((x) => x.name) };
        }),
      };
    });
  // created by hand in migration 0004 (FTS5), not managed by Drizzle
  tables.push({
    name: "search_index",
    columns: ["run_id", "agent_id", "job_type", "ts", "title", "body"].map((name) => ({ name, type: "text", not_null: false, primary: false })),
    foreign_keys: [],
    note: "SQLite FTS5 full-text index for session_search",
  });
  tables.push({
    name: "docs_index",
    columns: ["doc_id", "workspace_id", "project_id", "page", "title", "body"].map((name) => ({ name, type: "text", not_null: false, primary: false })),
    foreign_keys: [{ columns: ["doc_id"], table: "project_docs", foreign_columns: ["id"] }],
    note: "SQLite FTS5 full-text index over project documents, one row per page",
  });
  return tables;
}

function versions(): { package: string; name: string; deps: Record<string, string> }[] {
  return PACKAGES.map((dir) => {
    const file = join(REPO_ROOT, dir, "package.json");
    if (!existsSync(file)) return null;
    const pkg = JSON.parse(readFileSync(file, "utf8")) as { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    const deps = Object.fromEntries(Object.entries(all).filter(([k]) => KEY_LIBS.has(k)).map(([k, v]) => [k, v.replace(/^[\^~]/, "")]));
    return { package: dir || "(root)", name: pkg.name ?? dir, deps };
  }).filter((x): x is NonNullable<typeof x> => !!x);
}

export function systemInfo(hub: Hub, integrations: Integrations) {
  const db = hub.db;
  const count = (t: SQLiteTable) => db.select({ n: sql<number>`count(*)` }).from(t).get()?.n ?? 0;
  const state = hub.store.state;
  const tools = Object.values(TOOL_REGISTRY);
  const projects = db.select().from(schema.projects).all();
  const uploadBytes = db.select({ n: sql<number>`coalesce(sum(${schema.uploads.size}), 0)` }).from(schema.uploads).get()?.n ?? 0;
  const ws = integrations.webSearch.public();
  return {
    generated_at: new Date().toISOString(),
    runtime: { bun: Bun.version, platform: process.platform, auth_mode: hub.config.authMode },
    versions: versions(),
    counts: {
      agents: count(schema.agents),
      agents_enabled: db.select().from(schema.agents).all().filter((a) => a.enabled).length,
      tools: tools.length,
      tool_categories: [...new Set(tools.map((t) => t.category))].length,
      event_types: EVENT_TYPES.length,
      events: state.last_event_id,
      tables: schemaTables().length,
      jobs: count(schema.jobs),
      runs: count(schema.runs),
      drafts: count(schema.contentDrafts),
      projects: projects.length,
      skills: hub.learning.skills().length,
      runners: Object.keys(state.runners).length,
      runners_online: Object.values(state.runners).filter((r) => r.online).length,
      uploads: count(schema.uploads),
      upload_mb: Math.round((uploadBytes / 1024 ** 2) * 10) / 10,
    },
    event_types: EVENT_TYPES,
    integrations: {
      telegram: !!integrations.telegram(),
      gitea: !!integrations.gitea(),
      web_search: ws.provider,
      websites: projects.filter((p) => p.publish?.info).map((p) => p.name),
      social: Object.fromEntries(projects.map((p) => [p.name, hub.social.connected(p.id)]).filter(([, s]) => (s as string[]).length)),
      backups: hub.backups.list().length,
    },
    schema: schemaTables(),
  };
}
