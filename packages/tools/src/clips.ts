import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { VIDEO_TYPES } from "@agent-office/shared";
import { isSecretPath } from "./safety.ts";
import { ToolDenied, defineTool, type ToolContext } from "./types.ts";
import { ffmpegBin, mediaDir, probe, spawn } from "./video.ts";

/**
 * The owner's clip folder (TikTok agent): he drops his own videos (scenery, walking, static shots)
 * into one folder on the runner PC; the agent lists them, picks the ones that fit the theme and
 * puts them on the job, where the video tools use them like files sent in chat.
 *
 * The folder keeps a small index (.myofis-clips.json): length, a short description of what the clip
 * shows (from three thumbnails, by the run's own model), the hub upload id (so a clip is uploaded
 * once), and when it was last used (so posts do not repeat the same clip).
 */

export interface ClipEntry {
  file: string;
  size: number;
  mtime: number;
  seconds: number;
  width: number;
  height: number;
  has_audio: boolean;
  description: string;
  upload_id: string | null;
  uses: number;
  last_used: string | null;
}
interface ClipIndex {
  version: 1;
  clips: Record<string, ClipEntry>;
}

const INDEX = ".myofis-clips.json";
const MUSIC_DIR = "music";
const MUSIC_EXT = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg"]);
const TYPE_BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(VIDEO_TYPES).map(([type, ext]) => [`.${ext}`, type]));
/** New clips described per call, so a big first drop does not stall one run. */
const DESCRIBE_PER_CALL = 8;
const DESCRIBE_PROMPT =
  "These are three frames from one short video clip. In Bahasa Malaysia, describe in one short line (max 15 words) what it shows: place, time of day, mood, movement. No guessing names.";

export const clipKey = (file: string, size: number, mtime: number) => `${file}|${size}|${Math.round(mtime)}`;

/** The clip folder from the agent's settings, checked. */
export function clipFolder(ctx: ToolContext): string {
  const dir = ctx.config.clip_folder?.trim();
  if (!dir) throw new ToolDenied("no clip folder is set for this agent: the owner sets it in Agents → (agent) → Clip folder");
  if (!isAbsolute(dir) || isSecretPath(dir)) throw new ToolDenied("the clip folder must be a normal absolute folder on the runner PC");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new ToolDenied(`the clip folder ${dir} does not exist on this PC: tell the owner`);
  return dir;
}

export function readIndex(dir: string): ClipIndex {
  try {
    const j = JSON.parse(readFileSync(join(dir, INDEX), "utf8")) as ClipIndex;
    return j?.version === 1 && j.clips ? j : { version: 1, clips: {} };
  } catch {
    return { version: 1, clips: {} };
  }
}

export function writeIndex(dir: string, idx: ClipIndex): void {
  const file = join(dir, INDEX);
  writeFileSync(`${file}.tmp`, JSON.stringify(idx, null, 1));
  renameSync(`${file}.tmp`, file);
}

/** Video files in the folder (not in subfolders), with size and change time. */
export function scanFolder(dir: string): { file: string; size: number; mtime: number }[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && TYPE_BY_EXT[extname(d.name).toLowerCase()] && !d.name.startsWith("."))
    .map((d) => {
      const s = statSync(join(dir, d.name));
      return { file: d.name, size: s.size, mtime: s.mtimeMs };
    });
}

export function musicTracks(dir: string): string[] {
  const m = join(dir, MUSIC_DIR);
  if (!existsSync(m)) return [];
  return readdirSync(m).filter((f) => MUSIC_EXT.has(extname(f).toLowerCase())).sort();
}

/**
 * Clips to use: not used within `avoidDays` when possible, those whose description matches the
 * theme words first, then the least used, then the oldest use; ties are shuffled by `random`.
 */
export function chooseClips(entries: ClipEntry[], count: number, opts: { avoidDays?: number; theme?: string; now?: number; random?: () => number } = {}): ClipEntry[] {
  const { avoidDays = 7, theme = "", now = Date.now(), random = Math.random } = opts;
  const words = theme.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
  const score = (c: ClipEntry) => words.filter((w) => c.description.toLowerCase().includes(w) || c.file.toLowerCase().includes(w)).length;
  const fresh = (c: ClipEntry) => !c.last_used || now - Date.parse(c.last_used) > avoidDays * 86_400_000;
  const ranked = entries
    .map((c) => ({ c, fresh: fresh(c) ? 1 : 0, score: score(c), r: random() }))
    .sort((a, b) => b.fresh - a.fresh || b.score - a.score || a.c.uses - b.c.uses || (a.c.last_used ?? "").localeCompare(b.c.last_used ?? "") || a.r - b.r);
  return ranked.slice(0, count).map((x) => x.c);
}

