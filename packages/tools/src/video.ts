import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { VIDEO_PRESETS, VIDEO_TYPES, VideoPresetId, type VideoPreset } from "@agent-office/shared";
import { scrubbedEnv } from "./safety.ts";
import { ToolDenied, defineTool, type ToolContext } from "./types.ts";

/**
 * Editor's video tools (owner request): the owner sends clips in chat, Editor cuts and reframes
 * them with ffmpeg on the runner's own PC (GPU encoder when there is one) and exports them in a
 * platform preset, e.g. TikTok FHD 1080×1920. The result goes back to the hub as an upload and is
 * attached to a draft with save_draft(video: …); nothing is posted until the owner approves.
 * ffmpeg runs without a shell, with a scrubbed env, inside the run's workspace.
 */

export interface VideoProbe {
  duration: number;
  width: number;
  height: number;
  fps: number;
  has_audio: boolean;
  video_codec: string;
  size_bytes: number;
}

/** ffprobe -show_format -show_streams JSON → what Editor needs (display size: rotation applied). */
export function parseProbe(json: unknown): VideoProbe {
  const j = json as {
    format?: { duration?: string; size?: string };
    streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string; duration?: string; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[];
  };
  const v = j.streams?.find((s) => s.codec_type === "video");
  if (!v?.width || !v.height) throw new ToolDenied("this file has no video stream");
  const rate = (r?: string) => {
    const [a, b] = (r ?? "").split("/").map(Number);
    return a && b ? a / b : 0;
  };
  const rotation = Math.abs(Number(v.tags?.rotate ?? v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0)) % 180;
  const turned = rotation === 90;
  return {
    duration: round2(Number(j.format?.duration ?? v.duration ?? 0)),
    width: turned ? v.height : v.width,
    height: turned ? v.width : v.height,
    fps: round2(rate(v.avg_frame_rate) || rate(v.r_frame_rate)),
    has_audio: !!j.streams?.some((s) => s.codec_type === "audio"),
    video_codec: v.codec_name ?? "unknown",
    size_bytes: Number(j.format?.size ?? 0),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- edit plan → ffmpeg argv (pure)

export const Clip = z.object({
  video: z.number().int().min(1).max(10).describe("Which file the owner sent (1 = first), must be a video"),
  start: z.number().min(0).default(0).describe("Seconds into that video"),
  end: z.number().positive().optional().describe("Seconds into that video (default: its end)"),
  speed: z.number().min(0.5).max(2).default(1).describe("0.5 = slow motion, 2 = twice as fast"),
});

export const Caption = z.object({
  text: z.string().trim().min(1).max(200),
  start: z.number().min(0).describe("Seconds in the FINISHED video"),
  end: z.number().positive(),
  position: z.enum(["bottom", "middle", "top"]).default("bottom"),
});

export const EditPlan = z.object({
  clips: z.array(Clip).min(1).max(20).describe("Played one after another, in this order"),
  preset: VideoPresetId.default("tiktok_fhd"),
  fit: z.enum(["crop", "blur", "pad"]).default("crop").describe("crop = fill the frame (cuts the sides); blur = whole picture on a blurred copy; pad = whole picture on black"),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(50), z.literal(60)]).default(30),
  captions: z.array(Caption).max(40).default([]).describe("Text burned into the picture"),
  mute: z.boolean().default(false).describe("Drop the original sound"),
  normalize_audio: z.boolean().default(true).describe("Even loudness (about -14 LUFS, what TikTok/YouTube expect)"),
  name: z.string().trim().min(1).max(60).regex(/^[\w\- ]+$/).default("edit").describe("Output file name, no extension"),
});
export type EditPlan = z.infer<typeof EditPlan>;

export type Encoder = "nvenc" | "x264";

export interface ClipInput {
  file: string;
  probe: VideoProbe;
}

/** Seconds each clip lasts in the finished video. */
export function clipLengths(plan: EditPlan, inputs: ClipInput[]): number[] {
  return plan.clips.map((c, i) => {
    const p = inputs[i]!.probe;
    const end = Math.min(c.end ?? p.duration, p.duration);
    if (c.start >= end) throw new ToolDenied(`clip ${i + 1}: start ${c.start}s is not before its end (${round2(end)}s; video ${c.video} is ${p.duration}s long)`);
    return round2((end - c.start) / c.speed);
  });
}

