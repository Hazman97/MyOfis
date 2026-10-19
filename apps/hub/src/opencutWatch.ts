import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { freshFetch } from "@agent-office/shared";
import type { Db } from "./db/client.ts";
import { settings } from "./db/schema.ts";

/**
 * OpenCut watcher (owner request: "when OpenCut updates, make sure we follow"). OpenCut
 * (github.com/opencut-app/opencut, MIT) is being rewritten and has no API yet; its README lists an
 * Editor API, an MCP server and headless rendering as planned. Once a day we look at its latest
 * release and at the README lines about those, and tell the owner on Telegram when they change,
 * so Editor can be wired to OpenCut when it becomes possible. It never changes our code.
 */
const KEY = "watch.opencut";
const REPO = "opencut-app/opencut";
const DAY_MS = 24 * 3600_000;
const API_LINES = /editor api|\bmcp\b|headless|plugin/i;

interface Stored {
  checked_at: string;
  release: string | null;
  api_hash: string | null;
  api_lines: string[];
}

export class OpencutWatch {
  constructor(
    private readonly db: Db,
    private readonly apiBase = "https://api.github.com",
  ) {}

  last(): Stored | null {
    return (this.db.select().from(settings).where(eq(settings.key, KEY)).get()?.value as Stored | undefined) ?? null;
  }

  due(now = Date.now()): boolean {
    const l = this.last();
    return !l || now - Date.parse(l.checked_at) >= DAY_MS;
  }

  /** Look once. Returns the messages for the owner (none on the first look: that only records the current state). */
  async check(now = new Date()): Promise<string[]> {
    const headers = { "user-agent": "MyOfis-opencut-watch", accept: "application/vnd.github+json" };
    const rel = await freshFetch(`${this.apiBase}/repos/${REPO}/releases?per_page=1`, { headers, timeoutMs: 20_000 });
    const releases = rel.ok ? ((await rel.json()) as { tag_name?: string; name?: string; html_url?: string }[]) : [];
    const readme = await freshFetch(`${this.apiBase}/repos/${REPO}/readme`, { headers: { ...headers, accept: "application/vnd.github.raw" }, timeoutMs: 20_000 });
    if (!rel.ok && !readme.ok) throw new Error(`GitHub answered ${rel.status} / ${readme.status}`);
    const text = readme.ok ? await readme.text() : "";
    const apiLines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => API_LINES.test(l))
      .slice(0, 20);
    const latest = releases[0]?.tag_name ?? null;
    const apiHash = readme.ok ? createHash("sha256").update(apiLines.join("\n")).digest("hex").slice(0, 16) : null;

    const prev = this.last();
    const out: string[] = [];
    if (prev) {
      if (latest && latest !== prev.release) out.push(`🎬 OpenCut released ${releases[0]?.name || latest}: ${releases[0]?.html_url ?? `https://github.com/${REPO}/releases`}`);
      if (apiHash && prev.api_hash && apiHash !== prev.api_hash) {
        out.push(`🎬 OpenCut changed what its README says about the Editor API / MCP / headless rendering. If it is ready, Editor can be connected to OpenCut (ask Claude). Lines now:\n${apiLines.slice(0, 6).join("\n")}`);
      }
    }
    const value: Stored = { checked_at: now.toISOString(), release: latest ?? prev?.release ?? null, api_hash: apiHash ?? prev?.api_hash ?? null, api_lines: apiLines.length ? apiLines : (prev?.api_lines ?? []) };
    this.db.insert(settings).values({ key: KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
    return out;
  }
}
