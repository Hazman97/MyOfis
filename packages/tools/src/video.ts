import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  EditPlan,
  EditSuggestionsInput,
  Transcript,
  VIDEO_PRESETS,
  VIDEO_TYPES,
  isFiller,
  packTranscript,
  subtitleCues,
  tightCuts,
  type VideoPreset,
} from "@agent-office/shared";
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
export function buildEditArgs(plan: EditPlan, inputs: ClipInput[], encoder: Encoder, out: string, captionsFile: string | null, musicFile: string | null = null): string[] {
  const preset: VideoPreset = VIDEO_PRESETS[plan.preset];
  const { width: W, height: H } = preset;
  const lengths = clipLengths(plan, inputs);
  const args = ["-hide_banner", "-nostdin", "-y"];
  plan.clips.forEach((c, i) => {
    args.push("-ss", String(c.start), "-t", String(round2(lengths[i]! * c.speed)), "-i", inputs[i]!.file);
  });
  // background music: looped to cover the whole video (it is the input after the clips)
  const music = musicFile && plan.music ? plan.music : null;
  if (music) args.push("-stream_loop", "-1", "-i", musicFile!);
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
  let sound = "[ac]";
  if (music) {
    const total = round2(lengths.reduce((a, b) => a + b, 0));
    parts.push(
      `[${n}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${total},volume=${music.volume_db}dB,afade=t=out:st=${Math.max(0, round2(total - 1.5))}:d=1.5[mus]`,
    );
    parts.push("[ac][mus]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[am]");
    sound = "[am]";
  }
  parts.push(plan.normalize_audio && (!plan.mute || music) ? `${sound}loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[ao]` : `${sound}anull[ao]`);
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
export function captionsAss(captions: EditPlan["captions"], preset: VideoPreset, popCount = 0): string {
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
    // "pop" subtitles (2 words at a time): larger, yellow, thick outline
    `Style: Pop,Arial,${Math.round(size * 1.25)},&H0000E5FF,&H0000E5FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,${Math.max(4, Math.round(size / 10))},0,2,${margin},${margin},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    // the last `popCount` entries are pop subtitles
    ...captions.map((c, i) => `Dialogue: 0,${ts(c.start)},${ts(Math.max(c.end, c.start + 0.3))},${i >= captions.length - popCount ? "Pop" : "Default"},,0,0,0,,{\\an${align[c.position]}}${clean(c.text)}`),
    "",
  ].join("\n");
}

// ---------------------------------------------------------------- running ffmpeg

interface Proc {
  code: number | null;
  stdout: string;
  /** The end of stderr, for error messages. */
  stderr: string;
  /** All of stderr (ffmpeg's filter logs: scene changes, silences). */
  log: string;
}

export async function spawn(argv: string[], cwd: string, signal: AbortSignal, onStdout?: (chunk: string) => void, timeoutMs = 60 * 60_000): Promise<Proc> {
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
    return { code, stdout, stderr: stderr.slice(-4000), log: stderr.slice(0, 8_000_000) };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", kill);
  }
}

export const ffmpegBin = () => Bun.which("ffmpeg");
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

export function mediaDir(ctx: ToolContext): string {
  const dir = join(ctx.workspace, "media");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function probe(ctx: ToolContext, file: string): Promise<VideoProbe> {
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
  for (const m of r.log.matchAll(/pts_time:([\d.]+)/g)) if (out.length < 60) out.push(round2(Number(m[1])));
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
    // subtitles from the speech: every clip's file needs its transcript (video_transcribe)
    const cues: EditPlan["captions"] = [];
    if (plan.subtitles) {
      const transcripts: Record<number, Transcript> = {};
      const durations: Record<number, number> = {};
      for (const [n, input] of probes) {
        const t = await savedTranscript(ctx, n);
        if (!t) throw new ToolDenied(`video ${n} has no transcript yet: run video_transcribe(video: ${n}) first, or turn subtitles off`);
        transcripts[n] = t;
        durations[n] = input.probe.duration;
      }
      for (const c of subtitleCues(plan, transcripts, durations)) cues.push({ text: c.text, start: c.start, end: c.end, position: plan.subtitles.position });
    }
    const allCaptions = [...plan.captions, ...cues];
    const captionsFile = allCaptions.length ? `${plan.name.replace(/\s+/g, "_")}.ass` : null;
    if (captionsFile) writeFileSync(join(dir, captionsFile), captionsAss(allCaptions, preset, plan.subtitles?.style === "pop" ? cues.length : 0));
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
    let musicFile: string | null = null;
    if (plan.music) {
      const folder = ctx.config.clip_folder?.trim();
      musicFile = folder ? join(folder, "music", plan.music.track) : null;
      if (!musicFile || !existsSync(musicFile)) throw new ToolDenied(`no music track "${plan.music.track}": use a name from clip_library's music list, or music: null`);
    }
    const render = (enc: Encoder) => spawn([bin, ...buildEditArgs(plan, inputs, enc, out, captionsFile, musicFile)], dir, ctx.signal, onProgress);
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
    const up = await ctx.uploadVideo(join(dir, out), out, { plan, attachments: ctx.attachments });
    ctx.renders.push({ id: up.id, name: out, content_type: "video/mp4" });
    return {
      ok: true,
      summary: `rendered ${out} (${total}s, ${round2(size / 1024 ** 2)} MB)`,
      output: { video_id: up.id, file: out, preset: preset.label, seconds: total, size_mb: round2(size / 1024 ** 2), encoder: encoder === "nvenc" ? "NVIDIA GPU (h264_nvenc)" : "CPU (libx264)" },
    };
  },
});

