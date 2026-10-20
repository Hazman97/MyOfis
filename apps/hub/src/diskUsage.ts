import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { AgentConfig } from "@agent-office/shared";
import type { Db } from "./db/client.ts";
import { agents } from "./db/schema.ts";
import type { HubConfig } from "./env.ts";
import { HttpError } from "./repo.ts";

/**
 * Settings → Storage (owner request, 2026-10-20): every place on this PC where the office keeps
 * data, how big it is, and a button that opens it in the file manager. Only the listed places can
 * be opened (never a path from the request). Sizes are walked in the background and cached.
 */
export interface DiskPlace {
  key: string;
  label: string;
  what: string;
  path: string;
  group: "data" | "runner" | "tools";
  exists: boolean;
  /** null while it is being measured, or for a place that does not exist. */
  bytes: number | null;
  files: number | null;
  /** The walk stopped at the file limit: the size is at least this. */
  partial: boolean;
}

/** Big folders (workspaces, uploads) are not walked past this many entries. */
const WALK_LIMIT = 200_000;
const CACHE_MS = 60_000;

export async function folderSize(path: string, limit = WALK_LIMIT): Promise<{ bytes: number; files: number; partial: boolean }> {
  let bytes = 0;
  let files = 0;
  let seen = 0;
  const stack = [path];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (++seen > limit) return { bytes, files, partial: true };
      const p = join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try {
          bytes += (await lstat(p)).size;
          files++;
        } catch {
          /* removed meanwhile */
        }
      }
    }
  }
  return { bytes, files, partial: false };
}

export class DiskUsage {
  #cache: { at: number; items: DiskPlace[] } | null = null;
  #measuring: Promise<void> | null = null;

  constructor(
    private readonly db: Db,
    private readonly config: HubConfig,
    private readonly env: Record<string, string | undefined> = process.env,
  ) {}

  /** The places, without sizes. Runner-side places are the defaults on this PC (the runner runs from the repo). */
  places(): Omit<DiskPlace, "exists" | "bytes" | "files" | "partial">[] {
    const home = this.env.USERPROFILE ?? homedir();
    const local = this.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    const db = this.config.databasePath;
    const out: Omit<DiskPlace, "exists" | "bytes" | "files" | "partial">[] = [
      { key: "database", label: "Database", what: "Agents, jobs, events, drafts, settings (SQLite)", path: db, group: "data" },
      { key: "files", label: "Files", what: "Uploads, videos, renders, documents", path: this.config.filesDir, group: "data" },
      { key: "backups", label: "Backups", what: "Nightly database copies + mirrored files", path: this.config.backup.dir, group: "data" },
      { key: "projects", label: "Project briefs", what: "projects/<slug>/brief.yaml", path: this.config.projectsDir, group: "data" },
      { key: "skills", label: "Skills", what: "skills/<name>/SKILL.md", path: this.config.skillsDir, group: "data" },
      { key: "logs", label: "Logs", what: "Hub and runner logs (background mode)", path: resolve(dirname(db === ":memory:" ? "data/x" : db), "logs"), group: "data" },
      { key: "workspaces", label: "Run workspaces", what: "One folder per run (downloads, renders); safe to clear old ones", path: resolve(this.env.WORKSPACES_DIR ?? "workspaces"), group: "runner" },
      { key: "openchatcut-media", label: "OpenChatCut media", what: "Videos copied for OpenChatCut imports", path: this.env.OPENCHATCUT_MEDIA_DIR?.trim() || join(home, "Videos", "MyOfis-OpenChatCut"), group: "runner" },
      { key: "myofis-local", label: "Editor window + sessions", what: "OpenChatCut editor window profile and saved sessions", path: join(local, "MyOfis"), group: "runner" },
      { key: "whisper", label: "Whisper", what: "Speech-to-text program and model", path: this.env.WHISPER_CPP ? dirname(this.env.WHISPER_CPP) : "C:\\whisper", group: "tools" },
    ];
    // each agent's clip folder (TikTok / Misi 1K)
    const folders = new Map<string, string>();
    for (const a of this.db.select({ name: agents.name, config: agents.config }).from(agents).all()) {
      const f = (a.config as AgentConfig).clip_folder?.trim();
      if (f && !folders.has(f)) folders.set(f, a.name);
    }
    let n = 0;
    for (const [path, name] of folders) out.push({ key: `clips-${++n}`, label: `Clip folder (${name})`, what: "Your clips for faceless videos", path, group: "runner" });
    return out;
  }

  /** The places with sizes (cached for a minute; the first call answers at once and measures in the background). */
  /** `measuring`: newer sizes are being worked out; ask again with wait to get them. */
  async list(wait = false): Promise<{ items: DiskPlace[]; measured_at: string | null; measuring: boolean }> {
    if (this.#cache && Date.now() - this.#cache.at < CACHE_MS) return { items: this.#cache.items, measured_at: new Date(this.#cache.at).toISOString(), measuring: false };
    // a failed walk (permissions, a folder removed meanwhile) must never become an unhandled rejection
    const run = (this.#measuring ??= this.#measure()
      .catch((err) => console.error(`[storage] measuring failed: ${(err as Error).message}`))
      .finally(() => (this.#measuring = null)));
    if (wait || this.#cache) {
      if (wait) await run;
      if (this.#cache) return { items: this.#cache.items, measured_at: new Date(this.#cache.at).toISOString(), measuring: !wait };
    }
    return { items: this.places().map((p) => ({ ...p, exists: existsSync(p.path), bytes: null, files: null, partial: false })), measured_at: null, measuring: true };
  }

  async #measure(): Promise<void> {
    const items: DiskPlace[] = [];
    for (const p of this.places()) {
      if (!existsSync(p.path)) {
        items.push({ ...p, exists: false, bytes: null, files: null, partial: false });
        continue;
      }
      let isFile = false;
      try {
        isFile = statSync(p.path).isFile();
      } catch {
        items.push({ ...p, exists: false, bytes: null, files: null, partial: false });
        continue;
      }
      if (isFile) {
        // the database: count its WAL/SHM files too
        const parts = [p.path, `${p.path}-wal`, `${p.path}-shm`].filter((f) => existsSync(f));
        items.push({ ...p, exists: true, bytes: parts.reduce((s, f) => s + statSync(f).size, 0), files: parts.length, partial: false });
        continue;
      }
      const s = await folderSize(p.path);
      items.push({ ...p, exists: true, bytes: s.bytes, files: s.files, partial: s.partial });
    }
    this.#cache = { at: Date.now(), items };
  }

  /** Open a listed place in the file manager of this PC (a file is shown selected in its folder). */
  open(key: string): { opened: string } {
    const place = this.places().find((p) => p.key === key);
    if (!place) throw new HttpError(404, "unknown place");
    if (!existsSync(place.path)) throw new HttpError(404, `${place.path} does not exist yet`);
    const isFile = statSync(place.path).isFile();
    const argv =
      process.platform === "win32"
        ? ["explorer.exe", isFile ? `/select,${place.path}` : place.path]
        : process.platform === "darwin"
          ? ["open", isFile ? "-R" : "", place.path].filter(Boolean)
          : ["xdg-open", isFile ? dirname(place.path) : place.path];
    const child = spawn(argv[0]!, argv.slice(1), { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    return { opened: place.path };
  }
}
