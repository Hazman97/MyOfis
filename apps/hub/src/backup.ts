import type { Database } from "bun:sqlite";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { TIMEZONE, dayKey } from "@agent-office/shared";

/**
 * Nightly backup (owner request): one folder per day under BACKUP_DIR with
 *  - agent-office.db  (SQLite `VACUUM INTO`: a consistent copy while the hub keeps running)
 *  - projects/        (briefs, FEATURES.md)
 *  - skills/          (approved SKILL.md files)
 * The newest `keep` days are kept. Restore = stop the hub, copy the files back.
 *
 * Uploads (the owner's photos and videos, Editor's renders) and run artifacts in FILES_DIR are
 * big and never change once written, so they are mirrored once into BACKUP_DIR/files/ instead of
 * copied every day: only new or changed files are copied, and nothing is deleted from the mirror.
 */
export interface BackupInfo {
  date: string;
  size_bytes: number;
  created_at: string;
  /** New or changed files copied into the files/ mirror by this run. */
  files_copied?: number;
}

const hourFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, hour: "2-digit", hourCycle: "h23" });
const DAY_DIR = /^\d{4}-\d{2}-\d{2}$/;

export class Backups {
  #running = false;

  constructor(
    private readonly sqlite: Database,
    private readonly opts: { dir: string; projectsDir: string; skillsDir: string; filesDir?: string; keep: number; hour: number },
  ) {}

  get dir(): string {
    return this.opts.dir;
  }

  /** Due once a day after `hour` (Malaysia time), also when the PC was off at that hour. */
  due(now = new Date()): boolean {
    const hour = Number(hourFormatter.format(now));
    return hour >= this.opts.hour && !existsSync(join(this.opts.dir, dayKey(now.toISOString())));
  }

  run(now = new Date()): BackupInfo {
    if (this.#running) throw new Error("a backup is already running");
    this.#running = true;
    const date = dayKey(now.toISOString());
    const final = join(this.opts.dir, date);
    const tmp = join(this.opts.dir, `.${date}.tmp`);
    try {
      rmSync(tmp, { recursive: true, force: true });
      mkdirSync(tmp, { recursive: true });
      this.sqlite.run(`VACUUM INTO '${join(tmp, "agent-office.db").replaceAll("'", "''")}'`);
      for (const [src, name] of [
        [this.opts.projectsDir, "projects"],
        [this.opts.skillsDir, "skills"],
      ] as const) {
        if (existsSync(src)) cpSync(src, join(tmp, name), { recursive: true });
      }
      rmSync(final, { recursive: true, force: true });
      renameSync(tmp, final);
      this.#prune();
      const files = this.opts.filesDir ? mirror(this.opts.filesDir, join(this.opts.dir, "files")) : 0;
      return { ...this.#info(date), files_copied: files };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      this.#running = false;
    }
  }

  list(): BackupInfo[] {
    if (!existsSync(this.opts.dir)) return [];
    return readdirSync(this.opts.dir)
      .filter((d) => DAY_DIR.test(d))
      .sort()
      .reverse()
      .map((d) => this.#info(d));
  }

  #prune() {
    for (const old of this.list().slice(this.opts.keep)) rmSync(join(this.opts.dir, old.date), { recursive: true, force: true });
  }

  #info(date: string): BackupInfo {
    const dir = join(this.opts.dir, date);
    return { date, size_bytes: dirSize(dir), created_at: statSync(dir).mtime.toISOString() };
  }
}

function dirSize(dir: string): number {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    n += e.isDirectory() ? dirSize(p) : statSync(p).size;
  }
  return n;
}

/** Copy files from `src` into `dst` when missing or a different size. Half-sent uploads (*.part) are skipped. Returns the count. */
export function mirror(src: string, dst: string): number {
  if (!existsSync(src)) return 0;
  let n = 0;
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, e.name);
    const to = join(dst, e.name);
    if (e.isDirectory()) {
      n += mirror(from, to);
      continue;
    }
    if (!e.isFile() || e.name.endsWith(".part")) continue;
    if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
    mkdirSync(dst, { recursive: true });
    copyFileSync(from, to);
    n++;
  }
  return n;
}
