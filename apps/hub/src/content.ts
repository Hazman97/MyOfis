import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  ProjectBrief,
  TIMEZONE,
  WebPost,
  type ContentDraft,
  type DraftDecision,
  type FeatureNote,
  type FeatureNoteInput,
  type ProjectContext,
  type SelfCheck,
} from "@agent-office/shared";
import type { Db } from "./db/client.ts";
import { contentDrafts, featureLog, projects, uploads } from "./db/schema.ts";
import type { Emit, EventStore } from "./events.ts";
import { HttpError, newId } from "./repo.ts";

type ProjectRow = typeof projects.$inferSelect;
type DraftRow = typeof contentDrafts.$inferSelect;
type FeatureRow = typeof featureLog.$inferSelect;

const PAST_DRAFTS_IN_CONTEXT = 12;
const FEATURES_IN_CONTEXT = 15;

export const toDraft = (r: DraftRow): ContentDraft => ({
  id: r.id,
  project_id: r.project_id,
  agent_id: r.agent_id,
  run_id: r.run_id,
  feature_id: r.feature_id,
  platform: r.platform as ContentDraft["platform"],
  kind: r.kind as ContentDraft["kind"],
  title: r.title,
  body: r.body,
  status: r.status,
  self_check: (r.self_check as SelfCheck | null) ?? null,
  owner_feedback: r.owner_feedback,
  original_body: r.original_body,
  created_at: r.created_at,
  decided_at: r.decided_at,
  meta: r.meta ?? null,
  published_url: r.published_url,
  publish_error: r.publish_error,
});

export const toFeature = (r: FeatureRow): FeatureNote => ({
  id: r.id,
  project_id: r.project_id,
  title: r.title,
  user_facing_note: r.user_facing_note,
  source_pr_url: r.source_pr_url,
  released_at: r.released_at,
  screenshot_path: r.screenshot_path,
  announced: r.announced,
});

const BRIEF_HEADER = "# Project brief for Agent Office (spec §9). Marketing reads ONLY this, the feature log and past drafts.\n";

/**
 * Project briefs (projects/<slug>/brief.yaml), the feature log
 * (feature_log + projects/<slug>/FEATURES.md) and content drafts.
 */
export class Content {
  constructor(
    private readonly db: Db,
    private readonly store: EventStore,
    readonly projectsDir: string,
  ) {}

  project(id: string): ProjectRow {
    const p = this.db.select().from(projects).where(eq(projects.id, id)).get();
    if (!p) throw new HttpError(404, "project not found");
    return p;
  }

