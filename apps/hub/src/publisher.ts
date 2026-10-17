import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { PublishInfo, WebPost, fixEscapedNewlines, freshFetch, type WebPostEdit } from "@agent-office/shared";
import { keyHint, type Secrets } from "./crypto.ts";
import type { Db } from "./db/client.ts";
import { contentDrafts, projects, uploads, type ProjectPublish } from "./db/schema.ts";
import type { EventStore } from "./events.ts";
import { HttpError, newId } from "./repo.ts";
import { toDraft } from "./content.ts";

/**
 * Publisher (owner request): the owner chats with an agent, sends photos and a few points,
 * the agent writes a post for one of the owner's websites, and the post is published only
 * when the owner approves the draft. Each website exposes one endpoint:
 *
 *   GET  <url>  → { site_name, post_types }                       (what it accepts)
 *   POST <url>  { version: 1, draft_id, post, cover } → { id, url } (create the post)
 *
 * Both are signed: X-AO-Timestamp (unix seconds) and
 * X-AO-Signature: v1=hex(HMAC-SHA256(secret, `${timestamp}.${body}`)) (body "" for GET).
 * The site must reject timestamps older than 5 minutes.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

export const PublishSettingsInput = z.object({
  url: z.string().url().or(z.literal("")),
  /** Write-only. Omit to keep, "" to clear. */
  secret: z.string().max(200).optional(),
});

export interface PublishSettingsPublic {
  url: string;
  has_secret: boolean;
  secret_hint: string | null;
  info: PublishInfo | null;
  checked_at: string | null;
}

export function signRequest(secret: string, body: string, ts = Math.floor(Date.now() / 1000)) {
  return { "x-ao-timestamp": String(ts), "x-ao-signature": `v1=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}` };
}

export class Publisher {
  constructor(
    private readonly db: Db,
    private readonly store: EventStore,
    private readonly secrets: Secrets,
    private readonly filesDir: string,
  ) {}

  // ---------------------------------------------------------------- uploads (chat photos)

  saveUpload(name: string, contentType: string, bytes: Uint8Array) {
    const ext = IMAGE_TYPES[contentType];
    if (!ext) throw new HttpError(400, "only JPEG, PNG, WebP or GIF images");
    if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw new HttpError(400, "the image must be under 10 MB");
    const id = newId("upl");
    const dir = join(this.filesDir, "uploads");
    mkdirSync(dir, { recursive: true });
    const path = join("uploads", `${id}.${ext}`);
    writeFileSync(join(this.filesDir, path), bytes);
    const clean = name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || `image.${ext}`;
    return this.db.insert(uploads).values({ id, name: clean, content_type: contentType, size: bytes.length, path }).returning().get();
  }

  upload(id: string) {
    return this.db.select().from(uploads).where(eq(uploads.id, id)).get() ?? null;
  }

  readUpload(id: string): { row: typeof uploads.$inferSelect; bytes: Buffer } | null {
    const row = this.upload(id);
    const file = row ? join(this.filesDir, row.path) : "";
    return row && existsSync(file) ? { row, bytes: readFileSync(file) } : null;
  }

  // ---------------------------------------------------------------- per-project settings

