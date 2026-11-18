import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import {
  ExplainerScript,
  validateExplainerScript,
  validateNumbersInFactSheet,
  buildComposition,
  EditPlan,
  VIDEO_PRESETS,
  finishedSeconds,
  subtitleCues,
  type Transcript,
  type TranscriptWord,
  type RenderInfo,
} from "@agent-office/shared";
import { defineTool, ToolDenied, type ToolContext } from "./types.ts";
import {
  buildEditArgs,
  captionsAss,
  ffmpegBin,
  mediaDir,
  parseWhisperJson,
  probe,
  round2,
  spawn,
  videoReviewTool,
  whisperBinary,
  whisperModel,
  type ClipInput,
  type Encoder,
} from "./video.ts";
import { buildHyperframesArgs, hyperframesBinary, spawnMotion } from "./motion.ts";

/**
 * Task 029: Tech explainer video rendering tool (`explainer_render`).
 * Assembles 1..8 infographic scenes into a 1080×1920 TikTok/Reels video with:
 * - Hub voice-over (TTS) in Malay per scene (or silent on-screen fallback)
 * - HyperFrames motion graphics (or headless ffmpeg canvas fallback)
 * - Word-level ASS kinetic captions
 * - Crossfade scene transitions and audio ducking
 * - Automatic fact sheet preservation in draft metadata
 */

