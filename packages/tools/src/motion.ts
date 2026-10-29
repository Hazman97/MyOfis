import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  MotionTemplateId,
  Transcript,
  buildComposition,
} from "@agent-office/shared";
import { scrubbedEnv } from "./safety.ts";
import { ToolDenied, defineTool, type ToolContext } from "./types.ts";
import { attachmentFile, ffmpegBin, mediaDir, spawn } from "./video.ts";

/**
 * Motion text / kinetic typography rendering tool (`motion_render`) powered by HyperFrames CLI.
 * Generates a self-contained HTML composition from our vetted templates (`packages/shared/src/motion.ts`),
 * renders it to MP4 in an isolated `<workspace>/media/motion-<n>/` folder without a shell and with network
 * blocked, and uploads the resulting MP4 so it becomes "video N" for `video_edit` and `save_draft(video: "last")`.
 */

const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Locate the HyperFrames CLI binary on the runner machine. */
export function hyperframesBinary(): string | null {
  const env = process.env.HYPERFRAMES_CLI;
  if (env && existsSync(env)) return env;
  const onPath = Bun.which("hyperframes");
  if (onPath) return onPath;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const candidates = [
    "/usr/local/bin/hyperframes",
    join(home, ".local", "bin", "hyperframes"),
    join(home, ".npm-global", "bin", "hyperframes"),
    join(process.env.APPDATA ?? "", "npm", "hyperframes.cmd"),
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

/**
 * Build the scrubbed + network-isolated environment for HyperFrames and its headless Chrome child process.
 * Chrome is blocked from resolving any external hostnames via `--host-resolver-rules` and loopback proxy blackhole.
 */
export function motionEnv(): Record<string, string> {
  const base = scrubbedEnv();
  return {
    ...base,
    CHROME_EXTRA_ARGS:
      "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1 , EXCLUDE localhost --disable-background-networking --disable-extensions --disable-sync",
    PUPPETEER_ARGS:
      "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1 , EXCLUDE localhost --disable-background-networking",
    HTTP_PROXY: "http://127.0.0.1:1",
    HTTPS_PROXY: "http://127.0.0.1:1",
    NO_PROXY: "127.0.0.1,localhost",
  };
}

export interface HyperframesRenderOpts {
  fps: number;
  width: number;
  height: number;
  quality?: "draft" | "standard" | "high";
}

/** Build the argv array for the HyperFrames CLI (invoked directly via Bun.spawn without a shell). Pure. */
export function buildHyperframesArgs(
  bin: string,
  compositionHtmlPath: string,
  outputMp4Path: string,
  opts: HyperframesRenderOpts,
): string[] {
  return [
    bin,
    "render",
    "--composition",
    compositionHtmlPath,
    "--output",
    outputMp4Path,
    "--fps",
    String(opts.fps),
    "--width",
    String(opts.width),
    "--height",
    String(opts.height),
    "--quality",
    opts.quality ?? "standard",
  ];
}

/** Spawn HyperFrames without a shell, using motionEnv() and a 15-minute timeout. */
export async function spawnMotion(
  argv: string[],
  cwd: string,
  signal: AbortSignal,
  onProgress?: (chunk: string) => void,
  timeoutMs = 15 * 60_000,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(argv, {
      cwd,
      env: motionEnv(),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (err) {
    throw new ToolDenied(
      `could not start ${argv[0]}: ${(err as Error).message}. Install HyperFrames on the runner PC (scripts/runner-video-setup.sh) and restart the runner.`,
    );
  }
  const kill = () => proc.kill();
  const timer = setTimeout(kill, timeoutMs);
  signal.addEventListener("abort", kill, { once: true });
  try {
    const readStream = async (stream: ReadableStream<Uint8Array>, report?: (s: string) => void) => {
      let acc = "";
      const dec = new TextDecoder();
      for await (const chunk of stream) {
        const s = dec.decode(chunk, { stream: true });
        report?.(s);
        acc = (acc + s).slice(-16_000);
      }
      return acc;
    };
    const [stdout, stderr, code] = await Promise.all([
      readStream(proc.stdout as ReadableStream<Uint8Array>, onProgress),
      readStream(proc.stderr as ReadableStream<Uint8Array>, onProgress),
      proc.exited,
    ]);
    return { code, stdout, stderr: stderr.slice(-4000) };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", kill);
  }
}

/** Allocate the next `<workspace>/media/motion-<n>` directory for a motion render. */
export function nextMotionDir(ctx: ToolContext): { index: number; dir: string } {
  const base = mediaDir(ctx);
  const existing = readdirSync(base)
    .map((name) => /^motion-(\d+)$/.exec(name))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
  const index = (existing.length ? Math.max(...existing) : 0) + 1;
  const dir = join(base, `motion-${index}`);
  mkdirSync(dir, { recursive: true });
  return { index, dir };
}

export const MotionBackgroundSchema = z.object({
  video: z.number().int().min(1).max(10).optional().describe("Use video attachment N as the background behind the motion text"),
  colour: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .describe("Hex background colour, e.g. #0B0D13 or #00FF00 for chroma key"),
  image: z.number().int().min(1).max(10).optional().describe("Use image attachment N as the background behind the motion text"),
});

export const MotionRenderInput = z.object({
  template: MotionTemplateId.describe(
    "Which motion template to render: hook, kinetic_captions, title_card, list, countdown, lower_third, or outro_cta",
  ),
  params: z
    .record(z.string(), z.unknown())
    .default({})
    .describe("Template parameters (lines/text, items, palette, font, size, duration, etc.)"),
  background: MotionBackgroundSchema.optional().describe("Optional background video, image, or hex colour"),
  transparent: z
    .boolean()
    .default(false)
    .describe("Render on a chroma-key green background (#00FF00) so video_edit overlays can key it out over footage"),
  video_for_transcript: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("For kinetic_captions: pull word timings automatically from this video's Whisper transcript"),
  name: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[\w\- ]+$/)
    .default("motion")
    .describe("Output file name, no extension"),
});
export type MotionRenderInput = z.infer<typeof MotionRenderInput>;

export const motionRenderTool = defineTool({
  name: "motion_render",
  description:
    "Render animated TikTok/Reels motion graphics (moving text) to an MP4 video with HyperFrames on this PC. " +
    "Templates: hook (1–3 big pop-in lines), kinetic_captions (word-by-word highlighted spoken words), title_card, " +
    "list (3–7 points appearing one by one), countdown, lower_third, outro_cta. " +
    "Returns a new video number (video N) and video_id so you can join/overlay it in video_edit or attach it with save_draft(video: 'last').",
  category: "write",
  input: MotionRenderInput,
  risk: () => "safe",
  describe: (i) => `render motion ${i.template} (${i.name})`,
  async execute(i, ctx) {
    const { index: motionIdx, dir: motionDir } = nextMotionDir(ctx);
    const mergedParams: Record<string, unknown> = { ...i.params };

    // When transparent is requested for overlaying in video_edit, use a pure #00FF00 key background
    if (i.transparent) {
      mergedParams.transparent = false;
      mergedParams.background_color = "#00FF00";
    } else if (i.background?.colour) {
      mergedParams.background_color = i.background.colour;
    }

    // Optional background image or video copied into the composition folder so local relative path works offline
    if (i.background?.image) {
      const att = ctx.attachments[i.background.image - 1];
      if (!att) throw new ToolDenied(`there is no file ${i.background.image}; the owner sent ${ctx.attachments.length}`);
      const ext = IMAGE_TYPES[att.content_type];
      if (!ext) throw new ToolDenied(`file ${i.background.image} (${att.name}) is not a supported image (JPEG/PNG/WebP)`);
      const bgImgFile = `bg-image.${ext}`;
      await ctx.downloadAttachment(att.id, join(motionDir, bgImgFile));
      mergedParams.background_media = { kind: "image", src: bgImgFile };
    } else if (i.background?.video) {
      const { file } = await attachmentFile(ctx, i.background.video);
      const srcPath = join(mediaDir(ctx), file);
      const bgVidFile = `bg-${file}`;
      copyFileSync(srcPath, join(motionDir, bgVidFile));
      mergedParams.background_media = { kind: "video", src: bgVidFile };
    }

    // For kinetic_captions, pull word timings from a saved transcript if words were not explicitly passed
    if (i.template === "kinetic_captions" && !mergedParams.words && (i.video_for_transcript || i.background?.video)) {
      const vNum = i.video_for_transcript ?? i.background?.video!;
      const att = ctx.attachments[vNum - 1];
      if (!att) throw new ToolDenied(`there is no video ${vNum}`);
      const r = (await ctx.videoData("transcript_get", { upload_id: att.id })) as { transcript: Transcript | null };
      if (!r.transcript) {
        throw new ToolDenied(`video ${vNum} has no transcript yet: run video_transcribe(video: ${vNum}) first, or pass words/text in params`);
      }
      const t = Transcript.parse(r.transcript);
      mergedParams.words = t.words;
      if (!mergedParams.duration) mergedParams.duration = t.duration;
    }

    let comp: ReturnType<typeof buildComposition>;
    try {
      comp = buildComposition(i.template, mergedParams);
    } catch (err) {
      throw new ToolDenied(`invalid ${i.template} parameters: ${(err as Error).message}`);
    }

    const htmlPath = join(motionDir, "index.html");
    writeFileSync(htmlPath, comp.html, "utf8");

    const bin = hyperframesBinary();
    if (!bin) {
      throw new ToolDenied(
        "hyperframes CLI is not installed on the runner PC (run scripts/runner-video-setup.sh or see docs/video-editor.md). Tell the owner.",
      );
    }

    const safeBase = i.name.replace(/\s+/g, "_");
    const rawMp4Name = `${safeBase}-${i.template}-raw.mp4`;
    const rawMp4Path = join(motionDir, rawMp4Name);
    const finalFileName = `${safeBase}-${i.template}.mp4`;
    const finalPath = join(mediaDir(ctx), finalFileName);

    ctx.emit({
      type: "agent.thinking",
      payload: { summary: `Rendering motion ${i.template} (${comp.width}×${comp.height}, ${comp.duration}s)` },
    });

    let lastPct = 0;
    const onProgress = (chunk: string) => {
      const m = /(\d{1,3})%/.exec(chunk);
      if (!m) return;
      const pct = Math.min(99, Number(m[1]));
      if (pct >= lastPct + 20) {
        lastPct = pct - (pct % 20);
        ctx.emit({ type: "agent.thinking", payload: { summary: `Rendering motion ${i.template}: ${lastPct}%` } });
      }
    };

    const argv = buildHyperframesArgs(bin, htmlPath, rawMp4Path, {
      fps: comp.fps,
      width: comp.width,
      height: comp.height,
    });
    const res = await spawnMotion(argv, motionDir, ctx.signal, onProgress, 15 * 60_000);
    if (res.code !== 0 || !existsSync(rawMp4Path)) {
      throw new ToolDenied(`hyperframes render failed: ${(res.stderr || res.stdout).slice(-500)}`);
    }

    // Ensure the output MP4 has a standard stereo AAC track + faststart so video_edit concat/xfade/overlays work seamlessly
    const ffmpeg = ffmpegBin();
    if (ffmpeg) {
      const norm = await spawn(
        [
          ffmpeg,
          "-hide_banner",
          "-nostdin",
          "-y",
          "-i",
          rawMp4Path,
          "-f",
          "lavfi",
          "-i",
          `anullsrc=r=48000:cl=stereo`,
          "-t",
          String(comp.duration),
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          "18",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-shortest",
          "-movflags",
          "+faststart",
          finalPath,
        ],
        motionDir,
        ctx.signal,
        undefined,
        5 * 60_000,
      );
      if (norm.code !== 0 || !existsSync(finalPath)) {
        copyFileSync(rawMp4Path, finalPath);
      }
    } else {
      copyFileSync(rawMp4Path, finalPath);
    }

    const sizeBytes = statSync(finalPath).size;
    const sizeMb = Math.round((sizeBytes / 1024 ** 2) * 100) / 100;
    const up = await ctx.uploadVideo(finalPath, finalFileName);
    ctx.renders.push({ id: up.id, name: finalFileName, content_type: "video/mp4" });

    // Also register as a local attachment so video_edit in the same run can reference it as `video: N`
    let videoNum = ctx.attachments.findIndex((a) => a.id === up.id) + 1;
    if (videoNum === 0) {
      ctx.attachments.push({ id: up.id, name: finalFileName, content_type: "video/mp4" });
      videoNum = ctx.attachments.length;
      const inSlot = join(mediaDir(ctx), `in-${videoNum}.mp4`);
      if (!existsSync(inSlot)) copyFileSync(finalPath, inSlot);
    }

    return {
      ok: true,
      summary: `rendered motion ${i.template}: ${finalFileName} (${comp.duration}s, video ${videoNum})`,
      output: {
        video_id: up.id,
        video: videoNum,
        file: finalFileName,
        template: i.template,
        duration: comp.duration,
        width: comp.width,
        height: comp.height,
        fps: comp.fps,
        transparent_chromakey: i.transparent ? "#00FF00" : null,
        size_mb: sizeMb,
        motion_dir: `media/motion-${motionIdx}`,
      },
    };
  },
});

