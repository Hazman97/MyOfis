import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { EditPlan, EditSuggestionsInput, RenderInfo, Transcript, VIDEO_PRESETS, type EditSuggestions, type Job, type TikTokHdMode } from "@agent-office/shared";
import type { Hub } from "./core.ts";
import { contentDrafts, editSuggestions, events, jobs, runs, uploads } from "./db/schema.ts";
import { HttpError, getRun, newId } from "./repo.ts";
import { visibleAgents } from "./scope.ts";
import { toDraft } from "./content.ts";

/**
 * Video Studio (owner request): open a video, see how Editor made it (clips, captions, preset),
 * change it and render again WITHOUT the AI. A re-render is a `video_render` job that the runner
 * executes directly with the video_edit tool (no LLM, no tokens); when it is done the draft that
 * used the old video switches to the new one.
 */
export const VIDEO_RENDER_JOB = "video_render";
export const VIDEO_TRANSCRIBE_JOB = "video_transcribe";
export const TIKTOK_HD_JOB = "tiktok_hd";

export class Studio {
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

  /** The TikTok HD page: recent jobs with their source, result video and what was done. */
  tiktokHdList(ws = "owner") {
    const rows = this.hub.db.select().from(jobs).where(and(eq(jobs.type, TIKTOK_HD_JOB), eq(jobs.workspace_id, ws))).orderBy(desc(jobs.created_at)).limit(30).all();
    return rows.map((j) => {
      const input = j.input as { source_upload_id?: string; mode?: string; attachments?: { name: string }[] };
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
      const result = this.#resultOf(j.id);
      const made = result ? this.hub.publisher.upload(result) : null;
      return {
        job_id: j.id,
        status: j.status,
        created_at: j.created_at,
        mode: input.mode ?? "auto",
        source: { id: input.source_upload_id ?? null, name: input.attachments?.[0]?.name ?? "" },
        result: made ? { id: made.id, name: made.name, size: made.size } : null,
        note: text.trim(),
        error: j.status === "failed" ? failed : null,
      };
    });
  }

  /** The video a render job made (newest), if it is done. */
  #resultOf(jobId: string): string | null {
    const runIds = this.hub.db.select({ id: runs.id }).from(runs).where(eq(runs.job_id, jobId)).all().map((r) => r.id);
    if (!runIds.length) return null;
    return this.hub.db.select({ id: uploads.id }).from(uploads).where(inArray(uploads.run_id, runIds)).orderBy(desc(uploads.created_at)).get()?.id ?? null;
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