  #dir(slug: string) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new HttpError(400, "invalid project slug");
    return join(this.projectsDir, slug);
  }

  // ---------------------------------------------------------------- briefs

  /** null when the project has no brief yet. Throws 409 when the file exists but is invalid (owner edited it by hand). */
  readBrief(p: ProjectRow): ProjectBrief | null {
    const file = join(this.#dir(p.slug), "brief.yaml");
    if (!existsSync(file)) return null;
    let raw: unknown;
    try {
      raw = parseYaml(readFileSync(file, "utf8"));
    } catch (err) {
      throw new HttpError(409, `brief.yaml is not valid YAML: ${(err as Error).message}`);
    }
    const parsed = ProjectBrief.safeParse(raw);
    if (!parsed.success) throw new HttpError(409, `brief.yaml does not match the brief format: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    return parsed.data;
  }

  /** Brief for agents: an invalid file counts as missing (logged) rather than failing the run. */
  #briefForAgents(p: ProjectRow): ProjectBrief | null {
    try {
      return this.readBrief(p);
    } catch (err) {
      console.error(`[hub] brief for ${p.slug} skipped: ${(err as Error).message}`);
      return null;
    }
  }

  writeBrief(p: ProjectRow, input: unknown): ProjectBrief {
    const brief = ProjectBrief.parse(input);
    const dir = this.#dir(p.slug);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "brief.yaml");
    // write-then-rename so a crash never leaves half a brief
    writeFileSync(`${file}.tmp`, BRIEF_HEADER + stringifyYaml(brief, { lineWidth: 0 }));
    renameSync(`${file}.tmp`, file);
    const rel = `projects/${p.slug}/brief.yaml`;
    if (p.brief_path !== rel) this.db.update(projects).set({ brief_path: rel }).where(eq(projects.id, p.id)).run();
    return brief;
  }

  // ---------------------------------------------------------------- feature log

  features(projectId: string): FeatureNote[] {
    return this.db.select().from(featureLog).where(eq(featureLog.project_id, projectId)).orderBy(desc(featureLog.released_at)).all().map(toFeature);
  }

  /** Insert a feature note and emit feature.released, inside the caller's transaction. Writes FEATURES.md after commit via `appendFeaturesMd`. */
  insertFeature(tx: Db, emit: Emit, projectId: string, note: FeatureNoteInput & { title: string; user_facing_note: string }, meta: { run_id?: string | null; agent_id?: string | null } = {}): FeatureRow {
    const row = tx
      .insert(featureLog)
      .values({ id: newId("fea"), project_id: projectId, title: note.title, user_facing_note: note.user_facing_note, source_pr_url: note.source_pr_url ?? null })
      .returning()
      .get();
    emit({ type: "feature.released", payload: { project_id: projectId, feature_log_id: row.id } }, meta);
    return row;
  }

  appendFeaturesMd(p: ProjectRow, f: FeatureRow): void {
    const dir = this.#dir(p.slug);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "FEATURES.md");
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date(f.released_at));
    if (!existsSync(file)) writeFileSync(file, `# ${p.name}: what's new\n\nUser-facing notes, newest last. Written by Agent Office (Coder) after each release.\n`);
    appendFileSync(file, `\n## ${date} · ${f.title}\n\n${f.user_facing_note}\n${f.source_pr_url ? `\n<sub>Source: ${f.source_pr_url}</sub>\n` : ""}`);
  }

  // ---------------------------------------------------------------- drafts

  draft(id: string): ContentDraft | null {
    const row = this.db.select().from(contentDrafts).where(eq(contentDrafts.id, id)).get();
    return row ? toDraft(row) : null;
  }

  listDrafts(filter: { status?: string; project_id?: string; limit?: number }): ContentDraft[] {
    const conds = [];
    if (filter.status === "pending") conds.push(eq(contentDrafts.status, "draft"));
    else if (filter.status === "decided") conds.push(ne(contentDrafts.status, "draft"));
    if (filter.project_id) conds.push(eq(contentDrafts.project_id, filter.project_id));
    return this.db
      .select()
      .from(contentDrafts)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(contentDrafts.created_at), desc(contentDrafts.id))
      .limit(Math.min(filter.limit ?? 200, 500))
      .all()
      .map(toDraft);
  }

  insertDraft(
    tx: Db,
    emit: Emit,
    d: { project_id: string; agent_id: string; run_id: string; platform: string; kind: string; title: string; body: string; self_check: SelfCheck; feature_id: string | null; meta?: WebPost | null },
  ): DraftRow {
    const row = tx
      .insert(contentDrafts)
      .values({ id: newId("drf"), ...d, original_body: d.body, status: "draft" })
      .returning()
      .get();
    emit(
      { type: "draft.created", payload: { draft_id: row.id, project_id: d.project_id, platform: d.platform, kind: d.kind } },
      { run_id: d.run_id, agent_id: d.agent_id },
    );
    return row;
  }

  /**
   * Owner's decision. Approving with a changed body records "edited" and keeps
   * the original: both are the agent's style memory. An approved style guide
   * becomes the brief's style notes.
   */
  decideDraft(id: string, decision: DraftDecision): ContentDraft {
    const row = this.db.select().from(contentDrafts).where(eq(contentDrafts.id, id)).get();
    if (!row) throw new HttpError(404, "draft not found");
    if (row.status !== "draft") throw new HttpError(409, `draft is already ${row.status}`);
    const at = new Date().toISOString();
    const approve = decision.decision === "approve" ? decision : null;
    const body = approve?.body ?? row.body;
    const title = approve?.title ?? row.title;
    // website posts: the owner may change any field before approving; a cover must be one of the uploads
    let meta = row.meta;
    if (approve?.meta && row.meta) {
      meta = WebPost.parse({ ...row.meta, ...approve.meta });
      if (meta.cover_upload_id && !this.db.select({ id: uploads.id }).from(uploads).where(eq(uploads.id, meta.cover_upload_id)).get()) {
        throw new HttpError(400, "unknown cover photo");
      }
    }
    const changed = body.trim() !== row.original_body.trim() || title !== row.title || JSON.stringify(meta) !== JSON.stringify(row.meta);
    const status = !approve ? "rejected" : changed ? "edited" : "approved";
    const updated = this.store.transact((tx, emit) => {
      const r = tx
        .update(contentDrafts)
        .set({ status, body, title, meta, owner_feedback: decision.feedback?.trim() || null, decided_at: at })
        .where(eq(contentDrafts.id, id))
        .returning()
        .get()!;
      if (status !== "rejected" && row.feature_id && row.kind === "announcement") {
        tx.update(featureLog).set({ announced: true }).where(eq(featureLog.id, row.feature_id)).run();
      }
      emit({ type: "draft.decided", payload: { draft_id: id, status } }, { agent_id: row.agent_id });
      return r;
    });
    if (status !== "rejected" && row.kind === "style_guide") {
      const p = this.project(row.project_id);
      const brief = this.readBrief(p) ?? ProjectBrief.parse({ project: p.name });
      this.writeBrief(p, { ...brief, style_notes: body.slice(0, 6000) });
    }
    return toDraft(updated);
  }

  // ---------------------------------------------------------------- agent context

  /** Everything Marketing may read: briefs, released features and decided drafts (the owner's feedback). */
  context(projectIds: string[] | "all"): ProjectContext {
    const rows =
      projectIds === "all"
        ? this.db.select().from(projects).where(eq(projects.enabled, true)).all()
        : projectIds.length
          ? this.db.select().from(projects).where(inArray(projects.id, projectIds)).all()
          : [];
    const today = new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
    return {
      today,
      projects: rows.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        live_url: p.live_url,
        publish: p.publish?.url && p.publish.info ? p.publish.info : null,
        social: [],
        published_posts: this.db
          .select()
          .from(contentDrafts)
          .where(and(eq(contentDrafts.project_id, p.id), eq(contentDrafts.kind, "web_post"), eq(contentDrafts.status, "published")))
          .orderBy(desc(contentDrafts.decided_at))
          .limit(20)
          .all()
          .map((d) => ({ draft_id: d.id, title: d.title, post_type: d.meta?.post_type ?? "", event_date: d.meta?.event_date ?? "", url: d.published_url })),
        brief: this.#briefForAgents(p),
        features: this.db
          .select()
          .from(featureLog)
          .where(eq(featureLog.project_id, p.id))
          .orderBy(desc(featureLog.released_at))
          .limit(FEATURES_IN_CONTEXT)
          .all()
          .map((f) => ({ title: f.title, user_facing_note: f.user_facing_note, released_at: f.released_at })),
        past_drafts: this.db
          .select()
          .from(contentDrafts)
          .where(and(eq(contentDrafts.project_id, p.id), ne(contentDrafts.status, "draft")))
          .orderBy(desc(contentDrafts.decided_at))
          .limit(PAST_DRAFTS_IN_CONTEXT)
          .all()
          .map((d) => ({
            platform: d.platform as ProjectContext["projects"][number]["past_drafts"][number]["platform"],
            kind: d.kind as ProjectContext["projects"][number]["past_drafts"][number]["kind"],
            status: d.status,
            body: d.body,
            original_body: d.original_body,
            owner_feedback: d.owner_feedback,
          })),
      })),
    };
  }
}