/** Bring the index up to date with the folder: new clips are measured and (some) described. */
async function refresh(ctx: ToolContext, dir: string): Promise<ClipIndex> {
  const idx = readIndex(dir);
  const files = scanFolder(dir);
  const next: Record<string, ClipEntry> = {};
  let described = 0;
  for (const f of files) {
    const key = clipKey(f.file, f.size, f.mtime);
    // a renamed or moved file keeps what we knew (same size + time)
    const known = idx.clips[key] ?? Object.values(idx.clips).find((c) => c.size === f.size && Math.round(c.mtime) === Math.round(f.mtime));
    let entry: ClipEntry;
    if (known) entry = { ...known, file: f.file };
    else {
      try {
        const p = await probe(ctx, join(dir, f.file));
        entry = { file: f.file, size: f.size, mtime: f.mtime, seconds: p.duration, width: p.width, height: p.height, has_audio: p.has_audio, description: "", upload_id: null, uses: 0, last_used: null };
      } catch {
        continue; // not a readable video
      }
    }
    if (!entry.description && described < DESCRIBE_PER_CALL) {
      entry.description = await describeClip(ctx, join(dir, f.file), entry.seconds);
      described++;
    }
    next[key] = entry;
  }
  const out: ClipIndex = { version: 1, clips: next };
  writeIndex(dir, out);
  return out;
}

async function describeClip(ctx: ToolContext, path: string, seconds: number): Promise<string> {
  const ff = ffmpegBin();
  if (!ff) return "";
  const dir = join(mediaDir(ctx), "thumbs");
  mkdirSync(dir, { recursive: true });
  const shots: string[] = [];
  for (const [i, at] of [0.15, 0.5, 0.85].entries()) {
    const out = join(dir, `t${Date.now()}-${i}.jpg`);
    const r = await spawn([ff, "-hide_banner", "-nostdin", "-y", "-ss", String(Math.max(0, seconds * at)), "-i", path, "-frames:v", "1", "-vf", "scale=480:-2", out], dir, ctx.signal, undefined, 60_000);
    if (r.code === 0 && existsSync(out)) shots.push(out);
  }
  return shots.length ? (await ctx.describeImages(shots, DESCRIBE_PROMPT)).replace(/\s+/g, " ").trim() : "";
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const shape = (c: ClipEntry) => (c.height > c.width * 1.2 ? "vertical" : c.width > c.height * 1.2 ? "wide" : "square");
const view = (c: ClipEntry) => ({ name: c.file, seconds: r1(c.seconds), shape: shape(c), sound: c.has_audio, description: c.description || "(not described yet)", uses: c.uses, last_used: c.last_used?.slice(0, 10) ?? null });

/** Put clips on the job and remember they were used. Returns them with their video numbers. */
async function attach(ctx: ToolContext, dir: string, idx: ClipIndex, chosen: ClipEntry[]) {
  const out = [];
  for (const c of chosen) {
    const type = TYPE_BY_EXT[extname(c.file).toLowerCase()] ?? "video/mp4";
    const a = await ctx.clipAttach(join(dir, c.file), c.file, type, c.upload_id);
    const key = clipKey(c.file, c.size, c.mtime);
    const e = idx.clips[key];
    if (e) Object.assign(e, { upload_id: a.id, uses: e.uses + 1, last_used: new Date().toISOString() });
    out.push({ video: a.number, ...view(c) });
  }
  writeIndex(dir, idx);
  return out;
}

export const clipLibraryTool = defineTool({
  name: "clip_library",
  description:
    "The owner's own video clips (a folder on this PC). action 'list': every clip with its length, shape (vertical/wide), what it shows, and how often it was used, plus the music tracks. " +
    "action 'pick': choose `count` clips for a theme (unused lately, matching the theme words first) and put them on this job. action 'use': put the named clips on this job. " +
    "Picked clips become video numbers for video_probe / video_edit (see `video` in the result).",
  category: "read_docs",
  input: z.object({
    action: z.enum(["list", "pick", "use"]),
    count: z.number().int().min(1).max(5).default(2).describe("pick: how many clips"),
    theme: z.string().max(200).default("").describe("pick: words for the theme, e.g. 'pantai senja tenang'"),
    avoid_days: z.number().int().min(0).max(90).default(7).describe("pick: skip clips used within this many days when possible"),
    names: z.array(z.string().max(200)).max(5).default([]).describe("use: clip file names from 'list'"),
  }),
  risk: () => "safe",
  describe: (i) => (i.action === "list" ? "list the clip folder" : i.action === "pick" ? `pick ${i.count} clip(s)${i.theme ? ` for "${i.theme}"` : ""}` : `use ${i.names.join(", ")}`),
  async execute(i, ctx) {
    const dir = clipFolder(ctx);
    const idx = await refresh(ctx, dir);
    const entries = Object.values(idx.clips);
    if (i.action === "list") {
      const music = musicTracks(dir);
      return {
        ok: true,
        summary: `${entries.length} clips, ${music.length} music tracks`,
        output: { clips: entries.sort((a, b) => a.uses - b.uses).slice(0, 80).map(view), music, note: entries.length ? undefined : "The folder is empty: ask the owner to drop some videos in it." },
      };
    }
    if (!entries.length) throw new ToolDenied(`the clip folder ${dir} has no videos yet: ask the owner to add some`);
    const chosen =
      i.action === "pick"
        ? chooseClips(entries, i.count, { avoidDays: i.avoid_days, theme: i.theme })
        : i.names.map((n) => {
            const c = entries.find((e) => e.file === n);
            if (!c) throw new ToolDenied(`no clip named "${n}" (use action 'list')`);
            return c;
          });
    const clips = await attach(ctx, dir, idx, chosen);
    return { ok: true, summary: `${clips.length} clip(s) on the job: ${clips.map((c) => `video ${c.video} ${c.name}`).join(", ")}`, output: { clips, music: musicTracks(dir) } };
  },
});