/** The ffmpeg argv for an edit plan. `inputs[i]` is the file for `plan.clips[i]`. Runs with cwd = the media folder. */
export function buildEditArgs(plan: EditPlan, inputs: ClipInput[], encoder: Encoder, out: string, captionsFile: string | null): string[] {
  const preset: VideoPreset = VIDEO_PRESETS[plan.preset];
  const { width: W, height: H } = preset;
  const lengths = clipLengths(plan, inputs);
  const args = ["-hide_banner", "-nostdin", "-y"];
  plan.clips.forEach((c, i) => {
    args.push("-ss", String(c.start), "-t", String(round2(lengths[i]! * c.speed)), "-i", inputs[i]!.file);
  });
  const parts: string[] = [];
  const frame = (src: string, dst: string) => {
    if (plan.fit === "crop") return `${src}scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}${dst}`;
    if (plan.fit === "pad") return `${src}scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black${dst}`;
    const n = dst.slice(1, -1);
    return `${src}split[${n}a][${n}b];[${n}a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=24:2[${n}bg];[${n}b]scale=${W}:${H}:force_original_aspect_ratio=decrease[${n}fg];[${n}bg][${n}fg]overlay=(W-w)/2:(H-h)/2${dst}`;
  };
  plan.clips.forEach((c, i) => {
    parts.push(frame(`[${i}:v]setpts=(PTS-STARTPTS)/${c.speed},`, `[f${i}]`));
    parts.push(`[f${i}]setsar=1,fps=${plan.fps},format=yuv420p[v${i}]`);
    if (inputs[i]!.probe.has_audio && !plan.mute) {
      parts.push(`[${i}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo${c.speed !== 1 ? `,atempo=${c.speed}` : ""}[a${i}]`);
    } else {
      parts.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${lengths[i]}[a${i}]`);
    }
  });
  const n = plan.clips.length;
  parts.push(`${plan.clips.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${n}:v=1:a=1[vc][ac]`);
  parts.push(captionsFile ? `[vc]ass=${captionsFile}[vo]` : "[vc]null[vo]");
  parts.push(plan.normalize_audio && !plan.mute ? "[ac]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[ao]" : "[ac]anull[ao]");
  args.push("-filter_complex", parts.join(";"), "-map", "[vo]", "-map", "[ao]");
  const max = preset.max_mbps;
  const gop = String(plan.fps * 2);
  if (encoder === "nvenc") {
    args.push("-c:v", "h264_nvenc", "-preset", "p6", "-tune", "hq", "-rc", "vbr", "-cq", "21", "-b:v", "0", "-maxrate", `${max}M`, "-bufsize", `${max * 2}M`, "-profile:v", "high", "-spatial-aq", "1", "-g", gop, "-bf", "2");
  } else {
    args.push("-c:v", "libx264", "-preset", "medium", "-crf", "20", "-maxrate", `${max}M`, "-bufsize", `${max * 2}M`, "-profile:v", "high", "-level", "4.2", "-g", gop);
  }
  args.push("-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", `${preset.audio_kbps}k`, "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "-max_muxing_queue_size", "2048");
  args.push("-progress", "pipe:1", "-nostats", out);
  return args;
}

/** ASS subtitles for burned-in captions: big white bold text with a black outline, clear of TikTok's buttons. */
export function captionsAss(captions: EditPlan["captions"], preset: VideoPreset): string {
  const { width: W, height: H } = preset;
  const size = Math.round(Math.min(W, H) * 0.075);
  const margin = Math.round(W * 0.08);
  const marginV = Math.round(H * 0.16);
  const ts = (s: number) => {
    const cs = Math.round(s * 100);
    const h = Math.floor(cs / 360000);
    const m = Math.floor((cs % 360000) / 6000);
    const sec = Math.floor((cs % 6000) / 100);
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
  };
  const align = { bottom: 2, middle: 5, top: 8 } as const;
  // ASS override blocks start with "{"; captions are plain text
  const clean = (t: string) => t.replace(/[{}]/g, "").replace(/\\/g, "/").replace(/\r?\n/g, "\\N");
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,Arial,${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,${Math.max(3, Math.round(size / 14))},0,2,${margin},${margin},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...captions.map((c) => `Dialogue: 0,${ts(c.start)},${ts(Math.max(c.end, c.start + 0.3))},Default,,0,0,0,,{\\an${align[c.position]}}${clean(c.text)}`),
    "",
  ].join("\n");
}

// ---------------------------------------------------------------- running ffmpeg

interface Proc {
  code: number | null;
  stdout: string;
  stderr: string;
}

async function spawn(argv: string[], cwd: string, signal: AbortSignal, onStdout?: (chunk: string) => void, timeoutMs = 60 * 60_000): Promise<Proc> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(argv, { cwd, env: scrubbedEnv(), stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  } catch (err) {
    throw new ToolDenied(`could not start ${argv[0]}: ${(err as Error).message}. Install ffmpeg on the runner PC (ffmpeg.org) and restart the runner.`);
  }
  const kill = () => proc.kill();
  const timer = setTimeout(kill, timeoutMs);
  signal.addEventListener("abort", kill, { once: true });
  try {
    const readOut = async () => {
      let all = "";
      const dec = new TextDecoder();
      for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
        const s = dec.decode(chunk, { stream: true });
        onStdout?.(s);
        all = (all + s).slice(-20_000);
      }
      return all;
    };
    const [stdout, stderr, code] = await Promise.all([readOut(), new Response(proc.stderr as ReadableStream).text(), proc.exited]);
    return { code, stdout, stderr: stderr.slice(-4000) };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", kill);
  }
}

const ffmpegBin = () => Bun.which("ffmpeg");
const ffprobeBin = () => Bun.which("ffprobe");

let nvencOk: boolean | null = null;

/** The local video file for attachment `n` (1-based), downloaded once into the workspace. */
async function attachmentFile(ctx: ToolContext, n: number): Promise<{ file: string; name: string }> {
  const a = ctx.attachments[n - 1];
  if (!a) throw new ToolDenied(`there is no file ${n}; the owner sent ${ctx.attachments.length}`);
  const ext = VIDEO_TYPES[a.content_type];
  if (!ext) throw new ToolDenied(`file ${n} (${a.name}) is not a video`);
  const dir = mediaDir(ctx);
  const file = `in-${n}.${ext}`;
  if (!existsSync(join(dir, file))) await ctx.downloadAttachment(a.id, join(dir, file));
  return { file, name: a.name };
}

function mediaDir(ctx: ToolContext): string {
  const dir = join(ctx.workspace, "media");
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function probe(ctx: ToolContext, file: string): Promise<VideoProbe> {
  const bin = ffprobeBin();
  if (!bin) throw new ToolDenied("ffprobe is not installed on the runner PC (it comes with ffmpeg: ffmpeg.org). Tell the owner.");
  const r = await spawn([bin, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], mediaDir(ctx), ctx.signal, undefined, 60_000);
  if (r.code !== 0) throw new ToolDenied(`ffprobe could not read the video: ${r.stderr.slice(-300)}`);
  return parseProbe(JSON.parse(r.stdout));
}

/** Times (seconds) where the picture changes a lot: good places to cut. */
async function sceneChanges(ctx: ToolContext, file: string): Promise<number[]> {
  const bin = ffmpegBin()!;
  const r = await spawn([bin, "-hide_banner", "-nostdin", "-i", file, "-an", "-vf", "scale=320:-2,select='gt(scene,0.32)',showinfo", "-f", "null", "-"], mediaDir(ctx), ctx.signal, undefined, 10 * 60_000);
  const out: number[] = [];
  for (const m of r.stderr.matchAll(/pts_time:([\d.]+)/g)) if (out.length < 60) out.push(round2(Number(m[1])));
  return out;
}

export const videoProbeTool = defineTool({
  name: "video_probe",
  description:
    "Look at a video the owner sent: length, size, frame rate, sound, and the times where the scene changes (good cut points). " +
    "Do this for every clip before video_edit. You cannot see the picture itself: ask the owner which parts matter if it is not obvious.",
  category: "read_docs",
  input: z.object({ video: z.number().int().min(1).max(10).describe("Which file the owner sent (1 = first)"), scenes: z.boolean().default(true) }),
  risk: () => "safe",
  describe: (i) => `look at video ${i.video}`,
  async execute(i, ctx) {
    const { file, name } = await attachmentFile(ctx, i.video);
    const p = await probe(ctx, file);
    const scenes = i.scenes && p.duration <= 20 * 60 ? await sceneChanges(ctx, file) : [];
    return { ok: true, summary: `video ${i.video}: ${p.duration}s ${p.width}×${p.height}`, output: { video: i.video, name, ...p, size_mb: round2(p.size_bytes / 1024 ** 2), scene_changes: scenes } };
  },
});

export const videoEditTool = defineTool({
  name: "video_edit",
  description:
    "Cut, join, reframe and export the owner's videos with ffmpeg on this PC. Presets: tiktok_fhd (1080×1920, up to 10 min), reels, youtube_shorts (up to 3 min), youtube_1080p, square. " +
    "Clips play in order; captions are burned in (times are in the finished video). Use fit 'blur' when a wide video goes vertical and nothing may be cut off. " +
    "To only compress / convert one video, give one clip with no start/end. Returns a video id: attach it to a caption with save_draft(video: id).",
  category: "write",
  input: EditPlan,
  risk: () => "safe",
  describe: (i) => `render ${i.clips.length} clip(s) as ${i.preset}`,
  async execute(plan, ctx) {
    const bin = ffmpegBin();
    if (!bin) throw new ToolDenied("ffmpeg is not installed on the runner PC (ffmpeg.org). Tell the owner.");
    const preset = VIDEO_PRESETS[plan.preset];
    const inputs: ClipInput[] = [];
    const probes = new Map<number, ClipInput>();
    for (const c of plan.clips) {
      if (!probes.has(c.video)) {
        const { file } = await attachmentFile(ctx, c.video);
        probes.set(c.video, { file, probe: await probe(ctx, file) });
      }
      inputs.push(probes.get(c.video)!);
    }
    const total = round2(clipLengths(plan, inputs).reduce((a, b) => a + b, 0));
    if (total > preset.max_seconds) throw new ToolDenied(`the edit is ${total}s; ${plan.preset} takes at most ${preset.max_seconds}s. Cut it shorter.`);
    for (const c of plan.captions) if (c.start >= total) throw new ToolDenied(`caption "${c.text.slice(0, 30)}" starts at ${c.start}s but the video is only ${total}s`);
    const dir = mediaDir(ctx);
    const captionsFile = plan.captions.length ? `${plan.name.replace(/\s+/g, "_")}.ass` : null;
    if (captionsFile) writeFileSync(join(dir, captionsFile), captionsAss(plan.captions, preset));
    const out = `${plan.name.replace(/\s+/g, "_")}-${plan.preset}.mp4`;

    let last = 0;
    const onProgress = (chunk: string) => {
      const m = [...chunk.matchAll(/out_time_us=(\d+)/g)].pop();
      if (!m || !total) return;
      const pct = Math.min(99, Math.floor((Number(m[1]) / 1e6 / total) * 100));
      if (pct >= last + 20) {
        last = pct - (pct % 20);
        ctx.emit({ type: "agent.thinking", payload: { summary: `Rendering ${plan.preset}: ${last}%` } });
      }
    };
    const render = (enc: Encoder) => spawn([bin, ...buildEditArgs(plan, inputs, enc, out, captionsFile)], dir, ctx.signal, onProgress);
    if (nvencOk === null) nvencOk = (await spawn([bin, "-hide_banner", "-encoders"], dir, ctx.signal, undefined, 30_000)).stdout.includes("h264_nvenc");
    let encoder: Encoder = nvencOk ? "nvenc" : "x264";
    let r = await render(encoder);
    if (r.code !== 0 && encoder === "nvenc" && !ctx.signal.aborted) {
      // no NVIDIA GPU / driver after all: the CPU encoder always works
      nvencOk = false;
      encoder = "x264";
      r = await render(encoder);
    }
    if (r.code !== 0) throw new ToolDenied(`ffmpeg failed: ${r.stderr.slice(-600)}`);
    const size = statSync(join(dir, out)).size;
    const up = await ctx.uploadVideo(join(dir, out), out);
    ctx.renders.push({ id: up.id, name: out, content_type: "video/mp4" });
    return {
      ok: true,
      summary: `rendered ${out} (${total}s, ${round2(size / 1024 ** 2)} MB)`,
      output: { video_id: up.id, file: out, preset: preset.label, seconds: total, size_mb: round2(size / 1024 ** 2), encoder: encoder === "nvenc" ? "NVIDIA GPU (h264_nvenc)" : "CPU (libx264)" },
    };
  },
});

export const VIDEO_TOOLS = [videoProbeTool, videoEditTool];