export const explainerRenderTool = defineTool({
  name: "explainer_render",
  description:
    "Render an infographic tech explainer video (30–75s, 1080×1920) from a structured ExplainerScript. " +
    "Generates Malay voice-over via hub TTS, motion visuals (spectrum, compare table, bar chart, big stat, timeline, diagram), " +
    "subtitles from Whisper, and crossfade cuts into a finished video draft with an attached fact sheet.",
  category: "write",
  input: ExplainerScript,
  risk: () => "safe",
  describe: (i) => `render tech explainer video: "${i.topic}" (${i.scenes.length} scenes)`,
  async execute(script, ctx) {
    const ffmpeg = ffmpegBin();
    if (!ffmpeg) throw new ToolDenied("ffmpeg is not installed on the runner PC. Tell the owner.");

    // 1. Script validation
    const vRes = validateExplainerScript(script);
    if (!vRes.valid) {
      throw new ToolDenied(`Script validation failed: ${vRes.errors.join("; ")}`);
    }

    // 2. Fact sheet verification (blocks render on unverified numbers unless pasted: true)
    const factCheck = validateNumbersInFactSheet(script);
    if (!factCheck.ok) {
      throw new ToolDenied(
        `Unverified numbers not found in fact_sheet (with source_url): ${factCheck.unverifiedNumbers.join(", ")}. Verify with web_fetch and add them to fact_sheet.`,
      );
    }

    const dir = mediaDir(ctx);
    const sessionDir = join(dir, `explainer-${Date.now()}`);
    mkdirSync(sessionDir, { recursive: true });

    ctx.emit({
      type: "agent.thinking",
      payload: { summary: `Mula bina video penerangan: "${script.topic}" (${script.scenes.length} babak)` },
    });

    const sceneClips: { videoPath: string; audioPath: string | null; duration: number; transcript: Transcript }[] = [];
    let voiceSynthesized = false;

    // 3. Render each scene
    for (let sIdx = 0; sIdx < script.scenes.length; sIdx++) {
      const scene = script.scenes[sIdx]!;
      const sceneSubDir = join(sessionDir, `scene-${sIdx + 1}`);
      mkdirSync(sceneSubDir, { recursive: true });

      // 3a. Voice-over via Hub TTS
      let audioFile: string | null = null;
      let audioDur = 0;
      try {
        audioFile = await ctx.tts(scene.narration);
      } catch (err) {
        ctx.emit({
          type: "agent.thinking",
          payload: { summary: `TTS hub tidak tersedia untuk babak ${sIdx + 1}: ${(err as Error).message}` },
        });
      }

      if (audioFile && existsSync(audioFile)) {
        try {
          const pr = await probe(ctx, audioFile);
          audioDur = pr.duration;
          voiceSynthesized = true;
        } catch {
          audioDur = 0;
        }
      }

      // Duration: audio + 0.3s padding, or word-count estimate (~2.3 words/s)
      const sceneDur = audioDur > 0
        ? round2(audioDur + 0.3)
        : Math.max(4, round2(scene.narration.trim().split(/\s+/).length / 2.3));

      ctx.emit({
        type: "agent.thinking",
        payload: {
          summary: `Babak ${sIdx + 1}/${script.scenes.length} [${scene.visual.template}]: ${sceneDur}s ${audioDur > 0 ? "(ada suara)" : "(tanpa suara)"}`,
        },
      });

      // 3b. Render Visual (HyperFrames or ffmpeg fallback)
      const comp = buildComposition(scene.visual.template, {
        ...scene.visual,
        duration: sceneDur,
      });

      const htmlPath = join(sceneSubDir, "index.html");
      writeFileSync(htmlPath, comp.html, "utf8");

      const sceneRawMp4 = join(sceneSubDir, `scene-${sIdx + 1}-raw.mp4`);
      const hfBin = hyperframesBinary();

      if (hfBin) {
        const hfArgs = buildHyperframesArgs(hfBin, htmlPath, sceneRawMp4, {
          fps: 30,
          width: 1080,
          height: 1920,
        });
        const r = await spawnMotion(hfArgs, sceneSubDir, ctx.signal, undefined, 10 * 60_000);
        if (r.code !== 0 || !existsSync(sceneRawMp4)) {
          throw new ToolDenied(`HyperFrames gagal pada babak ${sIdx + 1}: ${r.stderr || r.stdout}`);
        }
      } else {
        // Render the HTML/SVG infographic to a 1080×1920 PNG via the Node Playwright browser worker,
        // then animate it with a subtle Ken Burns zoom in ffmpeg.
        const workerPath = fileURLToPath(new URL("../browser/worker.mjs", import.meta.url));
        const pngPath = join(sceneSubDir, `scene-${sIdx + 1}.png`);
        const reqJson = JSON.stringify({
          url: `${pathToFileURL(htmlPath).href}?t=${sceneDur}`,
          screenshot_path: pngPath,
          viewport: { width: 1080, height: 1920 },
          timeout_ms: 30_000,
        });
        const nodeBin = process.platform === "win32" ? "node.exe" : "node";
        const wRes = await spawn([nodeBin, workerPath, reqJson], sceneSubDir, ctx.signal, undefined, 45_000);
        if (wRes.code !== 0 || !existsSync(pngPath)) {
          throw new ToolDenied(`Gagal merender grafik babak ${sIdx + 1} melalui browser worker: ${wRes.stderr || wRes.stdout}`);
        }
        const frames = Math.max(30, Math.ceil(sceneDur * 30));
        const animRes = await spawn(
          [
            ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-y",
            "-loop",
            "1",
            "-i",
            pngPath,
            "-vf",
            `zoompan=z='min(zoom+0.0006,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30,format=yuv420p`,
            "-t",
            String(sceneDur),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            sceneRawMp4,
          ],
          sceneSubDir,
          ctx.signal,
          undefined,
          60_000,
        );
        if (animRes.code !== 0 || !existsSync(sceneRawMp4)) {
          throw new ToolDenied(`Gagal menganimasikan grafik babak ${sIdx + 1}: ${animRes.stderr.slice(-400)}`);
        }
      }

      // 3c. Extract 0-based word timings for this scene (subtitleCues handles transition offsets)
      const words = await extractWords(ctx, audioFile, scene.narration, 0, audioDur > 0 ? audioDur : sceneDur);

      // 3d. Finalize scene clip with exact duration = audio + 0.3s tail (no -shortest!)
      const sceneMuxedMp4 = join(sessionDir, `scene-${sIdx + 1}-muxed.mp4`);
      if (audioFile && existsSync(audioFile)) {
        const muxRes = await spawn(
          [
            ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-y",
            "-i",
            sceneRawMp4,
            "-i",
            audioFile,
            "-filter_complex",
            `[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_dur=${sceneDur}[a]`,
            "-map",
            "0:v",
            "-map",
            "[a]",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-t",
            String(sceneDur),
            sceneMuxedMp4,
          ],
          sessionDir,
          ctx.signal,
          undefined,
          60_000,
        );
        if (muxRes.code !== 0 || !existsSync(sceneMuxedMp4)) {
          throw new ToolDenied(`Gagal menggabungkan audio babak ${sIdx + 1}: ${muxRes.stderr.slice(-400)}`);
        }
      } else {
        // Add silent audio track for consistent container joining
        const muxRes = await spawn(
          [
            ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-y",
            "-i",
            sceneRawMp4,
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=48000:cl=stereo",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-t",
            String(sceneDur),
            sceneMuxedMp4,
          ],
          sessionDir,
          ctx.signal,
          undefined,
          60_000,
        );
        if (muxRes.code !== 0 || !existsSync(sceneMuxedMp4)) {
          throw new ToolDenied(`Gagal menambah trek audio senyap babak ${sIdx + 1}: ${muxRes.stderr.slice(-400)}`);
        }
      }

      const sceneProbe = await probe(ctx, sceneMuxedMp4);
      sceneClips.push({
        videoPath: sceneMuxedMp4,
        audioPath: audioFile,
        duration: sceneProbe.duration || sceneDur,
        transcript: { language: script.language ?? "ms", duration: sceneProbe.duration || sceneDur, model: "whisper", words },
      });
    }

    // 4. Assemble through video_edit primitives: clips + 0.3s fade transition + pop captions via subtitleCues + optional music from clip_folder/music
    const safeTopic = script.topic.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 40) || "explainer";
    const finalMp4Name = `explainer-${safeTopic}.mp4`;
    const finalMp4Path = join(dir, finalMp4Name);

    const clipInputs: ClipInput[] = await Promise.all(
      sceneClips.map(async (sc) => ({
        file: sc.videoPath,
        probe: await probe(ctx, sc.videoPath),
      })),
    );

    const folder = ctx.config.clip_folder?.trim();
    const musicDir = folder ? join(folder, "music") : null;
    const musicTrack =
      musicDir && existsSync(musicDir)
        ? readdirSync(musicDir).find((f) => /\.(mp3|m4a|wav|aac|ogg)$/i.test(f)) ?? null
        : null;
    const musicFile = musicDir && musicTrack ? join(musicDir, musicTrack) : null;

    const buildAndRunAssembly = async (normalizeAudio: boolean, useMusic: boolean) => {
      const plan = EditPlan.parse({
        preset: "tiktok_fhd",
        name: safeTopic,
        fit: "crop",
        fps: 30,
        transition: sceneClips.length > 1 ? { type: "fade", seconds: 0.3 } : { type: "none", seconds: 0 },
        subtitles: { style: "pop", position: "bottom", max_words: 3 },
        normalize_audio: normalizeAudio,
        music: useMusic && musicTrack ? { track: musicTrack, volume_db: -20 } : null,
        clips: clipInputs.map((_, idx) => ({ video: idx + 1, start: 0, speed: 1, zoom: "none" as const })),
      });

      const transcripts: Record<number, Transcript> = {};
      const durations: Record<number, number> = {};
      sceneClips.forEach((sc, idx) => {
        transcripts[idx + 1] = sc.transcript;
        durations[idx + 1] = clipInputs[idx]!.probe.duration;
      });

      const cues = subtitleCues(plan, transcripts, durations).map((c) => ({
        text: c.text,
        start: c.start,
        end: c.end,
        position: "bottom" as const,
        animation: "pop" as const,
      }));
      const assName = `${safeTopic}-subtitles.ass`;
      if (cues.length > 0) {
        writeFileSync(join(dir, assName), captionsAss(cues, VIDEO_PRESETS.tiktok_fhd, cues.length), "utf8");
      }

      let enc: Encoder = (await spawn([ffmpeg, "-hide_banner", "-encoders"], dir, ctx.signal, undefined, 30_000)).stdout.includes("h264_nvenc")
        ? "nvenc"
        : "x264";
      let args = buildEditArgs(plan, clipInputs, enc, finalMp4Name, cues.length > 0 ? assName : null, useMusic ? musicFile : null);
      let res = await spawn([ffmpeg, ...args], dir, ctx.signal, undefined, 5 * 60_000);
      if (res.code !== 0 && enc === "nvenc" && !ctx.signal.aborted) {
        enc = "x264";
        args = buildEditArgs(plan, clipInputs, enc, finalMp4Name, cues.length > 0 ? assName : null, useMusic ? musicFile : null);
        res = await spawn([ffmpeg, ...args], dir, ctx.signal, undefined, 5 * 60_000);
      }
      if (res.code !== 0 || !existsSync(finalMp4Path)) {
        throw new ToolDenied(`Gagal menyusun video penerangan: ${res.stderr.slice(-500)}`);
      }
      return { plan, cues };
    };

    let { plan, cues } = await buildAndRunAssembly(false, !!musicFile);

    // 5. Run video_review; if score < 0.7, fix once and re-review
    let reviewOut: { score: number; passed: boolean; problems: string[] } | null = null;
    try {
      const rv1 = await videoReviewTool.execute({ file: finalMp4Name, expect_hook: true, request_summary: script.topic }, ctx);
      reviewOut = rv1.output as { score: number; passed: boolean; problems: string[] };
      if (reviewOut && reviewOut.score < 0.7) {
        ctx.emit({
          type: "agent.thinking",
          payload: { summary: `video_review skor ${reviewOut.score} (< 0.7): membaiki sekali (${reviewOut.problems.join("; ")})` },
        });
        ({ plan, cues } = await buildAndRunAssembly(true, false));
        const rv2 = await videoReviewTool.execute({ file: finalMp4Name, expect_hook: true, request_summary: script.topic }, ctx);
        reviewOut = rv2.output as { score: number; passed: boolean; problems: string[] };
      }
    } catch {
      // video_review failure should not mask a valid render if vision model is unavailable
    }

    const prFinal = await probe(ctx, finalMp4Path);
    const totalDuration = prFinal.duration || finishedSeconds(plan, clipInputs.map((c) => c.probe.duration));

    // 6. Upload final video to Hub
    const renderInfo: RenderInfo = {
      plan: { ...plan, captions: cues },
      attachments: [],
    };

    const upload = await ctx.uploadVideo(finalMp4Path, finalMp4Name, renderInfo);
    ctx.renders.push({
      id: upload.id,
      name: finalMp4Name,
      content_type: "video/mp4",
      fact_sheet: script.fact_sheet,
      unverified: factCheck.unverified,
    });

    const summary = `Berjaya bina video penerangan "${script.topic}" (${round2(totalDuration)}s, ${sceneClips.length} babak). Guna save_draft(video: "${upload.id}") untuk simpan draf.`;

    return {
      ok: true,
      summary,
      output: {
        video_id: upload.id,
        upload_id: upload.id,
        video_path: finalMp4Path,
        duration: round2(totalDuration),
        voice_synthesized: voiceSynthesized,
        scene_count: sceneClips.length,
        fact_sheet: script.fact_sheet,
        unverified: factCheck.unverified,
        unverified_numbers: factCheck.unverifiedNumbers,
        review: reviewOut,
      },
    };
  },
});