// ---------------------------------------------------------------- speech (whisper.cpp) and suggestions

/** whisper.cpp's CLI: WHISPER_CPP, else on PATH, else the usual Windows folder C:\whisper. */
export function whisperBinary(): string | null {
  const env = process.env.WHISPER_CPP;
  if (env && existsSync(env)) return env;
  const onPath = Bun.which("whisper-cli");
  if (onPath) return onPath;
  for (const f of ["C:\\whisper\\bin\\Release\\whisper-cli.exe", "C:\\whisper\\bin\\whisper-cli.exe"]) if (existsSync(f)) return f;
  return null;
}

/** The ggml model: WHISPER_MODEL, else the largest .bin in C:\whisper\models (or ~/.whisper/models). */
export function whisperModel(): string | null {
  const env = process.env.WHISPER_MODEL;
  if (env && existsSync(env)) return env;
  for (const dir of ["C:\\whisper\\models", join(process.env.HOME ?? process.env.USERPROFILE ?? ".", ".whisper", "models")]) {
    if (!existsSync(dir)) continue;
    const bins = readdirSync(dir).filter((f) => f.startsWith("ggml-") && f.endsWith(".bin")).map((f) => join(dir, f));
    if (bins.length) return bins.sort((a, b) => statSync(b).size - statSync(a).size)[0]!;
  }
  return null;
}

/** whisper-cli -ojf -ml 1 -sow output → words with times (seconds). */
export function parseWhisperJson(json: unknown, duration: number, model: string): Transcript {
  const j = json as { result?: { language?: string }; transcription?: { offsets?: { from?: number; to?: number }; text?: string }[] };
  const words: Transcript["words"] = [];
  for (const seg of j.transcription ?? []) {
    const raw = seg.text ?? "";
    const w = raw.trim();
    if (!w || /^\[.*\]$/.test(w)) continue; // [BLANK_AUDIO], [Music]
    const s = round2((seg.offsets?.from ?? 0) / 1000);
    const e = round2((seg.offsets?.to ?? 0) / 1000);
    const prev = words.at(-1);
    // a piece without a leading space continues the previous word ("Smash" + "Point" stay apart; "tourna" + "ment" join)
    if (prev && !/^\s/.test(raw) && !/^[,.?!]/.test(w)) {
      prev.w += w;
      prev.e = e;
    } else if (prev && /^[,.?!]+$/.test(w)) prev.w += w;
    else words.push({ w, s, e: Math.max(e, s) });
  }
  return { language: j.result?.language ?? "auto", duration, model, words };
}

/** ffmpeg silencedetect's log → quiet stretches (seconds). An open silence at the end runs to `duration`. */
export function parseSilences(log: string, duration: number): { s: number; e: number }[] {
  const out: { s: number; e: number }[] = [];
  let start: number | null = null;
  for (const m of log.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    const v = Math.max(0, Number(m[2]));
    if (m[1] === "start") start = v;
    else if (start !== null) {
      out.push({ s: round2(start), e: round2(v) });
      start = null;
    }
  }
  if (start !== null && duration > start) out.push({ s: round2(start), e: round2(duration) });
  return out.slice(0, 20_000);
}

async function savedTranscript(ctx: ToolContext, n: number): Promise<Transcript | null> {
  const a = ctx.attachments[n - 1];
  if (!a) return null;
  const r = (await ctx.videoData("transcript_get", { upload_id: a.id })) as { transcript: Transcript | null };
  return r.transcript ? Transcript.parse(r.transcript) : null;
}