  #project(id: string) {
    const p = this.db.select().from(projects).where(eq(projects.id, id)).get();
    if (!p) throw new HttpError(404, "project not found");
    return p;
  }

  settings(projectId: string): PublishSettingsPublic {
    const s = this.#project(projectId).publish;
    return { url: s?.url ?? "", has_secret: !!s?.secret_enc, secret_hint: s?.secret_hint ?? null, info: s?.info ?? null, checked_at: s?.checked_at ?? null };
  }

  setSettings(projectId: string, input: z.input<typeof PublishSettingsInput>): PublishSettingsPublic {
    const data = PublishSettingsInput.parse(input);
    const prev = this.#project(projectId).publish;
    const changedUrl = data.url !== (prev?.url ?? "");
    const value: ProjectPublish = {
      url: data.url,
      secret_enc: data.secret === undefined ? (prev?.secret_enc ?? null) : data.secret ? this.secrets.encrypt(data.secret) : null,
      secret_hint: data.secret === undefined ? (prev?.secret_hint ?? null) : data.secret ? keyHint(data.secret) : null,
      // a new address must be tested again before Publisher offers it
      info: changedUrl ? null : (prev?.info ?? null),
      checked_at: changedUrl ? null : (prev?.checked_at ?? null),
    };
    this.db.update(projects).set({ publish: value }).where(eq(projects.id, projectId)).run();
    return this.settings(projectId);
  }

  #endpoint(projectId: string): { url: string; secret: string; publish: ProjectPublish } {
    const s = this.#project(projectId).publish;
    if (!s?.url || !s.secret_enc) throw new HttpError(400, "this project has no website publishing set up (Projects → Website publishing)");
    return { url: s.url, secret: this.secrets.decrypt(s.secret_enc), publish: s };
  }

  /** "Test" button: ask the site what it accepts, and remember it for Publisher. */
  async refresh(projectId: string): Promise<PublishSettingsPublic> {
    const { url, secret, publish } = this.#endpoint(projectId);
    const res = await freshFetch(url, { timeoutMs: 20_000, headers: signRequest(secret, "") }).catch((e: Error) => {
      throw new HttpError(400, `cannot reach ${new URL(url).host}: ${e.message}`);
    });
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) throw new HttpError(400, `the site answered ${res.status}${body?.error ? `: ${body.error}` : ""}`);
    const info = PublishInfo.safeParse(body);
    if (!info.success) throw new HttpError(400, "the site's answer is not { site_name, post_types }");
    this.db
      .update(projects)
      .set({ publish: { ...publish, info: info.data, checked_at: new Date().toISOString() } })
      .where(eq(projects.id, projectId))
      .run();
    return this.settings(projectId);
  }

  /**
   * Read data the website shares with Agent Office (e.g. `resource=bookings` for Kerani). The query
   * string is part of the signed message, so a captured request cannot be replayed for other data.
   */
  async siteData(projectId: string, resource: string, params: Record<string, string>): Promise<unknown> {
    const { url, secret } = this.#endpoint(projectId);
    const qs = new URLSearchParams({ resource, ...params }).toString();
    const res = await freshFetch(`${url}?${qs}`, { timeoutMs: 30_000, headers: signRequest(secret, qs) }).catch((e: Error) => {
      throw new HttpError(400, `cannot reach the website: ${e.message}`);
    });
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) throw new HttpError(400, `the website answered ${res.status}${body?.error ? `: ${body.error}` : ""}`);
    return body;
  }

  /** Send an approved web_post draft to its website. Records the URL or the error on the draft. */
  async publish(draftId: string) {
    const row = this.db.select().from(contentDrafts).where(eq(contentDrafts.id, draftId)).get();
    if (!row) throw new HttpError(404, "draft not found");
    if (row.kind !== "web_post") throw new HttpError(400, "only website posts can be published");
    if (row.status !== "approved" && row.status !== "edited") throw new HttpError(409, row.status === "published" ? "already published" : "approve the draft first");
    let error: string | null = null;
    let publishedUrl: string | null = null;
    try {
      const { url, secret } = this.#endpoint(row.project_id);
      const m = row.meta;
      // recorded on the draft like any other failure, so the owner sees it
      if (!m) throw new Error("this draft has no post details (type, excerpt); ask Publisher to draft it again");
      const cover = m.cover_upload_id ? this.readUpload(m.cover_upload_id) : null;
      const body = JSON.stringify({
        version: 1,
        draft_id: row.id,
        post: {
          type: m.post_type,
          title: row.title,
          excerpt: m.excerpt,
          body: row.body,
          tags: m.tags,
          event_date: m.event_date,
          event_time: m.event_time,
          location: m.location,
          video_url: m.video_url,
        },
        cover: cover ? { name: cover.row.name, content_type: cover.row.content_type, data_base64: cover.bytes.toString("base64") } : null,
      });
      const res = await freshFetch(url, { timeoutMs: 60_000, method: "POST", headers: { "content-type": "application/json", ...signRequest(secret, body) }, body });
      const out = (await res.json().catch(() => null)) as { id?: string; url?: string; error?: string } | null;
      if (!res.ok) throw new Error(`the site answered ${res.status}${out?.error ? `: ${out.error}` : ""}`);
      publishedUrl = out?.url ?? out?.id ?? "published";
    } catch (err) {
      error = (err as Error).message.slice(0, 500);
    }
    const updated = this.store.transact((tx, emit) => {
      const r = tx
        .update(contentDrafts)
        .set(error ? { publish_error: error } : { status: "published", published_url: publishedUrl, publish_error: null })
        .where(eq(contentDrafts.id, draftId))
        .returning()
        .get()!;
      if (!error) emit({ type: "draft.decided", payload: { draft_id: draftId, status: "published" } }, { agent_id: row.agent_id });
      return r;
    });
    return toDraft(updated);
  }

  async #post(projectId: string, payload: Record<string, unknown>): Promise<{ id?: string; url?: string }> {
    const { url, secret } = this.#endpoint(projectId);
    const body = JSON.stringify({ version: 1, ...payload });
    const res = await freshFetch(url, { timeoutMs: 60_000, method: "POST", headers: { "content-type": "application/json", ...signRequest(secret, body) }, body });
    const out = (await res.json().catch(() => null)) as { id?: string; url?: string; error?: string } | null;
    if (!res.ok) throw new HttpError(400, `the site answered ${res.status}${out?.error ? `: ${out.error}` : ""}`);
    return out ?? {};
  }

  #published(draftId: string) {
    const row = this.db.select().from(contentDrafts).where(eq(contentDrafts.id, draftId)).get();
    if (!row) throw new HttpError(404, "draft not found");
    if (row.kind !== "web_post" || !row.meta) throw new HttpError(400, "only website posts can be changed");
    if (row.status !== "published") throw new HttpError(409, "this post is not on the website");
    return { ...row, meta: row.meta };
  }

  /**
   * Put an uploaded photo on the project's website storage and return its public URL. Instagram
   * and Threads only accept photos by URL, and our own uploads stay private in the hub.
   */
  async uploadMedia(projectId: string, uploadId: string): Promise<string> {
    const f = this.readUpload(uploadId);
    if (!f) throw new HttpError(400, "the photo is missing");
    if (!/^image\/(jpeg|png|webp)$/.test(f.row.content_type)) throw new HttpError(400, "Instagram and Threads need a JPEG, PNG or WebP photo");
    const out = (await this.#post(projectId, { action: "upload_media", name: f.row.name, content_type: f.row.content_type, data_base64: f.bytes.toString("base64") })) as { url?: string };
    if (!out.url?.startsWith("https://") && !out.url?.startsWith("http://")) throw new HttpError(400, "the website did not return a photo URL");
    return out.url;
  }

  /** Change a post that is already live. The draft keeps the new text only when the website accepted it. */
  async updatePublished(draftId: string, edits: { title?: string; body?: string; meta?: WebPostEdit }) {
    const row = this.#published(draftId);
    const meta = WebPost.parse({ ...row.meta, ...(edits.meta ?? {}) });
    const title = edits.title?.trim() || row.title;
    const body = fixEscapedNewlines(edits.body ?? row.body);
    const coverChanged = meta.cover_upload_id !== row.meta.cover_upload_id;
    const cover = coverChanged && meta.cover_upload_id ? this.readUpload(meta.cover_upload_id) : null;
    if (coverChanged && meta.cover_upload_id && !cover) throw new HttpError(400, "unknown cover photo");
    await this.#post(row.project_id, {
      action: "update",
      draft_id: row.id,
      post: { type: meta.post_type, title, excerpt: meta.excerpt, body, tags: meta.tags, event_date: meta.event_date, event_time: meta.event_time, location: meta.location, video_url: meta.video_url },
      cover: cover ? { name: cover.row.name, content_type: cover.row.content_type, data_base64: cover.bytes.toString("base64") } : null,
      remove_cover: coverChanged && !meta.cover_upload_id,
    });
    const r = this.db.update(contentDrafts).set({ title, body, meta, publish_error: null }).where(eq(contentDrafts.id, draftId)).returning().get()!;
    return toDraft(r);
  }

  /** Take a live post off the website. The draft goes back to "approved", so it can be published again. */
  async takeDown(draftId: string) {
    const row = this.#published(draftId);
    await this.#post(row.project_id, { action: "delete", draft_id: row.id });
    const r = this.db.update(contentDrafts).set({ status: "approved", published_url: null, publish_error: null }).where(eq(contentDrafts.id, draftId)).returning().get()!;
    return toDraft(r);
  }
}
