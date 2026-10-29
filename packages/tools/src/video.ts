import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  EditPlan,
  finishedSeconds,
  ShotInfo,
  transitionsForCuts,
  transitionSeconds,
  VideoShotIndex,
  type TransitionSpec,
  EditSuggestionsInput,
  Transcript,
  VIDEO_PRESETS,
  MEDIA_TYPES,
  VIDEO_TYPES,
  isFiller,
  packTranscript,
  subtitleCues,
  tightCuts,
  TikTokHdMode,
  tiktokHdPlan,
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
  /** Extra facts for the TikTok HD check (optional: older callers and tests build probes by hand). */
  pix_fmt?: string;
  audio_codec?: string | null;
  /** Variable frame rate (phones): avg and nominal rates differ. */
  vfr?: boolean;
  /** Rotation metadata (90/180/270) instead of upright pixels. */
  rotation?: number;
  /** Whole-file bitrate, Mbit/s. */
  mbps?: number;
  /** ffprobe's container name, e.g. "mov,mp4,m4a,3gp,3g2,mj2". */
  format?: string;
}

/** ffprobe -show_format -show_streams JSON → what Editor needs (display size: rotation applied). */
export function parseProbe(json: unknown): VideoProbe {
  const j = json as {
    format?: { duration?: string; size?: string; bit_rate?: string; format_name?: string };
    streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string; duration?: string; pix_fmt?: string; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[];
  };
  const v = j.streams?.find((s) => s.codec_type === "video");
  if (!v?.width || !v.height) throw new ToolDenied("this file has no video stream");
  const rate = (r?: string) => {
    const [a, b] = (r ?? "").split("/").map(Number);
    return a && b ? a / b : 0;
  };
  const rotationRaw = ((Number(v.tags?.rotate ?? v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0) % 360) + 360) % 360;
  const turned = rotationRaw % 180 === 90;
  const avg = rate(v.avg_frame_rate);
  const nominal = rate(v.r_frame_rate);
  const audio = j.streams?.find((s) => s.codec_type === "audio");
  return {
    duration: round2(Number(j.format?.duration ?? v.duration ?? 0)),
    width: turned ? v.height : v.width,
    height: turned ? v.width : v.height,
    fps: round2(rate(v.avg_frame_rate) || rate(v.r_frame_rate)),
    has_audio: !!j.streams?.some((s) => s.codec_type === "audio"),
    video_codec: v.codec_name ?? "unknown",
    size_bytes: Number(j.format?.size ?? 0),
    pix_fmt: v.pix_fmt ?? "unknown",
    audio_codec: audio?.codec_name ?? null,
    vfr: !!avg && !!nominal && Math.abs(avg - nominal) > 0.5,
    rotation: rotationRaw,
    mbps: round2(Number(j.format?.bit_rate ?? 0) / 1e6),
    format: j.format?.format_name ?? "",
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- edit plan → ffmpeg argv (pure)

export type Encoder = "nvenc" | "x264";

export interface ClipInput {
  file: string;
  probe: VideoProbe;
  /** Detected letterbox crop (w:h:x:y) from cropdetect, applied before reframing unless Clip.crop overrides it. */
  crop?: string | null;
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
export function buildEditArgs(plan: EditPlan, inputs: ClipInput[], encoder: Encoder, out: string, captionsFile: string | null, musicFile: string | null = null, overlayInputs: ClipInput[] = []): string[] {
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
  const overlays = plan.overlays ?? [];
  overlays.forEach((ov, j) => {
    const ovIn = overlayInputs[j] ?? inputs[ov.video - 1] ?? inputs[0]!;
    args.push("-i", ovIn.file);
  });
  const parts: string[] = [];
  const frame = (src: string, dst: string, fitMode: "crop" | "blur" | "pad", preCrop?: string | null) => {
    const s = preCrop ? `${src}crop=${preCrop},` : src;
    if (fitMode === "crop") return `${s}scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}${dst}`;
    if (fitMode === "pad") return `${s}scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black${dst}`;
    const n = dst.slice(1, -1);
    return `${s}split[${n}a][${n}b];[${n}a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=24:2[${n}bg];[${n}b]scale=${W}:${H}:force_original_aspect_ratio=decrease[${n}fg];[${n}bg][${n}fg]overlay=(W-w)/2:(H-h)/2${dst}`;
  };
  plan.clips.forEach((c, i) => {
    const fitMode = c.fit ?? plan.fit;
    const preCrop = c.crop ?? inputs[i]?.crop ?? null;
    parts.push(frame(`[${i}:v]setpts=(PTS-STARTPTS)/${c.speed},`, `[f${i}]`, fitMode, preCrop));
    if (c.zoom === "none") parts.push(`[f${i}]setsar=1,fps=${plan.fps},format=yuv420p[v${i}]`);
    else {
      // Ken Burns: grow (or shrink) the picture by 12 % over the clip, centred, frame by frame
      const L = Math.max(0.1, lengths[i]!);
      const grow = c.zoom === "in" ? `t/${L}` : `(1-t/${L})`;
      parts.push(`[f${i}]fps=${plan.fps},scale=w='trunc(${W}*(1+${ZOOM}*${grow})/2)*2':h=-2:eval=frame,crop=${W}:${H},setsar=1,format=yuv420p[v${i}]`);
    }
    if (inputs[i]!.probe.has_audio && !plan.mute) {
      parts.push(`[${i}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo${c.speed !== 1 ? `,atempo=${c.speed}` : ""}[a${i}]`);
    } else {
      parts.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${lengths[i]}[a${i}]`);
    }
  });
  const n = plan.clips.length;
  const cuts = transitionsForCuts(plan, lengths);
  const anyTransition = cuts.some((c) => c.seconds > 0 && c.type !== "none");
  if (anyTransition) {
    // transitions: each cut overlaps the clips by its cut duration (video xfade, sound crossfade)
    let v = "[v0]";
    let a = "[a0]";
    let at = 0;
    for (let i = 1; i < n; i++) {
      const cut = cuts[i - 1]!;
      const T = round2(cut.seconds);
      at = round2(at + lengths[i - 1]! - T);
      const last = i === n - 1;
      const vOut = last ? "[vc]" : `[x${i}]`;
      const aOut = last ? "[ac]" : `[y${i}]`;
      if (T > 0 && cut.type !== "none") {
        parts.push(`${v}[v${i}]xfade=transition=${XFADE[cut.type]}:duration=${T}:offset=${at}${vOut}`);
        parts.push(`${a}[a${i}]acrossfade=d=${T}:c1=tri:c2=tri${aOut}`);
      } else {
        parts.push(`${v}[v${i}]concat=n=2:v=1:a=0${vOut}`);
        parts.push(`${a}[a${i}]concat=n=2:v=0:a=1${aOut}`);
      }
      v = vOut;
      a = aOut;
    }
  } else parts.push(`${plan.clips.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${n}:v=1:a=1[vc][ac]`);
  let curV = "[vc]";
  const baseOverlayInputIdx = n + (music ? 1 : 0);
  overlays.forEach((ov, j) => {
    const ovIn = overlayInputs[j] ?? inputs[ov.video - 1] ?? inputs[0]!;
    const inIdx = baseOverlayInputIdx + j;
    const ovDur = ov.end !== undefined ? Math.max(0.1, round2(ov.end - ov.start)) : ovIn.probe.duration;
    const ovEnd = round2(ov.start + ovDur);
    const ck = ov.chromakey ? `,colorkey=0x${ov.chromakey.slice(1)}:0.25:0.15` : "";
    const alpha = ov.opacity < 1 ? `,format=rgba,colorchannelmixer=aa=${ov.opacity}` : "";
    parts.push(`[${inIdx}:v]trim=0:${ovDur},setpts=PTS-STARTPTS+${ov.start}/TB,scale=${W}:${H}:force_original_aspect_ratio=decrease${ck}${alpha}[ov${j}]`);
    const nextV = `[vov${j}]`;
    parts.push(`${curV}[ov${j}]overlay=x=${ov.x}:y=${ov.y}:enable='between(t,${ov.start},${ovEnd})':eof_action=pass${nextV}`);
    curV = nextV;
  });
  parts.push(captionsFile ? `${curV}ass=${captionsFile}[vo]` : `${curV}null[vo]`);
  let sound = "[ac]";
  if (music) {
    const total = finishedSeconds(plan, lengths);
    parts.push(
      `[${n}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${total},volume=${music.volume_db}dB,afade=t=out:st=${Math.max(0, round2(total - 1.5))}:d=1.5[mus]`,
    );
    parts.push("[ac][mus]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[am]");
    sound = "[am]";
  }
  // loudnorm on pure silence gives NaN and the AAC encoder fails: only when some real sound is there
  const realSound = !!music || (!plan.mute && plan.clips.some((_, i) => inputs[i]!.probe.has_audio));
  parts.push(plan.normalize_audio && realSound ? `${sound}loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[ao]` : `${sound}anull[ao]`);
  args.push("-filter_complex", parts.join(";"), "-map", "[vo]", "-map", "[ao]");
  const max = preset.max_mbps;
  const gop = String(plan.fps * 2);
  const targetMbps = Math.round(max * 0.75);
  if (encoder === "nvenc") {
    args.push("-c:v", "h264_nvenc", "-preset", "p6", "-tune", "hq", "-rc", "vbr", "-cq", "21", "-b:v", `${targetMbps}M`, "-maxrate", `${max}M`, "-bufsize", `${max * 2}M`, "-profile:v", "high", "-spatial-aq", "1", "-g", gop, "-bf", "2");
  } else {
    args.push("-c:v", "libx264", "-preset", "medium", "-crf", "20", "-maxrate", `${max}M`, "-bufsize", `${max * 2}M`, "-profile:v", "high", "-level", "4.2", "-g", gop);
  }
  args.push("-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", `${preset.audio_kbps}k`, "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "-max_muxing_queue_size", "2048");
  args.push("-progress", "pipe:1", "-nostats", out);
  return args;
}

/** How far a Ken Burns zoom goes (12 %). */
const ZOOM = 0.12;
/** Our transition names → ffmpeg xfade transitions. */
const XFADE: Record<TransitionSpec["type"], string> = { none: "fade", fade: "fade", dissolve: "dissolve", slide: "slideleft", zoom: "zoomin" };
/** ASS tags for caption animations (inside the line's {…} block). */
const ANIMATION: Record<EditPlan["captions"][number]["animation"], string> = {
  none: "",
  fade: "\\fad(250,250)",
  pop: "\\fad(80,250)\\fscx70\\fscy70\\t(0,160,\\fscx100\\fscy100)",
};

/** Monochrome vector emoji font for libass (avoids COLRv0/COLRv1 broken hollow rings and missing-glyph tofu). */
export function emojiFontName(platformName: string = process.platform): string {
  return platformName === "win32" ? "Segoe UI Symbol" : "Noto Emoji";
}

const EMOJI_RUN_RE = /[\p{Extended_Pictographic}\u2600-\u27BF]+(?:\uFE0F|\u200D[\p{Extended_Pictographic}\u2600-\u27BF]+)*/gu;

/** Wrap emoji codepoints in an explicit monochrome outline font override for libass. Pure. */
export function wrapAssEmoji(cleanedText: string, emojiFont = emojiFontName()): string {
  return cleanedText.replace(EMOJI_RUN_RE, (m) => `{\\fn${emojiFont}\\b0}${m}{\\fnArial\\b1}`);
}

/** ASS subtitles for burned-in captions: big white bold text with a black outline, clear of TikTok's buttons. */
type AssCaption = Omit<EditPlan["captions"][number], "animation"> & { animation?: EditPlan["captions"][number]["animation"] };
export function captionsAss(captions: AssCaption[], preset: VideoPreset, popCount = 0): string {
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
  // ASS override blocks start with "{"; captions are plain text; emoji runs switch to monochrome outline font
  const clean = (t: string) => wrapAssEmoji(t.replace(/[{}]/g, "").replace(/\\/g, "/").replace(/\r?\n/g, "\\N"));
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
    ...captions.map((c, i) => `Dialogue: 0,${ts(c.start)},${ts(Math.max(c.end, c.start + 0.3))},${i >= captions.length - popCount ? "Pop" : "Default"},,0,0,0,,{\\an${align[c.position]}${ANIMATION[c.animation ?? "none"]}}${clean(c.text)}`),
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
export async function attachmentFile(ctx: ToolContext, n: number): Promise<{ file: string; name: string }> {
  const a = ctx.attachments[n - 1];
  if (!a) throw new ToolDenied(`there is no file ${n}; the owner sent ${ctx.attachments.length}`);
  const ext = MEDIA_TYPES[a.content_type];
  if (!ext) throw new ToolDenied(`file ${n} (${a.name}) is not a video or a sound recording`);
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

// ---------------------------------------------------------------- Task 026: shot index (vision + signalstats + cropdetect) & render review

/** Build non-overlapping [start, end] shots from scene cut times and total duration. Pure. */
export function shotsFromScenes(sceneTimes: number[], duration: number, maxShots = 24): { start: number; end: number }[] {
  if (duration <= 0) return [];
  const cuts = [0, ...sceneTimes.filter((t) => t >= 0.4 && t <= duration - 0.4).sort((a, b) => a - b), round2(duration)];
  const raw: { start: number; end: number }[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const s = round2(cuts[i]!);
    const e = round2(cuts[i + 1]!);
    if (e - s < 0.4 && raw.length > 0) {
      raw[raw.length - 1]!.end = e;
    } else if (e > s) {
      // Split very long unbroken shots (> 15s) into ~10s segments so long videos still get sampled
      if (e - s > 15) {
        const parts = Math.min(6, Math.ceil((e - s) / 10));
        const step = (e - s) / parts;
        for (let k = 0; k < parts; k++) {
          raw.push({ start: round2(s + k * step), end: round2(k === parts - 1 ? e : s + (k + 1) * step) });
        }
      } else {
        raw.push({ start: s, end: e });
      }
    }
  }
  if (!raw.length) return [{ start: 0, end: round2(duration) }];
  return raw.slice(0, maxShots);
}

/** Parse ffmpeg `cropdetect` filter log and determine whether the source has letterbox/pillarbox bars. Pure. */
export function parseCropdetect(log: string, width: number, height: number): { crop: string | null; letterboxed: boolean } {
  const counts = new Map<string, number>();
  for (const m of log.matchAll(/crop=(\d+:\d+:\d+:\d+)/g)) {
    const val = m[1]!;
    counts.set(val, (counts.get(val) ?? 0) + 1);
  }
  if (!counts.size) return { crop: null, letterboxed: false };
  const modal = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const [cw, ch, cx, cy] = modal.split(":").map(Number);
  if (!cw || !ch || cw < width * 0.45 || ch < height * 0.35 || cw > width || ch > height) {
    return { crop: null, letterboxed: false };
  }
  // Consider letterboxed/pillarboxed when at least 6% of height or width is black bars
  const letterboxed = ch <= Math.round(height * 0.94) || cw <= Math.round(width * 0.94);
  if (!letterboxed || (cw === width && ch === height && cx === 0 && cy === 0)) {
    return { crop: null, letterboxed: false };
  }
  return { crop: modal, letterboxed: true };
}

/** Parse ffmpeg `signalstats` / `blurdetect` metadata log for mean luma (`YAVG`) and blur/detail. Pure. */
export function parseSignalstats(log: string): { lumaMean: number; dark: boolean; blurry: boolean } {
  const yavgs: number[] = [];
  for (const m of log.matchAll(/(?:lavfi\.signalstats\.YAVG|YAVG)[:=]\s*([\d.]+)/g)) {
    const v = Number(m[1]);
    if (Number.isFinite(v)) yavgs.push(v);
  }
  const blurs: number[] = [];
  for (const m of log.matchAll(/(?:lavfi\.blur|blur)[:=]\s*([\d.]+)/g)) {
    const v = Number(m[1]);
    if (Number.isFinite(v)) blurs.push(v);
  }
  const lumaMean = yavgs.length ? round2(yavgs.reduce((a, b) => a + b, 0) / yavgs.length) : 128;
  const blurMean = blurs.length ? blurs.reduce((a, b) => a + b, 0) / blurs.length : 0;
  return {
    lumaMean,
    dark: lumaMean < 42,
    blurry: blurMean > 6.5,
  };
}

/**
 * Parse one vision description line returned by `describeImages` (either tagged `desc | text:yes | faces:no`
 * or natural language mentioning titles/text/faces/blur). Pure.
 */
export function parseVisionShotLine(raw: string): {
  description: string;
  text_on_screen: boolean;
  faces: boolean;
  dark: boolean;
  blurry: boolean;
} {
  const cleaned = raw.replace(/^(?:shot|frame|image|line)\s*\d+\s*[:.\-)\]]\s*/i, "").trim();
  const parts = cleaned.split("|").map((p) => p.trim());
  const desc = (parts[0] ?? "").slice(0, 300);
  const tagText = parts.slice(1).join(" ").toLowerCase();
  const fullLower = cleaned.toLowerCase();

  const tagBool = (key: string): boolean | undefined => {
    const m = new RegExp(`\\b${key}\\s*[:=]\\s*(yes|true|1|ya|no|false|0|tidak)\\b`, "i").exec(tagText || fullLower);
    if (!m) return undefined;
    return /^(yes|true|1|ya)$/i.test(m[1]!);
  };

  const textTag = tagBool("text") ?? tagBool("text_on_screen");
  const facesTag = tagBool("faces") ?? tagBool("face");
  const darkTag = tagBool("dark");
  const blurryTag = tagBool("blurry") ?? tagBool("blur");

  const textInferred = /\b(title|text|caption|subtitle|words|logo|sign|banner|tulisan|teks|tajuk)\b/i.test(desc) && !/\bno text\b|\btanpa teks\b/i.test(desc);
  const facesInferred = /\b(face|faces|person|man|woman|girl|boy|speaker|closeup|close-up|portrait|muka|wajah|orang|lelaki|wanita)\b/i.test(desc) && !/\bno face\b|\bno person\b/i.test(desc);
  const darkInferred = /\b(very dark|pitch black|too dark|almost black|gelap sangat)\b/i.test(desc);
  const blurryInferred = /\b(blurry|out of focus|motion blur|kabur)\b/i.test(desc);

  return {
    description: desc,
    text_on_screen: textTag ?? textInferred,
    faces: facesTag ?? facesInferred,
    dark: darkTag ?? darkInferred,
    blurry: blurryTag ?? blurryInferred,
  };
}

/**
 * Text-safe & face-safe reframing rule (Task 026 #3): when a wide shot going vertical has burned-in
 * `text_on_screen` or `faces` that a 9:16 center-crop would cut, use `fit: "blur"` for that clip. Pure.
 */
export function chooseClipFit(
  shot: { text_on_screen?: boolean; faces?: boolean },
  requestedFit: "crop" | "blur" | "pad" = "crop",
  isVerticalOutput = true,
  isWideSource = true,
): "crop" | "blur" | "pad" {
  if (requestedFit !== "crop" || !isVerticalOutput || !isWideSource) return requestedFit;
  if (shot.text_on_screen || shot.faces) return "blur";
  return "crop";
}

/** Parse ffmpeg `blackdetect` log into black stretches. Pure. */
export function parseBlackdetect(log: string): { start: number; end: number; duration: number }[] {
  const out: { start: number; end: number; duration: number }[] = [];
  for (const m of log.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g)) {
    out.push({ start: round2(Number(m[1])), end: round2(Number(m[2])), duration: round2(Number(m[3])) });
  }
  return out;
}

/** Parse ffmpeg `ebur128` integrated loudness (LUFS). Pure. */
export function parseLoudness(log: string): { integratedLufs: number | null } {
  const all = [...log.matchAll(/I:\s*(-?[\d.]+)\s*LUFS/g)];
  if (!all.length) return { integratedLufs: null };
  const val = Number(all.at(-1)![1]);
  return { integratedLufs: Number.isFinite(val) ? round2(val) : null };
}

/** Combine technical measurements and vision review into a 0..1 quality score and problem list. Pure. */
export function evaluateReview(opts: {
  duration: number;
  targetMin?: number;
  targetMax?: number;
  blackSegments: { start: number; end: number; duration: number }[];
  lumaMean: number;
  letterboxed: boolean;
  hasAudio?: boolean;
  integratedLufs?: number | null;
  visionText?: string;
  expectHook?: boolean;
}): { score: number; passed: boolean; problems: string[] } {
  let score = 1.0;
  const problems: string[] = [];

  if (opts.targetMin !== undefined && opts.duration < opts.targetMin - 1.5) {
    score -= 0.25;
    problems.push(`render is ${opts.duration}s, shorter than target minimum ${opts.targetMin}s`);
  }
  if (opts.targetMax !== undefined && opts.duration > opts.targetMax + 1.5) {
    score -= 0.25;
    problems.push(`render is ${opts.duration}s, longer than target maximum ${opts.targetMax}s`);
  }

  const totalBlack = round2(opts.blackSegments.reduce((s, b) => s + b.duration, 0));
  if (totalBlack >= 0.4) {
    score -= 0.25;
    problems.push(`black frames detected (${totalBlack}s total across ${opts.blackSegments.length} segment(s))`);
  }
  if (opts.lumaMean < 38) {
    score -= 0.25;
    problems.push(`picture is very dark (mean luma ${opts.lumaMean}/255)`);
  }
  if (opts.letterboxed) {
    score -= 0.2;
    problems.push("letterbox/pillarbox black bars are still visible inside the frame");
  }
  if (opts.hasAudio && opts.integratedLufs !== null && opts.integratedLufs !== undefined && opts.integratedLufs < -36) {
    score -= 0.15;
    problems.push(`audio is nearly silent (${opts.integratedLufs} LUFS)`);
  }

  const v = (opts.visionText ?? "").trim();
  if (v) {
    if (/\bcut_text\s*[:=]\s*(yes|true)\b|\b(text|title|words)\s+(is\s+)?(cut\s+off|cropped|clipped)\b/i.test(v)) {
      score -= 0.3;
      problems.push("burned-in text or title appears cut off at the edges (use fit: 'blur')");
    }
    if (/\bbars\s*[:=]\s*(yes|true)\b|\bletterbox\s+bars\b/i.test(v) && !opts.letterboxed) {
      score -= 0.2;
      problems.push("vision check spotted black letterbox bars");
    }
    if (/\btofu\s*[:=]\s*(yes|true)\b|\bmissing\s+glyph\b|\bwrong\s+glyph\b/i.test(v)) {
      score -= 0.2;
      problems.push("caption has broken glyph / tofu box");
    }
    if (opts.expectHook && /\bhook_ok\s*[:=]\s*(no|false)\b/i.test(v)) {
      score -= 0.15;
      problems.push("no visible hook caption or strong opening in the first 2 seconds");
    }
  }

  const clamped = Math.max(0, Math.min(1, round2(score)));
  return { score: clamped, passed: clamped >= 0.7, problems };
}

async function detectSourceCrop(ctx: ToolContext, file: string, p: VideoProbe): Promise<{ crop: string | null; letterboxed: boolean }> {
  const bin = ffmpegBin();
  if (!bin) return { crop: null, letterboxed: false };
  const sampleStart = Math.min(1, Math.max(0, p.duration * 0.15));
  const sampleDur = Math.min(8, Math.max(1, p.duration - sampleStart));
  const r = await spawn(
    [bin, "-hide_banner", "-nostdin", "-ss", String(round2(sampleStart)), "-t", String(round2(sampleDur)), "-i", file, "-an", "-vf", "cropdetect=24:2:0", "-f", "null", "-"],
    mediaDir(ctx),
    ctx.signal,
    undefined,
    60_000,
  );
  return parseCropdetect(r.log, p.width, p.height);
}

async function savedShotIndex(ctx: ToolContext, n: number): Promise<VideoShotIndex | null> {
  const a = ctx.attachments[n - 1];
  if (!a) return null;
  try {
    const r = (await ctx.videoData("index_get", { upload_id: a.id })) as { index: VideoShotIndex | null };
    return r?.index ? VideoShotIndex.parse(r.index) : null;
  } catch {
    return null;
  }
}

export async function indexVideo(ctx: ToolContext, videoNum: number, sceneList?: number[]): Promise<VideoShotIndex> {
  const cached = await savedShotIndex(ctx, videoNum);
  if (cached) return cached;

  const bin = ffmpegBin();
  if (!bin) throw new ToolDenied("ffmpeg is not installed on the runner PC (ffmpeg.org). Tell the owner.");
  const { file } = await attachmentFile(ctx, videoNum);
  const p = await probe(ctx, file);
  const dir = mediaDir(ctx);
  const scenes = sceneList ?? (p.duration <= 20 * 60 ? await sceneChanges(ctx, file) : []);
  const ranges = shotsFromScenes(scenes, p.duration);
  const cropInfo = await detectSourceCrop(ctx, file, p);

  ctx.emit({
    type: "agent.thinking",
    payload: { summary: `Indexing video ${videoNum}: ${ranges.length} shot(s)` },
  });

  const frameFiles: string[] = [];
  const statsByShot: { lumaMean: number; dark: boolean; blurry: boolean }[] = [];

  for (let idx = 0; idx < ranges.length; idx++) {
    const shot = ranges[idx]!;
    const mid = round2((shot.start + shot.end) / 2);
    const frameName = `idx-v${videoNum}-s${idx + 1}.jpg`;
    const r = await spawn(
      [
        bin,
        "-hide_banner",
        "-nostdin",
        "-y",
        "-ss",
        String(mid),
        "-i",
        file,
        "-frames:v",
        "1",
        "-vf",
        "scale=480:-2,signalstats,metadata=mode=print",
        "-q:v",
        "4",
        frameName,
      ],
      dir,
      ctx.signal,
      undefined,
      30_000,
    );
    frameFiles.push(join(dir, frameName));
    statsByShot.push(parseSignalstats(r.log));
  }

  // Describe frames with vision model in batches of <= 4
  const descriptions: ReturnType<typeof parseVisionShotLine>[] = ranges.map(() => ({
    description: "",
    text_on_screen: false,
    faces: false,
    dark: false,
    blurry: false,
  }));

  for (let b = 0; b < frameFiles.length; b += 4) {
    const batch = frameFiles.slice(b, b + 4).filter((f) => existsSync(f));
    if (!batch.length) continue;
    const prompt =
      `You are indexing ${batch.length} video shot frame(s) for an editor. ` +
      `Reply with exactly ${batch.length} line(s), one per image in order:\n` +
      `Line N: <short 1-line description of action/subject/lighting> | text:<yes/no> | faces:<yes/no> | dark:<yes/no> | blurry:<yes/no>\n` +
      `Set text:yes if there is any burned-in title, logo, or text on screen. Set faces:yes if a person/character face is visible.`;
    const raw = await ctx.describeImages(batch, prompt);
    if (!raw) continue;
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    for (let k = 0; k < batch.length; k++) {
      const line = lines[k] ?? (batch.length === 1 ? raw.trim() : "");
      if (line) descriptions[b + k] = parseVisionShotLine(line);
    }
  }

  const shots: ShotInfo[] = ranges.map((rng, idx) => {
    const st = statsByShot[idx]!;
    const vis = descriptions[idx]!;
    return {
      index: idx + 1,
      start: rng.start,
      end: rng.end,
      description: vis.description,
      dark: st.dark || vis.dark,
      blurry: st.blurry || vis.blurry,
      text_on_screen: vis.text_on_screen,
      faces: vis.faces,
      letterboxed: cropInfo.letterboxed,
      luma_mean: st.lumaMean,
    };
  });

  const result: VideoShotIndex = {
    duration: p.duration,
    width: p.width,
    height: p.height,
    crop: cropInfo.crop,
    letterboxed: cropInfo.letterboxed,
    shots,
  };

  const att = ctx.attachments[videoNum - 1];
  if (att) {
    try {
      await ctx.videoData("index_put", { upload_id: att.id, index: result });
    } catch {
      // ignore if agent only has local probe permissions
    }
  }
  return result;
}

export const videoProbeTool = defineTool({
  name: "video_probe",
  description:
    "Look at a video the owner sent: length, size, frame rate, sound, the times where the scene changes (good cut points), " +
    "and optionally a visual shot index (index: true) with vision descriptions and quality flags (dark, blurry, text_on_screen, faces, letterboxed).",
  category: "read_docs",
  input: z.object({
    video: z.number().int().min(1).max(10).describe("Which file the owner sent (1 = first)"),
    scenes: z.boolean().default(true),
    index: z.boolean().default(false).describe("Also build/return the visual shot index with descriptions and flags"),
  }),
  risk: () => "safe",
  describe: (i) => `look at video ${i.video}`,
  async execute(i, ctx) {
    const { file, name } = await attachmentFile(ctx, i.video);
    const p = await probe(ctx, file);
    const scenes = i.scenes && p.duration <= 20 * 60 ? await sceneChanges(ctx, file) : [];
    const shotIndex = i.index ? await indexVideo(ctx, i.video, scenes) : undefined;
    return {
      ok: true,
      summary: `video ${i.video}: ${p.duration}s ${p.width}×${p.height}${shotIndex ? ` (${shotIndex.shots.length} shots indexed)` : ""}`,
      output: {
        video: i.video,
        name,
        ...p,
        size_mb: round2(p.size_bytes / 1024 ** 2),
        scene_changes: scenes,
        ...(shotIndex ? { shot_index: shotIndex } : {}),
      },
    };
  },
});

export const videoIndexTool = defineTool({
  name: "video_index",
  description:
    "Index every shot in a video so you can see what is in the footage before editing: detects scene cuts, checks letterbox black bars (cropdetect) " +
    "and brightness/sharpness (signalstats), and asks the vision model to describe each shot in batches of <= 4 frames. " +
    "Returns start/end, description, and flags (dark, blurry, text_on_screen, faces, letterboxed) per shot. Cached per upload.",
  category: "read_docs",
  input: z.object({
    video: z.number().int().min(1).max(10).describe("Which file the owner sent (1 = first)"),
  }),
  risk: () => "safe",
  describe: (i) => `index shots in video ${i.video}`,
  async execute(i, ctx) {
    const { name } = await attachmentFile(ctx, i.video);
    const idx = await indexVideo(ctx, i.video);
    return {
      ok: true,
      summary: `video ${i.video}: ${idx.shots.length} shot(s) indexed${idx.letterboxed ? ` (letterboxed: ${idx.crop})` : ""}`,
      output: { video: i.video, name, ...idx },
    };
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
    const indexes = new Map<number, VideoShotIndex | null>();
    const isVerticalPreset = preset.height > preset.width;
    for (const c of plan.clips) {
      if (!probes.has(c.video)) {
        const { file } = await attachmentFile(ctx, c.video);
        const pr = await probe(ctx, file);
        const savedIdx = await savedShotIndex(ctx, c.video);
        indexes.set(c.video, savedIdx);
        const crop = savedIdx ? savedIdx.crop : (await detectSourceCrop(ctx, file, pr)).crop;
        probes.set(c.video, { file, probe: pr, crop });
      }
      const clipIn = probes.get(c.video)!;
      inputs.push(clipIn);
      // Text-safe / face-safe reframing: when a wide source goes vertical and an overlapping indexed shot has text_on_screen or faces, use fit: "blur"
      const idx = indexes.get(c.video);
      if (!c.fit && idx && isVerticalPreset && clipIn.probe.width > clipIn.probe.height) {
        const clipEnd = c.end ?? clipIn.probe.duration;
        const overlapping = idx.shots.filter((s) => s.end > c.start && s.start < clipEnd);
        if (overlapping.some((s) => chooseClipFit(s, plan.fit, true, true) === "blur")) {
          c.fit = "blur";
        }
      }
    }
    const overlayInputs: ClipInput[] = [];
    for (const ov of plan.overlays ?? []) {
      if (!probes.has(ov.video)) {
        const { file } = await attachmentFile(ctx, ov.video);
        probes.set(ov.video, { file, probe: await probe(ctx, file) });
      }
      overlayInputs.push(probes.get(ov.video)!);
    }
    const total = finishedSeconds(plan, clipLengths(plan, inputs));
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
      for (const c of subtitleCues(plan, transcripts, durations)) cues.push({ text: c.text, start: c.start, end: c.end, position: plan.subtitles.position, animation: "none" });
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
    const render = (enc: Encoder) => spawn([bin, ...buildEditArgs(plan, inputs, enc, out, captionsFile, musicFile, overlayInputs)], dir, ctx.signal, onProgress);
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
    const prevIdx = ctx.renders.findIndex((x) => x.name === out);
    if (prevIdx >= 0) ctx.renders.splice(prevIdx, 1);
    ctx.renders.push({ id: up.id, name: out, content_type: "video/mp4" });
    return {
      ok: true,
      summary: `rendered ${out} (${total}s, ${round2(size / 1024 ** 2)} MB)`,
      output: { video_id: up.id, file: out, preset: preset.label, seconds: total, size_mb: round2(size / 1024 ** 2), encoder: encoder === "nvenc" ? "NVIDIA GPU (h264_nvenc)" : "CPU (libx264)" },
    };
  },
});

// ---------------------------------------------------------------- TikTok HD (remux or re-encode a finished video)

/** Copy the streams into a clean MP4 with the index at the front (no quality change). Pure. */
export function remuxArgs(input: string, out: string): string[] {
  return ["-hide_banner", "-nostdin", "-y", "-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-map_metadata", "-1", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", out];
}

/** A video file that our TikTok HD tool or page already produced (-tiktok-hd or -tiktok-hd-tiktok_fhd). Pure. */
export function isTiktokHdPrepared(name: string): boolean {
  const base = name.replace(/\.[^.]+$/, "");
  return /-tiktok-hd(-tiktok_fhd)?$/.test(base);
}

export const videoTiktokHdTool = defineTool({
  name: "video_tiktok_hd",
  description:
    "Get a finished video (edited on the phone, CapCut…) ready for TikTok without losing quality. mode auto: when it already matches TikTok (1080×1920, 30/60 fps, H.264, AAC) the streams are only copied into a clean MP4; " +
    "otherwise it is re-encoded once to that spec. Returns the new video id for save_draft(video: id), and why it chose that.",
  category: "write",
  input: z.object({
    video: z.number().int().min(1).max(10).describe("Which file (1 = first)"),
    mode: TikTokHdMode.default("auto"),
  }),
  risk: () => "safe",
  describe: (i) => `TikTok HD for video ${i.video}`,
  async execute(i, ctx) {
    const bin = ffmpegBin();
    if (!bin) throw new ToolDenied("ffmpeg is not installed on the runner PC (ffmpeg.org). Tell the owner.");
    const { file, name } = await attachmentFile(ctx, i.video);
    const before = await probe(ctx, file);
    const facts = (p: VideoProbe) => ({ size: `${p.width}×${p.height}`, fps: p.fps, codec: p.video_codec, mb: round2(p.size_bytes / 1024 ** 2), seconds: p.duration });
    // already prepared on the TikTok HD page: use that very file, no second copy or re-encode
    const attached = ctx.attachments[i.video - 1];
    if (i.mode === "auto" && isTiktokHdPrepared(name) && attached) {
      return { ok: true, summary: `TikTok HD: ${name} is already prepared`, output: { video_id: attached.id, mode: "remux", reasons: [], before: facts(before), after: facts(before) } };
    }
    let plan: ReturnType<typeof tiktokHdPlan>;
    try {
      plan = tiktokHdPlan(before, i.mode);
    } catch (err) {
      throw new ToolDenied((err as Error).message);
    }
    const base = name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_").slice(0, 60) || `video-${i.video}`;
    if (plan.mode === "reencode") {
      const edit = EditPlan.parse({ clips: [{ video: i.video }], preset: "tiktok_fhd", fit: plan.fit, fps: plan.fps, name: `${base}-tiktok-hd` });
      const r = await videoEditTool.execute(edit, ctx);
      const out = r.output as { video_id: string; file: string; size_mb: number };
      const after = await probe(ctx, out.file);
      return { ok: true, summary: `TikTok HD (re-encoded): ${out.file}`, output: { video_id: out.video_id, mode: "reencode", reasons: plan.reasons, before: facts(before), after: facts(after) } };
    }
    const dir = mediaDir(ctx);
    const out = `${base}-tiktok-hd.mp4`;
    const r = await spawn([bin, ...remuxArgs(file, out)], dir, ctx.signal);
    if (r.code !== 0) throw new ToolDenied(`ffmpeg could not remux the video: ${r.stderr.slice(-400)}`);
    const after = await probe(ctx, out);
    const whole = EditPlan.parse({ clips: [{ video: i.video }], name: `${base}-tiktok-hd` });
    const up = await ctx.uploadVideo(join(dir, out), out, { plan: whole, attachments: ctx.attachments });
    ctx.renders.push({ id: up.id, name: out, content_type: "video/mp4" });
    return { ok: true, summary: `TikTok HD (no re-encode): ${out}`, output: { video_id: up.id, mode: "remux", reasons: plan.reasons, before: facts(before), after: facts(after) } };
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
    // ggml-silero-*.bin is the voice-activity model (whisperVadModel), not a speech model
    const bins = readdirSync(dir).filter((f) => f.startsWith("ggml-") && f.endsWith(".bin") && !f.includes("silero")).map((f) => join(dir, f));
    if (bins.length) return bins.sort((a, b) => statSync(b).size - statSync(a).size)[0]!;
  }
  return null;
}

/**
 * Silero voice-activity model for whisper.cpp's --vad: WHISPER_VAD_MODEL, else ggml-silero-*.bin next to the
 * speech model. With it whisper only hears the stretches where someone speaks, so quiet rooms do not
 * become invented text. Optional: without it transcription still works, just less clean.
 */
export function whisperVadModel(): string | null {
  const env = process.env.WHISPER_VAD_MODEL;
  if (env && existsSync(env)) return env;
  for (const dir of ["C:\\whisper\\models", join(process.env.HOME ?? process.env.USERPROFILE ?? ".", ".whisper", "models")]) {
    if (!existsSync(dir)) continue;
    const vad = readdirSync(dir).filter((f) => f.startsWith("ggml-silero") && f.endsWith(".bin")).sort().at(-1);
    if (vad) return join(dir, vad);
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

export const videoReviewTool = defineTool({
  name: "video_review",
  description:
    "Review a rendered video before delivering it: samples 8 frames, builds an 8-frame contact sheet, runs ffprobe + blackdetect + signalstats + cropdetect + loudness (ebur128), " +
    "and asks the vision model to check for black/dark frames, cut-off text, letterbox bars, length vs target, and whether a hook is visible in the first 2 seconds. " +
    "Returns { score: 0..1, passed: boolean, problems: string[], contact_sheet }. If score < 0.7, fix the problems and re-render (max 2 retries).",
  category: "read_docs",
  input: z.object({
    file: z.string().trim().max(120).optional().describe("Rendered file name in workspace media/ (default: latest render in this run)"),
    target_min_seconds: z.number().min(1).optional().describe("Minimum target length in seconds, if requested by the owner"),
    target_max_seconds: z.number().min(1).optional().describe("Maximum target length in seconds, if requested by the owner"),
    expect_hook: z.boolean().default(true).describe("Check whether a visible hook / strong opening appears in the first 2 seconds"),
    request_summary: z.string().trim().max(400).optional().describe("Short summary of what the owner asked for"),
  }),
  risk: () => "safe",
  describe: (i) => `review rendered video ${i.file ?? "latest"}`,
  async execute(i, ctx) {
    const bin = ffmpegBin();
    if (!bin) throw new ToolDenied("ffmpeg is not installed on the runner PC (ffmpeg.org). Tell the owner.");
    const dir = mediaDir(ctx);
    const targetName = i.file?.trim() || ctx.renders.at(-1)?.name;
    if (!targetName || !existsSync(join(dir, targetName))) {
      throw new ToolDenied(`no rendered video "${targetName ?? "last"}" found in media/: run video_edit first`);
    }
    const p = await probe(ctx, targetName);
    ctx.emit({
      type: "agent.thinking",
      payload: { summary: `Reviewing ${targetName} (${p.duration}s, ${p.width}×${p.height})` },
    });

    // 1. Technical check: blackdetect + signalstats + cropdetect
    const tech = await spawn(
      [
        bin,
        "-hide_banner",
        "-nostdin",
        "-i",
        targetName,
        "-an",
        "-vf",
        "scale=360:-2,blackdetect=d=0.2:pix_th=0.10,signalstats,metadata=mode=print,cropdetect=24:2:0",
        "-f",
        "null",
        "-",
      ],
      dir,
      ctx.signal,
      undefined,
      3 * 60_000,
    );
    const blackSegments = parseBlackdetect(tech.log);
    const sig = parseSignalstats(tech.log);
    const cropInfo = parseCropdetect(tech.log, 360, Math.round((360 * p.height) / p.width));

    // 2. Audio loudness check (ebur128) when audio stream is present
    let integratedLufs: number | null = null;
    if (p.has_audio) {
      const aud = await spawn(
        [bin, "-hide_banner", "-nostdin", "-i", targetName, "-vn", "-af", "ebur128=peak=none", "-f", "null", "-"],
        dir,
        ctx.signal,
        undefined,
        2 * 60_000,
      );
      integratedLufs = parseLoudness(aud.log).integratedLufs;
    }

    // 3. Sample 8 frames (frame 1 in first 2s for hook check, frames 2..8 evenly spaced) + build 4x2 contact sheet
    const sampleCount = 8;
    const sampleTimes: number[] = [];
    for (let k = 0; k < sampleCount; k++) {
      const t =
        k === 0
          ? Math.min(0.8, Math.max(0.1, p.duration * 0.08))
          : round2((p.duration * (k + 0.5)) / sampleCount);
      sampleTimes.push(Math.min(Math.max(0, t), Math.max(0, p.duration - 0.05)));
    }
    const base = targetName.replace(/\.[^.]+$/, "");
    const framePaths: string[] = [];
    for (let k = 0; k < sampleTimes.length; k++) {
      const fName = `${base}-rev-${k + 1}.jpg`;
      await spawn(
        [
          bin,
          "-hide_banner",
          "-nostdin",
          "-y",
          "-ss",
          String(sampleTimes[k]),
          "-i",
          targetName,
          "-frames:v",
          "1",
          "-vf",
          "scale=360:-2",
          "-q:v",
          "4",
          fName,
        ],
        dir,
        ctx.signal,
        undefined,
        30_000,
      );
      if (existsSync(join(dir, fName))) framePaths.push(join(dir, fName));
    }

    const contactSheetName = `${base}-contact-sheet.jpg`;
    if (framePaths.length >= 4) {
      const inArgs: string[] = [];
      framePaths.slice(0, 8).forEach((fp) => inArgs.push("-i", fp));
      const count = Math.min(8, framePaths.length);
      const cols = 4;
      const rows = Math.ceil(count / cols);
      const stackInputs = Array.from({ length: count }, (_, idx) => `[${idx}:v]scale=270:-2[s${idx}]`).join(";");
      const tileRefs = Array.from({ length: count }, (_, idx) => `[s${idx}]`).join("");
      await spawn(
        [
          bin,
          "-hide_banner",
          "-nostdin",
          "-y",
          ...inArgs,
          "-filter_complex",
          `${stackInputs};${tileRefs}xstack=inputs=${count}:layout=${Array.from({ length: count }, (_, idx) => `${(idx % cols) * 270}_${Math.floor(idx / cols) * 480}`).join("|")}[out]`,
          "-map",
          "[out]",
          "-frames:v",
          "1",
          "-q:v",
          "3",
          contactSheetName,
        ],
        dir,
        ctx.signal,
        undefined,
        30_000,
      );
    }

    // 4. Vision check in 2 batches of 4 frames
    const visionNotes: string[] = [];
    for (let b = 0; b < framePaths.length; b += 4) {
      const batch = framePaths.slice(b, b + 4);
      const timesLabel = sampleTimes
        .slice(b, b + 4)
        .map((t, idx) => `Frame ${b + idx + 1} (${t}s)`)
        .join(", ");
      const prompt =
        `Review these ${batch.length} rendered video frames (${timesLabel}). ` +
        `${i.request_summary ? `Target request: "${i.request_summary}". ` : ""}` +
        `Check for: (1) burned-in text or titles cut off at the left/right edges, (2) black letterbox bars, (3) broken caption glyphs/tofu boxes, ` +
        `${b === 0 ? "(4) whether Frame 1 shows a clear hook/caption or strong opening. " : ""}` +
        `Reply concisely and include tags: cut_text:<yes/no> | bars:<yes/no> | tofu:<yes/no>${b === 0 ? " | hook_ok:<yes/no>" : ""} | notes:<short summary>`;
      const note = await ctx.describeImages(batch, prompt);
      if (note) visionNotes.push(note);
    }

    const combinedVision = visionNotes.join("\n");
    const evaluation = evaluateReview({
      duration: p.duration,
      targetMin: i.target_min_seconds,
      targetMax: i.target_max_seconds,
      blackSegments,
      lumaMean: sig.lumaMean,
      letterboxed: cropInfo.letterboxed,
      hasAudio: p.has_audio,
      integratedLufs,
      visionText: combinedVision,
      expectHook: i.expect_hook,
    });

    return {
      ok: true,
      summary: `review ${targetName}: score ${evaluation.score} (${evaluation.passed ? "PASS" : `NEEDS FIX: ${evaluation.problems.join("; ")}`})`,
      output: {
        file: targetName,
        score: evaluation.score,
        passed: evaluation.passed,
        problems: evaluation.problems,
        contact_sheet: existsSync(join(dir, contactSheetName)) ? join(dir, contactSheetName) : null,
        sample_times: sampleTimes,
        metrics: {
          duration: p.duration,
          width: p.width,
          height: p.height,
          fps: p.fps,
          luma_mean: sig.lumaMean,
          black_segments: blackSegments,
          letterboxed: cropInfo.letterboxed,
          integrated_lufs: integratedLufs,
        },
        vision_notes: visionNotes,
      },
    };
  },
});

export const VIDEO_TOOLS = [videoProbeTool, videoIndexTool, videoTranscribeTool, videoEditTool, videoReviewTool, suggestEditsTool, videoTiktokHdTool];
