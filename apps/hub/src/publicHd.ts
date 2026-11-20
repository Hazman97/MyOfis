import { Database } from "bun:sqlite";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, openSync, closeSync, readSync, writeSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { setPriority } from "node:os";
import { basename, join } from "node:path";
import {
  TIMEZONE,
  freshFetch,
  type HdTarget,
  type PublicHdSettings,
  type PublicHdTargetResult,
  type TikTokHdMode,
} from "@agent-office/shared";
import { HD_SUFFIX, buildHdArgs, ffmpegBin, ffprobeBin, parseProbe, type Encoder, type VideoProbe } from "@agent-office/tools";

export interface PublicHdConfig {
  dir: string;
  secretsKey: string;
  turnstile: { siteKey: string; secret: string; apiBase: string };
  getSettings: () => PublicHdSettings;
  now?: () => number;
  onStorageFull?: (usedBytes: number, capBytes: number) => Promise<void> | void;
}

export interface PublicHdJobRow {
  id: string;
  ip_hash: string;
  name: string;
  size: number;
  targets: HdTarget[];
  mode: TikTokHdMode;
  status: "queued" | "processing" | "done" | "failed";
  error: string | null;
  results: PublicHdTargetResult[];
  created_at: number;
  done_at: number | null;
}

export interface PublicHdAccessRow {
  id: number;
  ip_hash: string;
  size: number;
  created_at: number;
  result: string;
  detail: string | null;
}

export class PublicHdError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 413 | 429 | 500 | 507,
    message: string,
  ) {
    super(message);
  }
}

const PART_KEY_RE = /^[a-zA-Z0-9_-]{8,64}$/;
const JOB_ID_RE = /^[a-f0-9]{32}$/;

function klDayParts(ms: number): { date: string; hour: number; dayStartMs: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour ?? 0) % 24;
  // KL is UTC+8 with no DST
  const dayStartMs = Date.parse(`${date}T00:00:00+08:00`);
  return { date, hour, dayStartMs };
}

/**
 * The container, from the file's first bytes: only MP4/MOV (ISO BMFF "ftyp") and Matroska/WebM (EBML).
 * ffmpeg picks its demuxer by content, so an upload that is really an ffconcat list or a playlist
 * would make it open other files on this PC (checked 2026-11-20: ffconcat reads a neighbour's upload).
 */
export function sniffContainer(head: Uint8Array): "mov" | "matroska" | null {
  const ascii = (a: number, b: number) => String.fromCharCode(...head.subarray(a, b));
  if (head.length >= 12 && ascii(4, 8) === "ftyp") return "mov";
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "matroska";
  return null;
}

/** ffprobe format names we accept (the same two families as sniffContainer). */
const SAFE_FORMATS = /^(mov,mp4,m4a,3gp,3g2,mj2|matroska,webm)$/;

function readHead(path: string, n = 64): Uint8Array {
  const fd = openSync(path, "r");
  try {
    const buf = new Uint8Array(n);
    const got = readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, got);
  } finally {
    closeSync(fd);
  }
}

function dirSize(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    try {
      const st = statSync(p);
      if (st.isFile()) total += st.size;
      else if (st.isDirectory()) total += dirSize(p);
    } catch {
      // ignore vanished temp file
    }
  }
  return total;
}

function emptyDir(dir: string): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    rmSync(join(dir, name), { recursive: true, force: true });
  }
}