/** Transcribe TTS audio with Whisper or evenly distribute words if Whisper is unavailable. */
async function extractWords(
  ctx: ToolContext,
  audioFile: string | null,
  narration: string,
  startOffset: number,
  duration: number,
): Promise<TranscriptWord[]> {
  const wordsRaw = narration.trim().split(/\s+/).filter(Boolean);
  if (wordsRaw.length === 0) return [];

  const bin = whisperBinary();
  const model = whisperModel();
  const dir = mediaDir(ctx);

  if (bin && model && audioFile && existsSync(audioFile)) {
    try {
      const ffmpeg = ffmpegBin()!;
      const wav = join(dir, `in-explainer-${Date.now()}.wav`);
      await spawn([ffmpeg, "-hide_banner", "-nostdin", "-y", "-i", audioFile, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], dir, ctx.signal, undefined, 30_000);

      const out = `whisper-${Date.now()}`;
      const r = await spawn([bin, "-m", model, "-f", wav, "-l", "ms", "-ojf", "-of", out, "-ml", "1", "-sow", "-np"], dir, ctx.signal, undefined, 60_000);
      const jsonPath = join(dir, `${out}.json`);

      if (r.code === 0 && existsSync(jsonPath)) {
        const transcript = parseWhisperJson(JSON.parse(readFileSync(jsonPath, "utf8")), duration, "whisper");
        try { rmSync(jsonPath, { force: true }); rmSync(wav, { force: true }); } catch {}
        if (transcript.words.length > 0) {
          return transcript.words.map((w) => ({
            w: w.w,
            s: round2(startOffset + w.s),
            e: round2(startOffset + w.e),
          }));
        }
      }
    } catch {
      // fallback to uniform distribution
    }
  }

  // Uniform distribution fallback
  const step = duration / wordsRaw.length;
  return wordsRaw.map((word, i) => ({
    w: word,
    s: round2(startOffset + i * step),
    e: round2(startOffset + (i + 1) * step),
  }));
}
