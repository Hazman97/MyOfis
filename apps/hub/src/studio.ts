import { join } from "node:path";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  CAPTION_MAX_CHARS,
  ClipCandidateSchema,
  EditPlan,
  EditSuggestionsInput,
  HD_TARGETS,
  RenderInfo,
  Transcript,
  VIDEO_PRESETS,
  VideoShotIndex,
  WebPost,
  checkTikTokOriginalFit,
  type ClipCandidate,
  type ContentDraft,
  type EditSuggestions,
  type HdOutputGroup,
  type HdTarget,
  type Job,
  type SocialPlacement,
  type TikTokHdMode,
} from "@agent-office/shared";
import { ffprobeBin, parseProbe } from "@agent-office/tools";
import { z } from "zod";
import type { Hub } from "./core.ts";
import { contentDrafts, editSuggestions, events, jobs, projects, runs, settings, uploads } from "./db/schema.ts";
import { HttpError, getRun, newId } from "./repo.ts";
import { visibleAgents } from "./scope.ts";
import { toDraft } from "./content.ts";

export const CAPTION_ONLY_JOB = "caption_only";

export const QuickPostInput = z.object({
  upload_id: z.string().min(1),
  accounts: z.array(z.string().min(1)).min(1).max(20),
  caption: z.string().max(CAPTION_MAX_CHARS.tiktok).default(""),
  compress: z.boolean().default(true),
  when: z.enum(["now", "schedule", "draft"]).default("now"),
  publish_at: z.string().nullable().optional(),
  project_id: z.string().nullable().optional(),
});
export type QuickPostRequest = z.infer<typeof QuickPostInput>;

/**
 * Video Studio (owner request): open a video, see how Editor made it (clips, captions, preset),
 * change it and render again WITHOUT the AI. A re-render is a `video_render` job that the runner
 * executes directly with the video_edit tool (no LLM, no tokens); when it is done the draft that
 * used the old video switches to the new one.
 */
export const VIDEO_RENDER_JOB = "video_render";
export const VIDEO_TRANSCRIBE_JOB = "video_transcribe";
export const TIKTOK_HD_JOB = "tiktok_hd";
export const VIDEO_HD_JOB = "video_hd";

export class Studio {
  /** Optional hooks registered by TelegramBot for `/post` HD and caption jobs. */
  onTelegramHdDone: ((job: { id: string; workspace_id: string; input: Record<string, unknown> }, uploadId: string) => void) | null = null;
  onTelegramCaptionDone: ((job: { id: string; workspace_id: string; input: Record<string, unknown> }, caption: string, error: string | null) => void) | null = null;

  constructor(private readonly hub: Hub) {}