async function spawnLogged(cmd: string[], cwd: string, lowerPriority = false): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({ cmd, cwd, stdout: "pipe", stderr: "pipe" });
  if (lowerPriority && proc.pid) {
    try {
      setPriority(proc.pid, 19);
    } catch {
      // ignore if OS/container disallows priority change
    }
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

/**
 * Isolated public Video HD processor & queue.
 * Uses its own SQLite database (public-hd.db) and incoming/out folders; never touches owner tables.
 */
export class PublicHd {
  readonly dir: string;
  readonly incomingDir: string;
  readonly outDir: string;
  readonly dbPath: string;
  readonly db: Database;
  readonly #cfg: PublicHdConfig;
  readonly #now: () => number;
  /** Uploads in progress: one per visitor, sent in order; their full sizes count toward the storage cap. */
  readonly #authorizedParts = new Map<string, { ipHash: string; at: number; total: number; received: number }>();
  #running: Promise<void> | null = null;
  #nvencOk: boolean | null = null;

  constructor(cfg: PublicHdConfig) {
    this.#cfg = cfg;
    this.#now = cfg.now ?? (() => Date.now());
    this.dir = cfg.dir;
    this.incomingDir = join(this.dir, "incoming");
    this.outDir = join(this.dir, "out");
    this.dbPath = join(this.dir, "public-hd.db");

    mkdirSync(this.incomingDir, { recursive: true });
    mkdirSync(this.outDir, { recursive: true });

    this.db = new Database(this.dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS public_hd_jobs (
        id TEXT PRIMARY KEY,
        ip_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        size INTEGER NOT NULL,
        targets TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        results TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        done_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_pubhd_created ON public_hd_jobs(created_at);
      CREATE INDEX IF NOT EXISTS idx_pubhd_ip_created ON public_hd_jobs(ip_hash, created_at);
      CREATE INDEX IF NOT EXISTS idx_pubhd_status ON public_hd_jobs(status);

      CREATE TABLE IF NOT EXISTS public_hd_access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip_hash TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        result TEXT NOT NULL,
        detail TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pubhd_log_created ON public_hd_access_log(created_at);

      CREATE TABLE IF NOT EXISTS public_hd_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Any job left "processing" on crash is marked failed so it doesn't stall the queue
    this.db.run(`UPDATE public_hd_jobs SET status = 'failed', error = 'Terhenti semasa pelayan dimulakan semula', done_at = ? WHERE status = 'processing'`, [this.#now()]);
  }

  close(): void {
    this.db.close();
  }

  hashIp(ip: string): string {
    return createHmac("sha256", this.#cfg.secretsKey).update(ip || "unknown").digest("hex");
  }

  turnstileEnabled(): boolean {
    return Boolean(this.#cfg.turnstile.siteKey && this.#cfg.turnstile.secret);
  }

  storageBytes(): number {
    return dirSize(this.incomingDir) + dirSize(this.outDir) + (existsSync(this.dbPath) ? statSync(this.dbPath).size : 0);
  }

  #logAccess(ipHash: string, size: number, result: string, detail?: string): void {
    this.db.run(
      `INSERT INTO public_hd_access_log (ip_hash, size, created_at, result, detail) VALUES (?, ?, ?, ?, ?)`,
      [ipHash, size, this.#now(), result, detail ?? null],
    );
  }

  #getMeta(key: string): string | null {
    const row = this.db.query<{ value: string }, [string]>(`SELECT value FROM public_hd_meta WHERE key = ?`).get(key);
    return row?.value ?? null;
  }

  #setMeta(key: string, value: string): void {
    this.db.run(`INSERT INTO public_hd_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, value]);
  }

  async #verifyTurnstile(token: string | undefined, remoteIp: string): Promise<boolean> {
    if (!this.turnstileEnabled()) return true;
    if (!token?.trim()) return false;
    try {
      const form = new URLSearchParams({
        secret: this.#cfg.turnstile.secret,
        response: token.trim(),
        ...(remoteIp ? { remoteip: remoteIp } : {}),
      });
      const res = await freshFetch(`${this.#cfg.turnstile.apiBase}/turnstile/v0/siteverify`, {
        method: "POST",
        timeoutMs: 10_000,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { success?: boolean };
      return data.success === true;
    } catch {
      return false;
    }
  }

  async putPart(opts: {
    key: string;
    name: string;
    total: number;
    offset: number;
    bytes: Uint8Array;
    targets: HdTarget[];
    mode: TikTokHdMode;
    ip: string;
    turnstileToken?: string;
  }): Promise<{ part: true; received: number } | { part: false; id: string }> {
    if (!PART_KEY_RE.test(opts.key)) throw new PublicHdError(400, "Kunci muat naik tidak sah");
    if (!opts.targets.length) throw new PublicHdError(400, "Pilih sekurang-kurangnya satu sasaran");
    if (opts.offset + opts.bytes.byteLength > opts.total) throw new PublicHdError(400, "Saiz bahagian melebihi jumlah fail");

    const settings = this.#cfg.getSettings();
    const ipHash = this.hashIp(opts.ip);
    const now = this.#now();

    if (!settings.enabled) {
      this.#logAccess(ipHash, opts.total, "refused_disabled");
      throw new PublicHdError(403, "Ditutup sementara");
    }

    if (opts.offset === 0) {
      if (this.turnstileEnabled()) {
        const ok = await this.#verifyTurnstile(opts.turnstileToken, opts.ip);
        if (!ok) {
          this.#logAccess(ipHash, opts.total, "refused_turnstile");
          throw new PublicHdError(403, "Pengesahan keselamatan (Turnstile) gagal");
        }
      }

      const maxBytes = settings.max_mb * 1024 * 1024;
      if (opts.total > maxBytes) {
        this.#logAccess(ipHash, opts.total, "refused_size", `${opts.total} > ${maxBytes}`);
        throw new PublicHdError(413, `Fail terlalu besar (had ${settings.max_mb} MB)`);
      }

      // one upload at a time per visitor, and no more uploads in flight than the queue takes
      this.#dropStaleParts(now);
      const pending = [...this.#authorizedParts].filter(([k]) => k !== opts.key);
      if (pending.some(([, p]) => p.ipHash === ipHash)) {
        this.#logAccess(ipHash, opts.total, "refused_parallel");
        throw new PublicHdError(429, "Satu muat naik pada satu masa");
      }
      if (pending.length >= settings.max_queue) {
        this.#logAccess(ipHash, opts.total, "refused_busy");
        throw new PublicHdError(429, "Sibuk, cuba lagi nanti");
      }

      const capBytes = settings.storage_cap_gb * 1024 ** 3;
      // files on disk plus the full size of every upload still arriving
      const usedBytes = this.storageBytes() + pending.reduce((s, [, p]) => s + Math.max(0, p.total - p.received), 0);
      if (usedBytes + opts.total > capBytes) {
        this.#logAccess(ipHash, opts.total, "refused_storage");
        if (!this.#getMeta("storage_alert_sent_at")) {
          this.#setMeta("storage_alert_sent_at", String(now));
          await this.#cfg.onStorageFull?.(usedBytes, capBytes);
        }
        throw new PublicHdError(507, "Storan sementara penuh, cuba lagi nanti");
      }

      const active = this.db.query<{ n: number }, []>(`SELECT count(*) AS n FROM public_hd_jobs WHERE status IN ('queued', 'processing')`).get()?.n ?? 0;
      if (active >= settings.max_queue) {
        this.#logAccess(ipHash, opts.total, "refused_busy");
        throw new PublicHdError(429, "Sibuk, cuba lagi nanti");
      }

      const { dayStartMs } = klDayParts(now);
      const dailyTotal = this.db.query<{ n: number }, [number]>(`SELECT count(*) AS n FROM public_hd_jobs WHERE created_at >= ?`).get(dayStartMs)?.n ?? 0;
      if (dailyTotal >= settings.daily_total) {
        this.#logAccess(ipHash, opts.total, "refused_daily");
        throw new PublicHdError(429, "Had harian perkhidmatan telah dicapai, cuba esok");
      }

      const hourStart = now - 3600_000;
      const ipHour = this.db.query<{ n: number }, [string, number]>(`SELECT count(*) AS n FROM public_hd_jobs WHERE ip_hash = ? AND created_at >= ?`).get(ipHash, hourStart)?.n ?? 0;
      if (ipHour >= settings.per_ip_hour) {
        this.#logAccess(ipHash, opts.total, "refused_ip_hour");
        throw new PublicHdError(429, `Had ${settings.per_ip_hour} video sejam bagi setiap pengguna telah dicapai`);
      }

      const ipDay = this.db.query<{ n: number }, [string, number]>(`SELECT count(*) AS n FROM public_hd_jobs WHERE ip_hash = ? AND created_at >= ?`).get(ipHash, dayStartMs)?.n ?? 0;
      if (ipDay >= settings.per_ip_day) {
        this.#logAccess(ipHash, opts.total, "refused_ip_day");
        throw new PublicHdError(429, `Had ${settings.per_ip_day} video sehari bagi setiap pengguna telah dicapai`);
      }

      this.#authorizedParts.set(opts.key, { ipHash, at: now, total: opts.total, received: 0 });
    } else {
      const auth = this.#authorizedParts.get(opts.key);
      if (!auth || auth.ipHash !== ipHash || auth.total !== opts.total) {
        throw new PublicHdError(403, "Sesi muat naik tidak sah");
      }
      // parts arrive in order: no gaps, so the queued file is exactly what was sent
      if (opts.offset !== auth.received) throw new PublicHdError(400, `Bahagian tidak mengikut turutan (dijangka ${auth.received})`);
    }
    const authEntry = this.#authorizedParts.get(opts.key)!;

    const partPath = join(this.incomingDir, `${opts.key}.part`);
    const fd = openSync(partPath, opts.offset === 0 ? "w" : "r+");
    try {
      writeSync(fd, opts.bytes, 0, opts.bytes.byteLength, opts.offset);
    } finally {
      closeSync(fd);
    }

    const received = opts.offset + opts.bytes.byteLength;
    authEntry.received = received;
    authEntry.at = now;
    if (received < opts.total) {
      return { part: true, received };
    }

    this.#authorizedParts.delete(opts.key);
    const id = randomBytes(16).toString("hex");
    const safeName = (basename(opts.name).replace(/[^\w.\- ()]/g, "_") || "video.mp4").slice(0, 200);
    const inputPath = join(this.incomingDir, `${id}.input`);
    renameSync(partPath, inputPath);

    this.db.run(
      `INSERT INTO public_hd_jobs (id, ip_hash, name, size, targets, mode, status, results, created_at) VALUES (?, ?, ?, ?, ?, ?, 'queued', '[]', ?)`,
      [id, ipHash, safeName, opts.total, JSON.stringify(opts.targets), opts.mode, now],
    );
    this.#logAccess(ipHash, opts.total, "queued", safeName);
    this.#pump();
    return { part: false, id };
  }

  getJob(id: string): (PublicHdJobRow & { queue_position: number }) | null {
    if (!JOB_ID_RE.test(id)) return null;
    const row = this.db
      .query<{
        id: string;
        ip_hash: string;
        name: string;
        size: number;
        targets: string;
        mode: string;
        status: PublicHdJobRow["status"];
        error: string | null;
        results: string;
        created_at: number;
        done_at: number | null;
      }, [string]>(`SELECT * FROM public_hd_jobs WHERE id = ?`)
      .get(id);
    if (!row) return null;

    let queue_position = 0;
    if (row.status === "queued") {
      const ahead = this.db
        .query<{ n: number }, [number]>(`SELECT count(*) AS n FROM public_hd_jobs WHERE status IN ('processing', 'queued') AND created_at < ?`)
        .get(row.created_at)?.n ?? 0;
      queue_position = ahead + 1;
    }

    return {
      id: row.id,
      ip_hash: row.ip_hash,
      name: row.name,
      size: row.size,
      targets: JSON.parse(row.targets) as HdTarget[],
      mode: row.mode as TikTokHdMode,
      status: row.status,
      error: row.error,
      results: JSON.parse(row.results) as PublicHdTargetResult[],
      created_at: row.created_at,
      done_at: row.done_at,
      queue_position,
    };
  }

  resultFilePath(id: string, target: HdTarget): { path: string; downloadName: string } | null {
    const job = this.getJob(id);
    if (!job || job.status !== "done") return null;
    const res = job.results.find((r) => r.target === target);
    if (!res) return null;
    // Construct path strictly from validated job.id + fixed HD_SUFFIX (never from request)
    const filePath = join(this.outDir, `${job.id}${HD_SUFFIX[target]}.mp4`);
    if (!existsSync(filePath)) return null;
    const base = job.name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_").slice(0, 60) || "video";
    return { path: filePath, downloadName: `${base}${HD_SUFFIX[target]}.mp4` };
  }

  async waitIdle(): Promise<void> {
    while (this.#running) await this.#running;
  }

  #pump(): void {
    if (this.#running) return;
    this.#running = this.#processLoop().finally(() => {
      this.#running = null;
      const more = this.db.query<{ id: string }, []>(`SELECT id FROM public_hd_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`).get();
      if (more) this.#pump();
    });
  }

  async #processLoop(): Promise<void> {
    for (;;) {
      const next = this.db.query<{ id: string }, []>(`SELECT id FROM public_hd_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`).get();
      if (!next) break;
      await this.#processOne(next.id);
    }
  }

  #dropStaleParts(now: number): void {
    for (const [k, p] of this.#authorizedParts) if (p.at <= now - 2 * 3600_000) this.#authorizedParts.delete(k);
  }

  async #probeFile(bin: string, filePath: string): Promise<VideoProbe> {
    // only real MP4/MOV/MKV/WebM reach ffprobe / ffmpeg (see sniffContainer)
    const kind = sniffContainer(readHead(filePath));
    if (!kind) throw new Error("Bukan fail video yang sah (MP4, MOV, MKV atau WebM sahaja)");
    const r = await spawnLogged([bin, "-v", "error", "-f", kind, "-print_format", "json", "-show_format", "-show_streams", filePath], this.dir, false);
    if (r.code !== 0) throw new Error("Bukan fail video yang sah");
    const json = JSON.parse(r.stdout) as { format?: { format_name?: string } };
    if (!SAFE_FORMATS.test(json.format?.format_name ?? "")) throw new Error("Bukan fail video yang sah");
    const probed = parseProbe(json);
    if (!probed.width || !probed.height || probed.duration <= 0) {
      throw new Error("Fail tidak mengandungi strim video yang sah");
    }
    return probed;
  }

  async #processOne(id: string): Promise<void> {
    const job = this.getJob(id);
    if (!job) return;
    const inputPath = join(this.incomingDir, `${id}.input`);
    this.db.run(`UPDATE public_hd_jobs SET status = 'processing' WHERE id = ?`, [id]);

    try {
      const ffprobe = ffprobeBin();
      const ffmpeg = ffmpegBin();
      if (!ffprobe || !ffmpeg) throw new Error("ffmpeg / ffprobe tiada pada pelayan");
      if (!existsSync(inputPath)) throw new Error("Fail input hilang");

      let before: VideoProbe;
      try {
        before = await this.#probeFile(ffprobe, inputPath);
      } catch (err) {
        this.#logAccess(job.ip_hash, job.size, "refused_not_video", (err as Error).message);
        throw new Error("Bukan fail video yang sah");
      }

      const settings = this.#cfg.getSettings();
      if (before.duration > settings.max_minutes * 60) {
        this.#logAccess(job.ip_hash, job.size, "refused_duration", `${Math.round(before.duration)}s`);
        throw new Error(`Video terlalu panjang (${Math.round(before.duration / 60)} minit; had ${settings.max_minutes} minit)`);
      }

      if (this.#nvencOk === null) {
        const encCheck = await spawnLogged([ffmpeg, "-hide_banner", "-encoders"], this.dir, false);
        this.#nvencOk = encCheck.stdout.includes("h264_nvenc");
      }

      const results: PublicHdTargetResult[] = [];
      for (const target of job.targets) {
        const outName = `${id}${HD_SUFFIX[target]}.mp4`;
        const outPath = join(this.outDir, outName);

        let encoder: Encoder = this.#nvencOk ? "nvenc" : "x264";
        let built = buildHdArgs(inputPath, outPath, before, target, job.mode, encoder);
        let r = await spawnLogged([ffmpeg, ...built.args], this.dir, true);
        if (r.code !== 0 && encoder === "nvenc" && built.plan.mode === "reencode") {
          this.#nvencOk = false;
          encoder = "x264";
          built = buildHdArgs(inputPath, outPath, before, target, job.mode, encoder);
          r = await spawnLogged([ffmpeg, ...built.args], this.dir, true);
        }
        if (r.code !== 0) {
          throw new Error(`Pemprosesan ${target} gagal: ${r.stderr.slice(-240)}`);
        }

        const after = await this.#probeFile(ffprobe, outPath);
        results.push({
          target,
          mode: built.plan.mode,
          file: outName,
          size_bytes: after.size_bytes,
          width: after.width,
          height: after.height,
          fps: after.fps,
          codec: after.video_codec,
          duration: after.duration,
          reasons: built.plan.reasons,
          warnings: built.plan.warnings,
        });
      }

      const doneAt = this.#now();
      this.db.run(`UPDATE public_hd_jobs SET status = 'done', results = ?, done_at = ? WHERE id = ?`, [JSON.stringify(results), doneAt, id]);
      const outBytes = results.reduce((s, r) => s + r.size_bytes, 0);
      this.#logAccess(job.ip_hash, outBytes, "done", `${results.length} target(s)`);
    } catch (err) {
      const msg = (err as Error).message || "Pemprosesan gagal";
      this.db.run(`UPDATE public_hd_jobs SET status = 'failed', error = ?, done_at = ? WHERE id = ?`, [msg.slice(0, 400), this.#now(), id]);
      this.#logAccess(job.ip_hash, job.size, "failed", msg.slice(0, 200));
    } finally {
      // Always delete the incoming upload immediately on completion or failure
      rmSync(inputPath, { force: true });
    }
  }

  /** Delete expired outputs (> retention_hours), stale partial uploads (> 2h), and access logs (> 30 days). */
  sweep(now = this.#now()): { deleted_jobs: number; deleted_logs: number } {
    const retentionMs = this.#cfg.getSettings().retention_hours * 3600_000;
    const cutoff = now - retentionMs;
    const expired = this.db
      .query<{ id: string; targets: string }, [number]>(
        `SELECT id, targets FROM public_hd_jobs WHERE status IN ('done', 'failed') AND COALESCE(done_at, created_at) <= ?`,
      )
      .all(cutoff);

    for (const row of expired) {
      for (const t of JSON.parse(row.targets) as HdTarget[]) {
        rmSync(join(this.outDir, `${row.id}${HD_SUFFIX[t]}.mp4`), { force: true });
      }
      rmSync(join(this.incomingDir, `${row.id}.input`), { force: true });
      this.db.run(`DELETE FROM public_hd_jobs WHERE id = ?`, [row.id]);
    }

    this.#dropStaleParts(now);
    // Stale partial uploads > 2 hours
    if (existsSync(this.incomingDir)) {
      for (const f of readdirSync(this.incomingDir)) {
        if (!f.endsWith(".part")) continue;
        const p = join(this.incomingDir, f);
        try {
          if (statSync(p).mtimeMs <= now - 2 * 3600_000) rmSync(p, { force: true });
        } catch {
          // ignore
        }
      }
    }

    const logCutoff = now - 30 * 86400_000;
    const logDel = this.db.run(`DELETE FROM public_hd_access_log WHERE created_at <= ?`, [logCutoff]);
    if (this.storageBytes() < this.#cfg.getSettings().storage_cap_gb * 1024 ** 3 * 0.9) {
      this.db.run(`DELETE FROM public_hd_meta WHERE key = 'storage_alert_sent_at'`);
    }
    return { deleted_jobs: expired.length, deleted_logs: logDel.changes };
  }

  clearAll(): { deleted_jobs: number } {
    const count = this.db.query<{ n: number }, []>(`SELECT count(*) AS n FROM public_hd_jobs`).get()?.n ?? 0;
    emptyDir(this.incomingDir);
    emptyDir(this.outDir);
    this.db.run(`DELETE FROM public_hd_jobs`);
    this.db.run(`DELETE FROM public_hd_meta WHERE key = 'storage_alert_sent_at'`);
    this.#authorizedParts.clear();
    return { deleted_jobs: count };
  }

  stats(now = this.#now()) {
    const { dayStartMs } = klDayParts(now);
    const todayCount = this.db.query<{ n: number }, [number]>(`SELECT count(*) AS n FROM public_hd_jobs WHERE created_at >= ?`).get(dayStartMs)?.n ?? 0;
    const activeCount = this.db.query<{ n: number }, []>(`SELECT count(*) AS n FROM public_hd_jobs WHERE status IN ('queued', 'processing')`).get()?.n ?? 0;
    const recentLogs = this.db.query<PublicHdAccessRow, []>(`SELECT id, ip_hash, size, created_at, result, detail FROM public_hd_access_log ORDER BY id DESC LIMIT 30`).all();
    return {
      today_count: todayCount,
      active_count: activeCount,
      storage_bytes: this.storageBytes(),
      turnstile_configured: this.turnstileEnabled(),
      recent_logs: recentLogs,
    };
  }

  /** Returns a 1-line Telegram digest once per day at/after 21:00 KL, or null if not due. */
  dailyDigestIfDue(now = this.#now()): string | null {
    const { date, hour, dayStartMs } = klDayParts(now);
    if (hour < 21) return null;
    if (this.#getMeta("last_digest_date") === date) return null;
    this.#setMeta("last_digest_date", date);

    const jobsToday = this.db
      .query<{ status: string; size: number; results: string }, [number]>(`SELECT status, size, results FROM public_hd_jobs WHERE created_at >= ?`)
      .all(dayStartMs);
    let done = 0;
    let failed = 0;
    let bytesIn = 0;
    let bytesOut = 0;
    for (const j of jobsToday) {
      bytesIn += j.size;
      if (j.status === "done") {
        done++;
        for (const r of JSON.parse(j.results) as PublicHdTargetResult[]) bytesOut += r.size_bytes;
      } else if (j.status === "failed") {
        failed++;
      }
    }
    const refused = this.db
      .query<{ n: number }, [number]>(`SELECT count(*) AS n FROM public_hd_access_log WHERE created_at >= ? AND result LIKE 'refused_%'`)
      .get(dayStartMs)?.n ?? 0;
    if (!done && !failed && !refused) return null;
    const gb = (b: number) => (b / 1024 ** 3).toFixed(2);
    return `🎬 Public Video HD (${date}): ${done} siap, ${gb(bytesIn)} GB masuk → ${gb(bytesOut)} GB keluar, ${failed} gagal, ${refused} ditolak.`;
  }
}
