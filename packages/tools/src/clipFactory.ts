import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  CLIP_SCORE_PROMPT_V1,
  CaptionPresetSchema,
  ClipCandidateSchema,
  ClipScoreItemSchema,
  EditPlan,
  ReframeModeSchema,
  SelfCheck,
  WebPost,
  calculateViralityScore,
  findCandidateWindows,
  generateAnimatedCaptions,
  parseAudioEnergyPeaks,
  type ClipCandidate,
  type ClipScoreItem,
} from "@agent-office/shared";
import { ToolDenied, defineTool, type ToolContext } from "./types.ts";
import { resolveProject, validateDraftAgainstBrief } from "./content.ts";
import {
  attachmentFile,
  ffmpegBin,
  mediaDir,
  probe,
  round2,
  savedShotIndex,
  savedTranscript,
  spawn,
  videoEditTool,
  videoIndexTool,
  videoTranscribeTool,
} from "./video.ts";

/**
 * Clip Factory Runner Tools (Task 028).
 * Autonomous OpusClip parity: find moments, score virality, smart reframe,
 * animated captions with vector emoji, and render to 9:16 drafts.
 */

// ---------------------------------------------------------------- clip_find tool

export const clipFindTool = defineTool({
  name: "clip_find",
  description:
    "Find the most viral short-form moments in a long video (OpusClip parity): uses transcript sentence boundaries, audio energy/laughter peaks (ebur128), and shot index. The model scores each candidate on hook (first 3s), flow, value, emotion, and trend (0-99 score) with 3 hook options and post caption. Returns candidate clips sorted by virality score.",
  category: "write",
  input: z.object({
    video: z.number().int().min(1).max(10).describe("Which video file the owner sent (1 = first)"),
    prompt: z.string().trim().max(300).optional().describe("Topic or goal focus (e.g. 'harga kandang', 'tips bisnes', 'kelakar')"),
    min_duration: z.number().int().min(10).max(300).default(15).describe("Minimum clip duration in seconds (default 15)"),
    max_duration: z.number().int().min(15).max(900).default(90).describe("Maximum clip duration in seconds (default 90)"),
    max_clips: z.number().int().min(1).max(12).default(6).describe("Maximum candidate clips to return"),
  }),
  risk: () => "safe",
  describe: (i) => `find viral clips for video ${i.video}${i.prompt ? ` focusing on "${i.prompt}"` : ""}`,
  async execute(i, ctx) {
    const bin = ffmpegBin();
    if (!bin) throw new ToolDenied("ffmpeg is not installed on the runner PC. Tell the owner.");

    const { file, name } = await attachmentFile(ctx, i.video);
    const p = await probe(ctx, file);
    const dir = mediaDir(ctx);

    ctx.emit({
      type: "agent.thinking",
      payload: { summary: `Analyzing "${name}" (${Math.round(p.duration)}s) for viral moments` },
    });

    const warnings: string[] = [];

    // 1. Get transcript (from cache or via video_transcribe tool)
    let transcript = await savedTranscript(ctx, i.video);
    if (!transcript && p.has_audio) {
      try {
        await videoTranscribeTool.execute({ video: i.video, language: "auto" }, ctx);
        transcript = await savedTranscript(ctx, i.video);
      } catch (err) {
        warnings.push(`video_transcribe failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 2. Get shot index (from cache or via video_index tool)
    let index = await savedShotIndex(ctx, i.video);
    if (!index && p.width > 0 && p.height > 0) {
      try {
        await videoIndexTool.execute({ video: i.video }, ctx);
        index = await savedShotIndex(ctx, i.video);
      } catch (err) {
        warnings.push(`video_index failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 3. Audio energy peak detection (ffmpeg ebur128)
    const audioPeaks: number[] = [];
    if (p.has_audio) {
      const ebur = await spawn([bin, "-hide_banner", "-nostdin", "-i", file, "-af", "ebur128", "-f", "null", "-"], dir, ctx.signal, undefined, 5 * 60_000);
      if (ebur.code === 0) {
        audioPeaks.push(...parseAudioEnergyPeaks(ebur.stderr, -20));
      } else {
        warnings.push(`ebur128 failed (exit ${ebur.code})`);
      }
    }

    if (!transcript && !(index?.shots?.length)) {
      throw new ToolDenied(
        `Cannot find clips without transcript or shot index.${warnings.length ? ` Reasons: ${warnings.join("; ")}` : ""}`,
      );
    }

    // 4. Generate candidate windows across the full length of the video
    const windows = findCandidateWindows({
      transcript,
      shots: index?.shots,
      duration: p.duration,
      minDuration: i.min_duration,
      maxDuration: i.max_duration,
      audioPeaks,
      prompt: i.prompt,
      maxCandidates: Math.max(i.max_clips * 2, 12),
    });

    // 5. Store candidates as unscored (no numeric fallback) until the model scores them via clip_score
    const clips: ClipCandidate[] = windows.map((win) => ({
      id: win.id,
      start: win.start,
      end: win.end,
      duration: win.duration,
      score: null,
      unscored: true,
      subscores: null,
      reasons: null,
      summary_reason: "Belum dinilai — jalankan clip_score untuk menilai transkrip ini.",
      transcript: win.transcript,
      headline: win.transcript.slice(0, 60).trim() || `Klip ${Math.round(win.start)}s-${Math.round(win.end)}s`,
      hooks: [],
      chosen_hook: "",
      source: win.source,
      audio_peak_at: win.audio_peak_at,
    }));

    // Save unscored candidate windows to the hub
    const attached = ctx.attachments[i.video - 1];
    if (attached) {
      await ctx.videoData("clips_put", { upload_id: attached.id, clips });
    }

    const shotCuts = (index?.shots ?? []).map((s) => Number(s.end.toFixed(2)));
    return {
      ok: true,
      summary: `Found ${clips.length} candidate windows for video ${i.video} (unscored — call clip_score next).`,
      output: {
        video: i.video,
        total_found: clips.length,
        scoring_prompt: CLIP_SCORE_PROMPT_V1,
        shot_cuts: shotCuts,
        audio_peaks: audioPeaks,
        ...(warnings.length ? { warnings } : {}),
        windows: windows.map((w) => ({
          id: w.id,
          start: w.start,
          end: w.end,
          duration: w.duration,
          source: w.source,
          audio_peak_at: w.audio_peak_at,
          transcript: w.transcript,
        })),
      },
    };
  },
});

// ---------------------------------------------------------------- clip_score tool

export const clipScoreTool = defineTool({
  name: "clip_score",
  description:
    "Store model-evaluated virality subscores, reasons, hooks, and headline for candidate clips returned by clip_find. " +
    "Computes the weighted virality score (0-99) and saves scored clips to the hub.",
  category: "write",
  input: z
    .object({
      video: z.number().int().min(1).max(10).default(1).describe("Which source video (1 = first)"),
      clips: z.array(ClipScoreItemSchema).min(1).max(20).optional().describe("Batch of scored clips"),
      id: z.string().min(1).optional().describe("Single clip window ID (if not passing clips array)"),
      subscores: ClipScoreItemSchema.shape.subscores.optional(),
      reasons: ClipScoreItemSchema.shape.reasons.optional(),
      hooks: ClipScoreItemSchema.shape.hooks.optional(),
      headline: ClipScoreItemSchema.shape.headline.optional(),
      summary_reason: ClipScoreItemSchema.shape.summary_reason.optional(),
      caption_post: ClipScoreItemSchema.shape.caption_post.optional(),
    })
    .refine(
      (v) =>
        (v.clips && v.clips.length > 0) ||
        (!!v.id && !!v.subscores && !!v.reasons && !!v.hooks?.length && !!v.headline && !!v.summary_reason),
      { message: "Provide either clips[] or single-clip { id, subscores, reasons, hooks, headline, summary_reason }" },
    ),
  risk: () => "safe",
  describe: (i) => `score ${i.clips?.length ?? 1} clip(s) for video ${i.video}`,
  async execute(i, ctx) {
    const attached = ctx.attachments[i.video - 1];
    if (!attached) throw new ToolDenied(`no video ${i.video} attached`);

    const items: ClipScoreItem[] = i.clips?.length
      ? i.clips
      : [
          ClipScoreItemSchema.parse({
            id: i.id,
            subscores: i.subscores,
            reasons: i.reasons,
            hooks: i.hooks,
            headline: i.headline,
            summary_reason: i.summary_reason,
            caption_post: i.caption_post,
          }),
        ];

    const existingRes = (await ctx.videoData("clips_get", { upload_id: attached.id })) as { clips?: ClipCandidate[] } | undefined;
    const existing = Array.isArray(existingRes?.clips) ? existingRes.clips : [];
    if (!existing.length) {
      throw new ToolDenied("No candidate clips found for this video. Run clip_find first.");
    }

    const byId = new Map<string, ClipScoreItem>();
    for (const item of items) byId.set(item.id, item);

    let scoredCount = 0;
    const updated: ClipCandidate[] = existing.map((clip) => {
      const s = byId.get(clip.id);
      if (!s) return clip;
      scoredCount++;
      const score = calculateViralityScore(s.subscores);
      return ClipCandidateSchema.parse({
        ...clip,
        score,
        unscored: false,
        subscores: s.subscores,
        reasons: s.reasons,
        summary_reason: s.summary_reason,
        headline: s.headline,
        hooks: s.hooks,
        chosen_hook: s.hooks[0] ?? s.headline,
        ...(s.caption_post ? { caption_post: s.caption_post } : {}),
      });
    });

    if (scoredCount === 0) {
      throw new ToolDenied(`None of the provided clip IDs matched existing candidates (${existing.map((c) => c.id).join(", ")}).`);
    }

    updated.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    await ctx.videoData("clips_put", { upload_id: attached.id, clips: updated });

    const topScores = updated
      .filter((c) => c.score !== null)
      .slice(0, 6)
      .map((c) => `${c.id}:${c.score}/99`)
      .join(", ");

    return {
      ok: true,
      summary: `Scored ${scoredCount} clip(s) for video ${i.video} (${topScores})`,
      output: {
        video: i.video,
        scored_count: scoredCount,
        clips: updated,
      },
    };
  },
});

// ---------------------------------------------------------------- clip_render tool

export const clipRenderTool = defineTool({
  name: "clip_render",
  description:
    "Render a chosen viral clip candidate into vertical 9:16 (TikTok FHD) with animated subtitles, vector emoji, and opening hook overlay. Optionally saves directly to drafts for owner review.",
  category: "write",
  input: z.object({
    video: z.number().int().min(1).max(10).describe("Which source video (1 = first)"),
    start: z.number().min(0).describe("Start seconds in source video"),
    end: z.number().positive().describe("End seconds in source video"),
    hook: z.string().trim().max(100).optional().describe("Hook overlay text shown in the first 2.5 seconds"),
    headline: z.string().trim().max(120).optional().describe("Video title / headline"),
    caption_preset: CaptionPresetSchema.default("pop"),
    reframe_mode: ReframeModeSchema.default("blur_fit"),
    save_draft: z.boolean().default(true).describe("Save as content draft for review"),
    project: z.string().max(64).optional().describe("Project slug or ID. Defaults to the job's project."),
    caption: z.string().min(1).max(20_000).optional().describe("Full post caption and hashtags written by the agent (required when save_draft is true)"),
    self_check: SelfCheck.optional().describe("Honest self-check against the project brief (required when save_draft is true)"),
  }),
  risk: () => "safe",
  describe: (i) => `render 9:16 clip (${i.start}s - ${i.end}s)`,
  async execute(i, ctx) {
    if (i.end <= i.start) throw new ToolDenied("clip ends before it starts");
    const targetProject = i.save_draft ? resolveProject(ctx, i.project) : null;
    if (i.save_draft) {
      if (!i.caption?.trim()) throw new ToolDenied("caption is required when save_draft is true (write the post body and hashtags yourself, matching the project brief)");
      if (!i.self_check) throw new ToolDenied("self_check is required when save_draft is true");
      validateDraftAgainstBrief(targetProject!, i.caption, i.self_check, "video");
    }
    const dur = round2(i.end - i.start);

    // Get transcript words for animated captions
    const transcript = await savedTranscript(ctx, i.video);
    const captions = transcript
      ? generateAnimatedCaptions(transcript.words, i.start, i.end, i.caption_preset)
      : [];

    const fitMode = i.reframe_mode === "crop_center" ? "crop" : "blur";
    const editPlanName = (i.headline || `clip_${Math.round(i.start)}_${Math.round(i.end)}`).slice(0, 40).replace(/[^\w.-]+/g, "_");
    const hookText = i.hook?.trim() ?? "";
    const hookCaption = hookText
      ? [
          {
            text: hookText,
            start: 0,
            end: Math.min(2.5, dur),
            position: "top" as const,
            animation: "pop" as const,
          },
        ]
      : [];

    // Call existing videoEditTool to render 9:16 vertical video
    const plan = EditPlan.parse({
      clips: [
        {
          video: i.video,
          start: i.start,
          end: i.end,
          fit: fitMode,
        },
      ],
      preset: "tiktok_fhd",
      fit: fitMode,
      captions: [
        ...hookCaption,
        ...captions.map((c) => ({
          text: c.text,
          start: c.start,
          end: c.end,
          position: "bottom" as const,
          animation: c.animation,
        })),
      ],
      normalize_audio: true,
      name: editPlanName,
    });
    const renderResult = await videoEditTool.execute(plan, ctx);

    const out = renderResult.output as { video_id: string; file: string; size_mb: number; seconds: number };

    let draftSaved = false;
    if (i.save_draft && targetProject && i.self_check && i.caption) {
      const ack = await ctx.saveDraft({
        project_id: targetProject.id,
        platform: "tiktok",
        kind: "video",
        title: i.headline || `Clip ${Math.round(i.start)}s-${Math.round(i.end)}s`,
        body: i.caption.trim(),
        self_check: i.self_check,
        meta: WebPost.parse({
          post_type: "social",
          video_upload_id: out.video_id,
        }),
      });
      if (ack && !ack.ok) {
        return {
          ok: false,
          summary: `Draft refused by hub: ${ack.error || "unknown error"}`,
          output: {
            video_id: out.video_id,
            duration: out.seconds,
            size_mb: out.size_mb,
            hook_on_screen: !!hookText,
            draft_saved: false,
            error: ack.error || "draft_refused",
          },
        };
      }
      draftSaved = true;
    }

    return {
      ok: true,
      summary: `Rendered 9:16 clip (${dur}s): ${out.file}`,
      output: {
        video_id: out.video_id,
        duration: out.seconds,
        size_mb: out.size_mb,
        hook_on_screen: !!hookText,
        draft_saved: draftSaved,
      },
    };
  },
});