  /** Everything the studio page needs about one video upload (of this workspace). */
  info(uploadId: string, ws = "owner") {
    const up = this.hub.publisher.upload(uploadId);
    if (!up || up.workspace_id !== ws || !up.content_type.startsWith("video/")) throw new HttpError(404, "video not found");
    const render = up.render ?? this.#renderFromEvents(up) ?? this.#fresh(up);
    const drafts = this.hub.db
      .select()
      .from(contentDrafts)
      .where(and(eq(contentDrafts.workspace_id, ws), sql`json_extract(${contentDrafts.meta}, '$.video_upload_id') = ${up.id}`))
      .orderBy(desc(contentDrafts.created_at))
      .all()
      .map(toDraft);
    const latest = this.hub.db.select().from(jobs).where(and(eq(jobs.type, VIDEO_RENDER_JOB), sql`json_extract(${jobs.input}, '$.source_upload_id') = ${up.id}`)).orderBy(desc(jobs.created_at)).get();
    const transcribing = this.hub.db.select().from(jobs).where(and(eq(jobs.type, VIDEO_TRANSCRIBE_JOB), sql`json_extract(${jobs.input}, '$.source_upload_id') = ${up.id}`)).orderBy(desc(jobs.created_at)).get();
    return {
      upload: { id: up.id, name: up.name, content_type: up.content_type, size: up.size, run_id: up.run_id, created_at: up.created_at },
      render,
      /** true when we know exactly how it was made; false = a starting plan (whole video) for the owner's own clip */
      known: !!up.render || !!this.#renderFromEvents(up),
      drafts,
      presets: VIDEO_PRESETS,
      last_render_job: latest ? { id: latest.id, status: latest.status, created_at: latest.created_at, result_upload_id: this.#resultOf(latest.id) } : null,
      transcripts: Object.fromEntries(render.attachments.map((a) => [a.id, this.transcript(a.id, ws)])),
      transcribe_job: transcribing ? { id: transcribing.id, status: transcribing.status } : null,
      suggestions: this.latestSuggestions(render.attachments.map((a) => a.id), ws),
      music_beats: render.plan.music?.track ? this.beats(render.plan.music.track, ws) : null,
    };
  }

  /** The room's videos, newest first (the Video Studio home). */
  list(ws = "owner") {
    return this.hub.db
      .select({ id: uploads.id, name: uploads.name, size: uploads.size, created_at: uploads.created_at, run_id: uploads.run_id, has_transcript: sql<number>`${uploads.transcript} is not null` })
      .from(uploads)
      .where(and(eq(uploads.workspace_id, ws), sql`${uploads.content_type} like 'video/%'`))
      .orderBy(desc(uploads.created_at))
      .limit(60)
      .all()
      .map((v) => ({ ...v, has_transcript: !!v.has_transcript }));
  }

  /** "Transcribe": whisper on the runner PC for the video's source files (no AI). Returns the job. */
  transcribe(uploadId: string, ws = "owner"): Job {
    const info = this.info(uploadId, ws);
    const files = info.render.attachments.filter((a) => a.content_type.startsWith("video/"));
    if (!files.length) throw new HttpError(400, "this video has no source video to transcribe");
    const agent = this.#editor(info.upload.run_id, ws, "video_transcribe");
    return this.hub.createJob(
      {
        agent_id: agent.id,
        project_id: null,
        type: VIDEO_TRANSCRIBE_JOB,
        title: `Transcribe: ${info.upload.name}`.slice(0, 200),
        input: { text: `Transcribe "${info.upload.name}" for the Video Studio`, attachments: files, source_upload_id: info.upload.id },
        trigger: "manual",
      },
      ws,
    );
  }

  transcript(uploadId: string, ws = "owner"): Transcript | null {
    const row = this.hub.db.select({ t: uploads.transcript, ws: uploads.workspace_id }).from(uploads).where(eq(uploads.id, uploadId)).get();
    return row && row.ws === ws ? (row.t ?? null) : null;
  }

  setTranscript(uploadId: string, t: Transcript): void {
    this.hub.db.update(uploads).set({ transcript: Transcript.parse(t) }).where(eq(uploads.id, uploadId)).run();
  }

  shotIndex(uploadId: string, ws = "owner"): VideoShotIndex | null {
    const row = this.hub.db.select({ ws: uploads.workspace_id }).from(uploads).where(eq(uploads.id, uploadId)).get();
    if (!row || row.ws !== ws) return null;
    const raw = this.hub.db.select({ value: settings.value }).from(settings).where(eq(settings.key, `video.index.${uploadId}`)).get()?.value;
    if (!raw) return null;
    const parsed = VideoShotIndex.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  setShotIndex(uploadId: string, idx: VideoShotIndex): void {
    const value = VideoShotIndex.parse(idx);
    const key = `video.index.${uploadId}`;
    this.hub.db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
  }

  clipResults(uploadId: string, ws = "owner"): ClipCandidate[] | null {
    const row = this.hub.db.select({ ws: uploads.workspace_id }).from(uploads).where(eq(uploads.id, uploadId)).get();
    if (!row || row.ws !== ws) return null;
    const raw = this.hub.db.select({ value: settings.value }).from(settings).where(eq(settings.key, `video.clips.${uploadId}`)).get()?.value;
    if (!raw) return null;
    const parsed = z.array(ClipCandidateSchema).safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  setClipResults(uploadId: string, clips: ClipCandidate[]): void {
    const value = z.array(ClipCandidateSchema).parse(clips);
    const key = `video.clips.${uploadId}`;
    this.hub.db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
  }

  beats(
    track: string,
    ws = "owner",
    meta?: { size?: number; mtime_ms?: number },
  ): { bpm: number; beats: number[]; bars: number[]; confidence: number } | null {
    const safe = track.trim();
    if (!safe) return null;
    const raw = this.hub.db.select({ value: settings.value }).from(settings).where(eq(settings.key, `music.beats.${ws}.${safe}`)).get()?.value as
      | ({ bpm: number; beats: number[]; bars: number[]; confidence: number; size?: number; mtime_ms?: number } | undefined);
    if (!raw) return null;
    // Treat file size / mtime mismatch as a cache miss so replaced tracks never serve stale beat ticks
    if (meta?.size !== undefined && raw.size !== undefined && raw.size !== meta.size) return null;
    if (meta?.mtime_ms !== undefined && raw.mtime_ms !== undefined && Math.round(raw.mtime_ms) !== Math.round(meta.mtime_ms)) return null;
    return { bpm: raw.bpm, beats: raw.beats, bars: raw.bars, confidence: raw.confidence };
  }

  setBeats(
    track: string,
    data: { bpm: number; beats: number[]; bars: number[]; confidence: number },
    ws = "owner",
    meta?: { size?: number; mtime_ms?: number },
  ): void {
    const safe = track.trim();
    if (!safe) return;
    const value = {
      ...data,
      ...(meta?.size !== undefined ? { size: meta.size } : {}),
      ...(meta?.mtime_ms !== undefined ? { mtime_ms: Math.round(meta.mtime_ms) } : {}),
    };
    this.hub.db
      .insert(settings)
      .values({ key: `music.beats.${ws}.${safe}`, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
  }

  saveSuggestions(runId: string, ws: string, attachments: EditSuggestions["attachments"], data: unknown): EditSuggestions {
    const parsed = EditSuggestionsInput.parse(data);
    const row = this.hub.db.insert(editSuggestions).values({ id: newId("sug"), workspace_id: ws, run_id: runId, attachments, data: parsed }).returning().get();
    return this.#toSuggestions(row);
  }

  /** The newest options for a run (the chat shows them under that reply). */
  suggestionsForRuns(runIds: string[]): EditSuggestions | null {
    if (!runIds.length) return null;
    const row = this.hub.db.select().from(editSuggestions).where(inArray(editSuggestions.run_id, runIds)).orderBy(desc(editSuggestions.created_at)).get();
    return row ? this.#toSuggestions(row) : null;
  }

  /** The newest options that use any of these source videos (the studio shows them). */
  latestSuggestions(uploadIds: string[], ws: string): EditSuggestions | null {
    if (!uploadIds.length) return null;
    const ids = sql.join(uploadIds.map((id) => sql`${id}`), sql`, `);
    const row = this.hub.db
      .select()
      .from(editSuggestions)
      .where(and(eq(editSuggestions.workspace_id, ws), sql`exists (select 1 from json_each(${editSuggestions.attachments}) where json_extract(value, '$.id') in (${ids}))`))
      .orderBy(desc(editSuggestions.created_at))
      .get();
    return row ? this.#toSuggestions(row) : null;
  }

  #toSuggestions(r: typeof editSuggestions.$inferSelect): EditSuggestions {
    return { id: r.id, run_id: r.run_id, attachments: r.attachments, created_at: r.created_at, ...r.data };
  }

  /** Queue a re-render with the owner's plan. Returns the job. */
  render(uploadId: string, input: { plan: unknown; draft_id?: string | null }, ws = "owner"): Job {
    const info = this.info(uploadId, ws);
    const plan = EditPlan.parse(input.plan);
    const files = info.render.attachments;
    for (const [i, c] of plan.clips.entries()) {
      const f = files[c.video - 1];
      if (!f?.content_type.startsWith("video/")) throw new HttpError(400, `clip ${i + 1}: file ${c.video} is not one of this video's source clips`);
      if (c.end !== undefined && c.end <= c.start) throw new HttpError(400, `clip ${i + 1}: end must be after start`);
    }
    for (const cap of plan.captions) if (cap.end <= cap.start) throw new HttpError(400, `caption "${cap.text.slice(0, 30)}": end must be after start`);
    const draft = input.draft_id ? info.drafts.find((d) => d.id === input.draft_id) : null;
    if (input.draft_id && !draft) throw new HttpError(400, "that draft does not use this video");
    const agent = this.#editor(info.upload.run_id, ws);
    return this.hub.createJob(
      {
      agent_id: agent.id,
      project_id: draft?.project_id ?? null,
      type: VIDEO_RENDER_JOB,
      title: `Render again: ${plan.name} (${plan.preset})`,
      input: { text: `Render "${plan.name}" again from the Video Studio`, plan, attachments: files, draft_id: draft?.id ?? null, source_upload_id: info.upload.id },
      trigger: "manual",
      },
      ws,
    );
  }

  /** "Video HD": remux or re-encode a finished video for one or more targets (no AI). Returns created jobs. */
  videoHd(uploadId: string, targets: (HdTarget | HdOutputGroup)[], mode: TikTokHdMode, ws = "owner"): Job[] {
    const up = this.hub.publisher.upload(uploadId);
    if (!up || up.workspace_id !== ws || !up.content_type.startsWith("video/")) throw new HttpError(404, "video not found");
    const agent = this.#editor(null, ws, "video_hd");
    const byTarget = new Map<HdTarget, SocialPlacement[]>();
    for (const item of targets) {
      const target = typeof item === "string" ? item : item.target;
      const covers = typeof item === "string" ? [] : item.covers;
      const existing = byTarget.get(target);
      if (existing) {
        for (const c of covers) if (!existing.includes(c)) existing.push(c);
      } else {
        byTarget.set(target, [...covers]);
      }
    }
    return [...byTarget.entries()].map(([target, covers]) => {
      const label = HD_TARGETS[target].label;
      return this.hub.createJob(
        {
          agent_id: agent.id,
          project_id: null,
          type: VIDEO_HD_JOB,
          title: `${label}: ${up.name}`.slice(0, 200),
          input: {
            text: `Prepare "${up.name}" for ${label}`,
            attachments: [{ id: up.id, name: up.name, content_type: up.content_type }],
            source_upload_id: up.id,
            target,
            ...(covers.length ? { covers } : {}),
            mode,
          },
          trigger: "manual",
        },
        ws,
      );
    });
  }

  /** "TikTok HD": remux or re-encode a finished video for TikTok on the runner PC (no AI). Returns the job. */
  tiktokHd(uploadId: string, mode: TikTokHdMode, ws = "owner"): Job {
    const up = this.hub.publisher.upload(uploadId);
    if (!up || up.workspace_id !== ws || !up.content_type.startsWith("video/")) throw new HttpError(404, "video not found");
    const agent = this.#editor(null, ws, "video_tiktok_hd");
    return this.hub.createJob(
      {
        agent_id: agent.id,
        project_id: null,
        type: TIKTOK_HD_JOB,
        title: `TikTok HD: ${up.name}`.slice(0, 200),
        input: { text: `Prepare "${up.name}" for TikTok in HD`, attachments: [{ id: up.id, name: up.name, content_type: up.content_type }], source_upload_id: up.id, mode },
        trigger: "manual",
      },
      ws,
    );
  }

  /** The Video HD page: recent `video_hd` and legacy `tiktok_hd` jobs with their target, source, result, and note. */
  videoHdList(ws = "owner") {
    const rows = this.hub.db
      .select()
      .from(jobs)
      .where(and(inArray(jobs.type, [VIDEO_HD_JOB, TIKTOK_HD_JOB]), eq(jobs.workspace_id, ws)))
      .orderBy(desc(jobs.created_at))
      .limit(60)
      .all();
    return rows.map((j) => {
      const input = j.input as { source_upload_id?: string; target?: HdTarget; covers?: SocialPlacement[]; mode?: string; attachments?: { name: string }[] };
      const runIds = this.hub.db.select({ id: runs.id }).from(runs).where(eq(runs.job_id, j.id)).all().map((r) => r.id);
      const evs = runIds.length
        ? this.hub.db
            .select({ type: events.type, payload: events.payload })
            .from(events)
            .where(and(inArray(events.run_id, runIds), inArray(events.type, ["agent.message", "run.failed"])))
            .orderBy(events.id)
            .all()
        : [];
      const text = evs.map((e) => (e.type === "agent.message" ? String((e.payload as { text?: string }).text ?? "") : "")).join("");
      const failed = evs.filter((e) => e.type === "run.failed").map((e) => String((e.payload as { error?: string }).error ?? "")).pop() ?? null;
      const resultIds = this.#resultsOf(j.id);
      const results = resultIds
        .map((rid) => this.hub.publisher.upload(rid))
        .filter((u): u is NonNullable<typeof u> => !!u)
        .map((u) => ({ id: u.id, name: u.name, size: u.size }));
      const made = results[0] ?? null;
      return {
        job_id: j.id,
        status: j.status,
        created_at: j.created_at,
        target: input.target ?? ("tiktok" as HdTarget),
        covers: input.covers ?? [],
        mode: input.mode ?? "auto",
        source: { id: input.source_upload_id ?? null, name: input.attachments?.[0]?.name ?? "" },
        result: made,
        results,
        note: text.trim(),
        error: j.status === "failed" ? failed : j.status === "cancelled" ? this.#cancelReason(j.id) : null,
      };
    });
  }

  /** Legacy alias for TikTok HD list. */
  tiktokHdList(ws = "owner") {
    return this.videoHdList(ws);
  }

  /** Why a job was stopped (time limit, the owner, pause), from its job.cancelled event. */
  #cancelReason(jobId: string): string | null {
    const e = this.hub.db
      .select({ payload: events.payload })
      .from(events)
      .where(and(eq(events.type, "job.cancelled"), sql`json_extract(${events.payload}, '$.job_id') = ${jobId}`))
      .orderBy(desc(events.id))
      .get();
    return (e?.payload as { reason?: string } | undefined)?.reason ?? "stopped";
  }

  /** The video a render job made (newest), if it is done. */
  #resultOf(jobId: string): string | null {
    const runIds = this.hub.db.select({ id: runs.id }).from(runs).where(eq(runs.job_id, jobId)).all().map((r) => r.id);
    if (!runIds.length) return null;
    return this.hub.db.select({ id: uploads.id }).from(uploads).where(inArray(uploads.run_id, runIds)).orderBy(desc(uploads.created_at)).get()?.id ?? null;
  }

  /** All videos a render job made (oldest first, so Story parts stay in order 1..N). */
  #resultsOf(jobId: string): string[] {
    const runIds = this.hub.db.select({ id: runs.id }).from(runs).where(eq(runs.job_id, jobId)).all().map((r) => r.id);
    if (!runIds.length) return [];
    return this.hub.db.select({ id: uploads.id }).from(uploads).where(inArray(uploads.run_id, runIds)).orderBy(uploads.created_at, uploads.id).all().map((u) => u.id);
  }

  /** A video_render run finished: point the draft at the new video. */
  afterRender(runId: string, job: { input: Record<string, unknown> }): void {
    const draftId = job.input.draft_id;
    const made = this.hub.db.select().from(uploads).where(eq(uploads.run_id, runId)).orderBy(desc(uploads.created_at)).get();
    if (!made || typeof draftId !== "string") return;
    try {
      this.hub.content.setDraftVideo(draftId, made.id);
    } catch (err) {
      // decided meanwhile: the new video stays in the studio, the draft keeps its old one
      console.error(`[studio] draft ${draftId} not updated: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------- Quick Post (Task 047)

  async #probeLocalVideo(pathOnDisk: string): Promise<{ codec: string; duration: number }> {
    const bin = ffprobeBin();
    if (!bin) throw new HttpError(400, "ffprobe tiada pada pelayan; aktifkan Compress untuk semak & tukar video");
    const proc = Bun.spawn(
      [bin, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", pathOnDisk],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) throw new HttpError(400, `ffprobe gagal membaca video: ${err.trim().slice(0, 160) || `exit ${code}`}`);
    try {
      const probe = parseProbe(JSON.parse(out));
      return { codec: probe.video_codec, duration: probe.duration };
    } catch (e) {
      throw new HttpError(400, `Fail video tidak sah: ${(e as Error).message}`);
    }
  }

  #pickQuickPostProject(ws: string, accountId: string, explicitProjectId?: string | null): string {
    const all = this.hub.db.select().from(projects).where(eq(projects.workspace_id, ws)).all();
    if (explicitProjectId) {
      const hit = all.find((p) => p.id === explicitProjectId);
      if (!hit) throw new HttpError(404, "project not found");
      return hit.id;
    }
    for (const p of all) {
      if (this.hub.social.projectAccounts(p.id).tiktok === accountId) return p.id;
    }
    const first = all.find((p) => p.enabled) ?? all[0];
    if (!first) throw new HttpError(400, "cipta sekurang-kurangnya satu projek dahulu sebelum Quick Post");
    return first.id;
  }

  #pickQuickPostAgent(ws: string): string {
    const all = visibleAgents(this.hub.db, ws);
    const pick =
      all.find((a) => a.slug === "tiktok-poster" && a.enabled) ??
      all.find((a) => a.slug === "social-manager" && a.enabled) ??
      all.find((a) => a.slug === "editor" && a.enabled) ??
      all.find((a) => a.enabled) ??
      all[0];
    if (!pick) throw new HttpError(409, "tiada ejen tersedia dalam ruang ini");
    return pick.id;
  }

  #validateScheduleTime(publishAt: string): string {
    const t = Date.parse(publishAt);
    if (Number.isNaN(t)) throw new HttpError(400, "masa jadual tidak sah");
    if (t < Date.now() + 60_000) throw new HttpError(400, "masa jadual mesti sekurang-kurangnya 1 minit dari sekarang");
    if (t > Date.now() + 60 * 86_400_000) throw new HttpError(400, "masa jadual mesti dalam tempoh 60 hari");
    return new Date(t).toISOString();
  }

  #createQuickPostDrafts(
    ws: string,
    videoUploadId: string,
    data: Pick<QuickPostRequest, "accounts" | "caption" | "when" | "publish_at" | "project_id">,
    runId: string | null,
  ): ContentDraft[] {
    const up = this.hub.publisher.upload(videoUploadId);
    const agentId = this.#pickQuickPostAgent(ws);
    const title = (data.caption.split(/\r?\n/)[0] || up?.name || "Quick Post").trim().slice(0, 120);
    const body = data.caption.trim() || title;
    const out: ContentDraft[] = [];

    for (const accId of data.accounts) {
      const projectId = this.#pickQuickPostProject(ws, accId, data.project_id);
      const row = this.hub.store.transact((tx, emit) =>
        this.hub.content.insertDraft(tx, emit, {
          project_id: projectId,
          agent_id: agentId,
          run_id: runId ?? "",
          platform: "tiktok",
          kind: "video",
          title,
          body,
          self_check: {
            facts_match_brief: true,
            only_released_features: true,
            no_overclaims: true,
            tone_and_language_match: true,
            notes: "Quick Post (owner)",
          },
          feature_id: null,
          meta: WebPost.parse({
            post_type: "social",
            video_upload_id: videoUploadId,
            social_account: accId,
            placement: "tiktok",
            source: "owner",
          }),
        }),
      );
      let draft = toDraft(row);
      if (data.when === "now") {
        draft = this.hub.content.decideDraft(draft.id, { decision: "approve" });
        void this.hub.afterApprove(draft).catch((err) => console.error(`[quick-post] posting ${draft.id} failed: ${(err as Error).message}`));
      } else if (data.when === "schedule" && data.publish_at) {
        draft = this.hub.content.decideDraft(draft.id, { decision: "approve", publish_at: data.publish_at });
      }
      out.push(draft);
    }
    return out;
  }

  /** Create a pending owner-authored TikTok video draft (used by Telegram /post after HD). */
  createOwnerDraft(ws: string, videoUploadId: string, accountId: string, caption: string, runId: string | null = null): ContentDraft {
    return this.#createQuickPostDrafts(
      ws,
      videoUploadId,
      { accounts: [accountId], caption, when: "draft", publish_at: null, project_id: null },
      runId,
    )[0]!;
  }

  /**
   * Quick Post (Part C): upload/recent video -> optional TikTok HD compress -> 1 video draft per account -> now / schedule / draft.
   */
  async quickPost(
    input: z.input<typeof QuickPostInput>,
    ws = "owner",
  ): Promise<{ job_id?: string; drafts?: ContentDraft[]; posting?: boolean }> {
    const data = QuickPostInput.parse(input);
    const up = this.hub.publisher.upload(data.upload_id);
    if (!up || up.workspace_id !== ws || !up.content_type.startsWith("video/")) {
      throw new HttpError(404, "video not found");
    }
    const targets = this.hub.social.tiktokTargets(ws);
    const validIds = new Set(targets.map((t) => t.id));
    for (const acc of data.accounts) {
      if (!validIds.has(acc)) throw new HttpError(400, `akaun TikTok "${acc}" tidak disambung atau dimatikan`);
    }
    let publishAt: string | null = null;
    if (data.when === "schedule") {
      if (!data.publish_at) throw new HttpError(400, "pilih tarikh dan masa jadual dahulu");
      publishAt = this.#validateScheduleTime(data.publish_at);
    }
    // Validate project & agent exist before doing work
    this.#pickQuickPostProject(ws, data.accounts[0]!, data.project_id);
    this.#pickQuickPostAgent(ws);

    if (!data.compress) {
      const fullPath = join(this.hub.config.filesDir, up.path);
      const probed = await this.#probeLocalVideo(fullPath);
      const fit = checkTikTokOriginalFit({ codec: probed.codec, duration_s: probed.duration, size_bytes: up.size });
      if (!fit.ok) {
        throw new HttpError(400, `Fail asal tidak sesuai untuk TikTok: ${fit.reasons.join(" ")}`);
      }
      const drafts = this.#createQuickPostDrafts(ws, up.id, { ...data, publish_at: publishAt }, null);
      return { drafts, posting: data.when === "now" };
    }

    const agent = this.#editor(null, ws, "video_hd");
    const job = this.hub.createJob(
      {
        agent_id: agent.id,
        project_id: data.project_id ?? null,
        type: VIDEO_HD_JOB,
        title: `Quick Post HD: ${up.name}`.slice(0, 200),
        input: {
          text: `Prepare "${up.name}" for TikTok HD (Quick Post)`,
          attachments: [{ id: up.id, name: up.name, content_type: up.content_type }],
          source_upload_id: up.id,
          target: "tiktok",
          mode: "auto",
          quick_post: {
            accounts: data.accounts,
            caption: data.caption,
            when: data.when,
            publish_at: publishAt,
            project_id: data.project_id ?? null,
          },
        },
        trigger: "manual",
      },
      ws,
    );
    return { job_id: job.id };
  }

  /** Called by Hub.#afterRun when a video_hd / tiktok_hd run finishes. */
  afterHd(runId: string, job: { id: string; workspace_id: string; input: Record<string, unknown> }): void {
    const made = this.hub.db.select().from(uploads).where(eq(uploads.run_id, runId)).orderBy(desc(uploads.created_at)).get();
    if (!made) return;

    const qp = job.input.quick_post as
      | { accounts?: string[]; caption?: string; when?: "now" | "schedule" | "draft"; publish_at?: string | null; project_id?: string | null }
      | undefined;
    if (qp && Array.isArray(qp.accounts) && qp.accounts.length > 0) {
      try {
        const drafts = this.#createQuickPostDrafts(
          job.workspace_id,
          made.id,
          {
            accounts: qp.accounts,
            caption: qp.caption ?? "",
            when: qp.when ?? "now",
            publish_at: qp.publish_at ?? null,
            project_id: qp.project_id ?? null,
          },
          runId,
        );
        const k = `quickpost.job.${job.id}`;
        this.hub.db
          .insert(settings)
          .values({ key: k, value: { draft_ids: drafts.map((d) => d.id), upload_id: made.id } })
          .onConflictDoUpdate({ target: settings.key, set: { value: { draft_ids: drafts.map((d) => d.id), upload_id: made.id } } })
          .run();
      } catch (err) {
        console.error(`[studio] afterHd quick_post for ${job.id} failed: ${(err as Error).message}`);
      }
    }

    if (job.input.telegram_post) {
      try {
        this.onTelegramHdDone?.(job, made.id);
      } catch (err) {
        console.error(`[studio] onTelegramHdDone for ${job.id} failed: ${(err as Error).message}`);
      }
    }
  }

  /** Status of a Quick Post HD job and any drafts created when it finished. */
  quickPostStatus(jobId: string, ws = "owner") {
    const job = this.hub.db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.workspace_id, ws))).get();
    if (!job) throw new HttpError(404, "job not found");
    const rec = this.hub.db.select().from(settings).where(eq(settings.key, `quickpost.job.${job.id}`)).get()?.value as
      | { draft_ids?: string[]; upload_id?: string }
      | undefined;
    const drafts = (rec?.draft_ids ?? [])
      .map((id) => this.hub.content.draft(id))
      .filter((d): d is ContentDraft => !!d);
    const runIds = this.hub.db.select({ id: runs.id }).from(runs).where(eq(runs.job_id, job.id)).all().map((r) => r.id);
    const failed = runIds.length
      ? this.hub.db
          .select({ payload: events.payload })
          .from(events)
          .where(and(inArray(events.run_id, runIds), eq(events.type, "run.failed")))
          .orderBy(desc(events.id))
          .get()
      : undefined;
    return {
      job_id: job.id,
      status: job.status,
      upload_id: rec?.upload_id ?? null,
      drafts,
      error: job.status === "failed" ? String((failed?.payload as { error?: string } | undefined)?.error ?? "gagal") : null,
    };
  }

  /** Start a chat-less `caption_only` job on `tiktok-poster` that returns only caption text (never calls save_draft). */
  captionOnly(uploadId: string, notes = "", ws = "owner", extraInput: Record<string, unknown> = {}): Job {
    const up = this.hub.publisher.upload(uploadId);
    if (!up || up.workspace_id !== ws || !up.content_type.startsWith("video/")) {
      throw new HttpError(404, "video not found");
    }
    const agentId = this.#pickQuickPostAgent(ws);
    return this.hub.createJob(
      {
        agent_id: agentId,
        project_id: null,
        type: CAPTION_ONLY_JOB,
        title: `Caption: ${up.name}`.slice(0, 200),
        input: {
          text: `Write a TikTok caption for video "${up.name}".${notes.trim() ? `\nOwner notes: ${notes.trim()}` : ""}`,
          upload_id: up.id,
          notes: notes.trim(),
          attachments: [{ id: up.id, name: up.name, content_type: up.content_type }],
          ...extraInput,
        },
        trigger: "manual",
      },
      ws,
    );
  }

  /** Called by Hub.#afterRun when a `caption_only` run finishes. */
  afterCaption(runId: string, job: { id: string; workspace_id: string; input: Record<string, unknown> }, status: string, error?: string): void {
    if (!job.input.telegram_post) return;
    const text = (this.hub.store.state.runs[runId]?.output ?? "").trim();
    this.onTelegramCaptionDone?.(job, text, status === "done" ? null : (error ?? status));
  }

  /** Read the generated caption text for a `caption_only` job. */
  captionStatus(jobId: string, ws = "owner") {
    const job = this.hub.db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.workspace_id, ws))).get();
    if (!job) throw new HttpError(404, "job not found");
    const runIds = this.hub.db.select({ id: runs.id }).from(runs).where(eq(runs.job_id, job.id)).all().map((r) => r.id);
    const evs = runIds.length
      ? this.hub.db
          .select({ type: events.type, payload: events.payload })
          .from(events)
          .where(and(inArray(events.run_id, runIds), inArray(events.type, ["agent.message", "run.failed"])))
          .orderBy(events.id)
          .all()
      : [];
    const caption = evs
      .filter((e) => e.type === "agent.message")
      .map((e) => String((e.payload as { text?: string }).text ?? ""))
      .join("")
      .trim()
      .slice(0, CAPTION_MAX_CHARS.tiktok);
    const err = evs
      .filter((e) => e.type === "run.failed")
      .map((e) => String((e.payload as { error?: string }).error ?? ""))
      .pop() ?? null;
    return { job_id: job.id, status: job.status, caption, error: job.status === "failed" ? err : null };
  }

  /** The agent that runs it: the one that made the video, else any enabled agent with the tool (Editor first). */
  #editor(runId: string | null, ws: string, tool = "video_edit") {
    const from = runId ? getRun(this.hub.db, runId)?.agent_id : null;
    const all = visibleAgents(this.hub.db, ws).filter((a) => a.enabled && a.tools.includes(tool));
    const agent = all.find((a) => a.id === from) ?? all.find((a) => a.slug === "editor") ?? all[0];
    if (!agent) throw new HttpError(409, `no enabled agent has the ${tool} tool (turn on Editor and give it ${tool})`);
    return agent;
  }

  /** Renders made before uploads.render existed: rebuild the plan from the run's video_edit tool call. */
  #renderFromEvents(up: { name: string; run_id: string | null }): RenderInfo | null {
    if (!up.run_id) return null;
    const run = getRun(this.hub.db, up.run_id);
    const job = run ? this.hub.db.select().from(jobs).where(eq(jobs.id, run.job_id)).get() : undefined;
    const calls = this.hub.db
      .select({ payload: events.payload })
      .from(events)
      .where(and(eq(events.run_id, up.run_id), eq(events.type, "agent.tool_call")))
      .all()
      .map((e) => e.payload as { tool?: string; args?: Record<string, unknown> })
      .filter((p) => p.tool === "video_edit" && p.args);
    for (const c of calls.reverse()) {
      const plan = EditPlan.safeParse(c.args);
      if (!plan.success) continue;
      if (`${plan.data.name.replace(/\s+/g, "_")}-${plan.data.preset}.mp4` !== up.name) continue;
      const parsed = RenderInfo.safeParse({ plan: plan.data, attachments: Array.isArray(job?.input.attachments) ? job.input.attachments : [] });
      if (parsed.success) return parsed.data;
    }
    return null;
  }

  /** The owner's own clip, never edited: start from the whole video in TikTok FHD. */
  #fresh(up: { id: string; name: string; content_type: string }): RenderInfo {
    return { plan: EditPlan.parse({ clips: [{ video: 1 }], name: up.name.replace(/\.[^.]+$/, "").replace(/[^\w\- ]+/g, "_").slice(0, 60) || "edit" }), attachments: [{ id: up.id, name: up.name, content_type: up.content_type }] };
  }
}