export const videoTranscribeTool = defineTool({
  name: "video_transcribe",
  description:
    "Turn the speech in a video the owner sent into text with times (whisper on this PC, free). " +
    "Use it on every video with talking before you suggest edits: it shows what is said and when, the pauses and the 'um's, " +
    "and the seconds a tight cut would save. Needed before video_edit can burn in subtitles.",
  category: "read_docs",
  input: z.object({
    video: z.number().int().min(1).max(10).describe("Which file the owner sent (1 = first)"),
    language: z.enum(["auto", "ms", "en", "zh", "ta"]).default("auto").describe("auto, or force Malay (ms), English, Chinese, Tamil"),
  }),
  risk: () => "safe",
  describe: (i) => `transcribe video ${i.video}`,
  async execute(i, ctx) {
    const { file, name } = await attachmentFile(ctx, i.video);
    let t = await savedTranscript(ctx, i.video);
    if (!t) {
      const ffmpeg = ffmpegBin();
      if (!ffmpeg) throw new ToolDenied("ffmpeg is not installed on the runner PC (ffmpeg.org). Tell the owner.");
      const bin = whisperBinary();
      const model = whisperModel();
      if (!bin || !model) throw new ToolDenied("whisper.cpp is not set up on the runner PC (see docs/video-editor.md: Transcripts). Tell the owner; you can still edit by times.");
      const p = await probe(ctx, file);
      if (!p.has_audio) throw new ToolDenied(`video ${i.video} has no sound to transcribe`);
      const dir = mediaDir(ctx);
      const wav = `in-${i.video}.wav`;
      const x = await spawn([ffmpeg, "-hide_banner", "-nostdin", "-y", "-i", file, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], dir, ctx.signal, undefined, 30 * 60_000);
      if (x.code !== 0) throw new ToolDenied(`ffmpeg could not read the sound: ${x.stderr.slice(-300)}`);
      ctx.emit({ type: "agent.thinking", payload: { summary: `Transcribing video ${i.video} (${Math.round(p.duration)} s) with whisper` } });
      const out = `in-${i.video}`;
      const r = await spawn([bin, "-m", model, "-f", wav, "-l", i.language, "-ojf", "-of", out, "-ml", "1", "-sow", "-np"], dir, ctx.signal, undefined, 60 * 60_000);
      if (r.code !== 0 || !existsSync(join(dir, `${out}.json`))) throw new ToolDenied(`whisper failed: ${r.stderr.slice(-400)}`);
      t = parseWhisperJson(JSON.parse(readFileSync(join(dir, `${out}.json`), "utf8")), p.duration, model.split(/[\\/]/).pop() ?? "whisper");
      // whisper's word times touch each other: measure the pauses on the sound itself
      const quiet = await spawn([ffmpeg, "-hide_banner", "-nostdin", "-i", wav, "-af", "silencedetect=noise=-35dB:d=0.3", "-f", "null", "-"], dir, ctx.signal, undefined, 30 * 60_000);
      if (quiet.code === 0) t.silences = parseSilences(quiet.log, p.duration);
      await ctx.videoData("transcript_put", { upload_id: ctx.attachments[i.video - 1]!.id, transcript: t });
    }
    const fillers = t.words.filter((w) => isFiller(w.w)).length;
    const tight = tightCuts(t, i.video);
    const kept = round2(tight.reduce((a, c) => a + ((c.end ?? t!.duration) - c.start), 0));
    return {
      ok: true,
      summary: `video ${i.video}: ${t.words.length} words (${t.language}), ${fillers} fillers`,
      output: {
        video: i.video,
        name,
        language: t.language,
        words: t.words.length,
        fillers,
        tight_cut: { clips: tight.length, seconds: kept, saves_seconds: round2(t.duration - kept), plan_clips: tight.length <= 30 ? tight : "too many to list; use the Video Studio's Tight cut" },
        transcript: packTranscript(t, i.video),
      },
    };
  },
});

export const suggestEditsTool = defineTool({
  name: "suggest_edits",
  description:
    "Show the owner 2–4 ready edit options as cards in the chat and the Video Studio (each with a full video_edit plan). " +
    "Use it after video_probe / video_transcribe when the owner has not said exactly what to make. The owner picks one (or opens it in the studio); " +
    "then render that plan with video_edit. Keys A, B, C, D. Make the options really different (e.g. tight cut with subtitles / 30 s hook highlight / just compress).",
  category: "write",
  input: EditSuggestionsInput,
  risk: () => "safe",
  describe: (i) => `suggest ${i.options.length} edits`,
  async execute(i, ctx) {
    const keys = new Set<string>();
    for (const o of i.options) {
      if (keys.has(o.key)) throw new ToolDenied(`option ${o.key} appears twice`);
      keys.add(o.key);
      for (const c of o.plan.clips) {
        const a = ctx.attachments[c.video - 1];
        if (!a || !VIDEO_TYPES[a.content_type]) throw new ToolDenied(`option ${o.key}: file ${c.video} is not one of the videos the owner sent`);
        if (c.end !== undefined && c.end <= c.start) throw new ToolDenied(`option ${o.key}: a clip ends before it starts`);
      }
      if (o.plan.subtitles) for (const c of o.plan.clips) if (!(await savedTranscript(ctx, c.video))) throw new ToolDenied(`option ${o.key} has subtitles: run video_transcribe(video: ${c.video}) first`);
    }
    await ctx.videoData("suggestions", { suggestions: i });
    return { ok: true, summary: `${i.options.length} edit options shown to the owner`, output: { shown: i.options.map((o) => `${o.key}: ${o.title}`), next: "Wait for the owner to pick one, then video_edit that plan." } };
  },
});

export const VIDEO_TOOLS = [videoProbeTool, videoTranscribeTool, videoEditTool, suggestEditsTool];
