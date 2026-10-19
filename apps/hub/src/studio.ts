import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { EditPlan, RenderInfo, VIDEO_PRESETS, type Job } from "@agent-office/shared";
import type { Hub } from "./core.ts";
import { agents, contentDrafts, events, jobs, runs, uploads } from "./db/schema.ts";
import { HttpError, getRun } from "./repo.ts";
import { visibleAgents } from "./scope.ts";
import { toDraft } from "./content.ts";

/**
 * Video Studio (owner request): open a video, see how Editor made it (clips, captions, preset),
 * change it and render again WITHOUT the AI. A re-render is a `video_render` job that the runner
 * executes directly with the video_edit tool (no LLM, no tokens); when it is done the draft that
 * used the old video switches to the new one.
 */
export const VIDEO_RENDER_JOB = "video_render";

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
    return {
      upload: { id: up.id, name: up.name, content_type: up.content_type, size: up.size, run_id: up.run_id, created_at: up.created_at },
      render,
      /** true when we know exactly how it was made; false = a starting plan (whole video) for the owner's own clip */
      known: !!up.render || !!this.#renderFromEvents(up),
      drafts,
      presets: VIDEO_PRESETS,
      last_render_job: latest ? { id: latest.id, status: latest.status, created_at: latest.created_at, result_upload_id: this.#resultOf(latest.id) } : null,
    };
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

  /** The agent that renders: the one that made the video, else any enabled agent with video_edit (Editor first). */
  #editor(runId: string | null, ws: string) {
    const from = runId ? getRun(this.hub.db, runId)?.agent_id : null;
    const all = visibleAgents(this.hub.db, ws).filter((a) => a.enabled && a.tools.includes("video_edit"));
    const agent = all.find((a) => a.id === from) ?? all.find((a) => a.slug === "editor") ?? all[0];
    if (!agent) throw new HttpError(409, "no enabled agent has the video_edit tool (turn on Editor)");
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
