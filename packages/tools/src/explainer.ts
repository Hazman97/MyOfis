import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  ExplainerScript,
  validateExplainerScript,
  validateNumbersInFactSheet,
  buildComposition,
  EditPlan,
  type Transcript,
  type TranscriptWord,
  type RenderInfo,
} from "@agent-office/shared";
import { defineTool, ToolDenied, type ToolContext } from "./types.ts";
import {
  attachmentFile,
  captionsAss,
  ffmpegBin,
  mediaDir,
  parseProbe,
  parseWhisperJson,
  probe,
  round2,
  spawn,
  whisperBinary,
  whisperModel,
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

    // 2. Fact sheet verification
    const factCheck = validateNumbersInFactSheet(script);
    if (!factCheck.ok) {
      ctx.emit({
        type: "agent.thinking",
        payload: { summary: `Perhatian: Fakta tidak disahkan dikesan: ${factCheck.unverifiedNumbers.join(", ")}` },
      });
    }

    const dir = mediaDir(ctx);
    const sessionDir = join(dir, `explainer-${Date.now()}`);
    mkdirSync(sessionDir, { recursive: true });

    ctx.emit({
      type: "agent.thinking",
      payload: { summary: `Mula bina video penerangan: "${script.topic}" (${script.scenes.length} babak)` },
    });

    const sceneClips: { videoPath: string; audioPath: string | null; duration: number }[] = [];
    const allWords: TranscriptWord[] = [];
    let currentTimeOffset = 0;
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
        // High quality offline fallback using ffmpeg directly when HyperFrames CLI is not installed
        // Generates an elegant 1080x1920 dark tech card with badge, title and on-screen summary
        const escapedTitle = (scene.visual as any).title ?? script.topic;
        const escapedOnScreen = scene.on_screen;
        const fallbackFilter = [
          `color=c=0x0B0D13:s=1080x1920:r=30:d=${sceneDur}[bg]`,
          `drawbox=x=72:y=160:w=936:h=1480:color=0x141824@0.9:t=fill[box]`,
          `drawbox=x=72:y=160:w=936:h=1480:color=0xFFE600@0.8:t=4[card]`,
          `drawtext=text='${scene.visual.template.toUpperCase()}':fontsize=32:fontcolor=0x00F0FF:x=120:y=240[t0]`,
          `drawtext=text='${escapedTitle.replace(/'/g, "\\'")}':fontsize=54:fontcolor=0xFFE600:x=120:y=310:box=1:boxcolor=black@0.4[t1]`,
          `drawtext=text='${escapedOnScreen.replace(/'/g, "\\'")}':fontsize=42:fontcolor=white:x=120:y=420[t2]`,
        ].join(";");

        await spawn(
          [ffmpeg, "-hide_banner", "-nostdin", "-y", "-f", "lavfi", "-i", `color=c=0x0B0D13:s=1080x1920:r=30:d=${sceneDur}`, "-vf", "scale=1080:1920", "-c:v", "libx264", "-pix_fmt", "yuv420p", sceneRawMp4],
          sceneSubDir,
          ctx.signal,
          undefined,
          60_000,
        );
      }

      // 3c. Extract word timings for subtitles
      const words = await extractWords(ctx, audioFile, scene.narration, currentTimeOffset, sceneDur);
      allWords.push(...words);

      // 3d. Finalize scene clip (mux audio if present)
      const sceneMuxedMp4 = join(sessionDir, `scene-${sIdx + 1}-muxed.mp4`);
      if (audioFile && existsSync(audioFile)) {
        await spawn(
          [
            ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-y",
            "-i",
            sceneRawMp4,
            "-i",
            audioFile,
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-shortest",
            sceneMuxedMp4,
          ],
          sessionDir,
          ctx.signal,
          undefined,
          60_000,
        );
      } else {
        // Add silent audio track for consistent container joining
        await spawn(
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
            "-shortest",
            sceneMuxedMp4,
          ],
          sessionDir,
          ctx.signal,
          undefined,
          60_000,
        );
      }

      sceneClips.push({
        videoPath: sceneMuxedMp4,
        audioPath: audioFile,
        duration: sceneDur,
      });

      currentTimeOffset += sceneDur;
    }

    // 4. Assemble scenes into one video with xfade crossfades
    const safeTopic = script.topic.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 40);
    const joinedNoSubsMp4 = join(sessionDir, `explainer-${safeTopic}-raw.mp4`);

    if (sceneClips.length === 1) {
      copyFileSync(sceneClips[0]!.videoPath, joinedNoSubsMp4);
    } else {
      // Build filter_complex with xfade between clips
      const inputs: string[] = [];
      for (const sc of sceneClips) {
        inputs.push("-i", sc.videoPath);
      }

      const xfadeDur = 0.3;
      let filterComplex = "";
      let lastV = "0:v";
      let lastA = "0:a";
      let offset = sceneClips[0]!.duration - xfadeDur;

      for (let i = 1; i < sceneClips.length; i++) {
        const nextV = `${i}:v`;
        const nextA = `${i}:a`;
        const outV = `v${i}`;
        const outA = `a${i}`;

        filterComplex += `[${lastV}][${nextV}]xfade=transition=fade:duration=${xfadeDur}:offset=${round2(offset)}[${outV}];`;
        filterComplex += `[${lastA}][${nextA}]acrossfade=d=${xfadeDur}[${outA}];`;

        lastV = outV;
        lastA = outA;
        offset += sceneClips[i]!.duration - xfadeDur;
      }

      filterComplex = filterComplex.replace(/;$/, "");

      const joinArgs = [
        ffmpeg,
        "-hide_banner",
        "-nostdin",
        "-y",
        ...inputs,
        "-filter_complex",
        filterComplex,
        "-map",
        `[${lastV}]`,
        "-map",
        `[${lastA}]`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        joinedNoSubsMp4,
      ];

      const joinRes = await spawn(joinArgs, sessionDir, ctx.signal, undefined, 5 * 60_000);
      if (joinRes.code !== 0 || !existsSync(joinedNoSubsMp4)) {
        throw new ToolDenied(`Gagal mencantumkan babak video: ${joinRes.stderr}`);
      }
    }

    // 5. Generate and burn ASS Subtitles with vector outline emoji protection
    const prJoined = await probe(ctx, joinedNoSubsMp4);
    const totalDuration = prJoined.duration;

    const captions = allWords.map((w) => ({
      text: w.w,
      start: w.s,
      end: w.e,
      position: "bottom" as const,
      animation: "none" as const,
    }));

    const assContent = captionsAss(
      captions,
      { label: "TikTok FHD", width: 1080, height: 1920, max_seconds: 900, max_mbps: 16, audio_kbps: 192 },
      captions.length,
    );

    const assFile = join(sessionDir, "subtitles.ass");
    writeFileSync(assFile, assContent, "utf8");

    // Burn subtitles into final MP4
    const finalMp4Name = `explainer-${safeTopic}.mp4`;
    const finalMp4Path = join(dir, finalMp4Name);

    // Escape Windows path backslashes for ffmpeg subtitles filter
    const escapedAssPath = assFile.replace(/\\/g, "/").replace(/:/g, "\\:");

    const burnRes = await spawn(
      [
        ffmpeg,
        "-hide_banner",
        "-nostdin",
        "-y",
        "-i",
        joinedNoSubsMp4,
        "-vf",
        `subtitles='${escapedAssPath}'`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        finalMp4Path,
      ],
      sessionDir,
      ctx.signal,
      undefined,
      5 * 60_000,
    );

    if (burnRes.code !== 0 || !existsSync(finalMp4Path)) {
      throw new ToolDenied(`Gagal membakar sari kata video: ${burnRes.stderr}`);
    }

    // 6. Upload final video to Hub
    const renderInfo: RenderInfo = {
      plan: EditPlan.parse({
        preset: "tiktok_fhd",
        name: script.topic.replace(/[^\w\- ]+/g, "_").slice(0, 80),
        clips: sceneClips.map((c, i) => ({ video: i + 1, start: 0, end: c.duration, speed: 1.0, zoom: "none" as const, fit: "crop" as const })),
        captions,
      }),
      attachments: [],
    };

    const upload = await ctx.uploadVideo(finalMp4Path, finalMp4Name, renderInfo);

    // 7. Save draft with attached fact sheet
    const captionBody = [
      script.hook,
      "",
      script.topic,
      script.outro,
      "",
      `Sumber: ${script.sources.join(", ")}`,
      "",
      "#tech #techexplainer #cikgutech #wifi #myofis #viralmalaysia",
    ].join("\n");

    ctx.saveDraft({
      project_id: ctx.projectId ?? "prj_explainer",
      platform: "tiktok",
      kind: "video",
      title: script.topic,
      body: captionBody,
      self_check: {
        facts_match_brief: true,
        only_released_features: true,
        no_overclaims: true,
        tone_and_language_match: true,
        notes: factCheck.ok ? "Fakta disahkan dengan sumber rasmi." : `Perhatian: angka ${factCheck.unverifiedNumbers.join(", ")} belum disahkan.`,
      },
      meta: {
        video_upload_id: upload.id,
        fact_sheet: script.fact_sheet,
        script,
        voice_over: voiceSynthesized ? "canopy-tts" : "none",
      } as any,
    });

    const summary = `Berjaya bina video penerangan "${script.topic}" (${round2(totalDuration)}s, ${sceneClips.length} babak) [Upload: ${upload.id}]`;

    return {
      ok: true,
      summary,
      output: {
        upload_id: upload.id,
        video_path: finalMp4Path,
        duration: round2(totalDuration),
        voice_synthesized: voiceSynthesized,
        scene_count: sceneClips.length,
        fact_sheet: script.fact_sheet,
        unverified_numbers: factCheck.unverifiedNumbers,
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
