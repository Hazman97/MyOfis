import { eq } from "drizzle-orm";
import { z } from "zod";
import { freshFetch } from "@agent-office/shared";
import { keyHint, type Secrets } from "./crypto.ts";
import type { Db } from "./db/client.ts";
import { contentDrafts, projects, settings } from "./db/schema.ts";
import type { EventStore } from "./events.ts";
import { HttpError } from "./repo.ts";
import { toDraft } from "./content.ts";
import type { Publisher } from "./publisher.ts";

/**
 * Posting approved Facebook captions to the project's Facebook Page (owner request). One Page per
 * project: Page id + a Page access token (encrypted, never sent to the browser or runners).
 * A caption draft with a photo becomes a photo post; without one, a text post.
 * Instagram is not done here: its API needs the photo at a public URL.
 */
export const FacebookSettingsInput = z.object({
  page_id: z.string().regex(/^\d{5,30}$/).or(z.literal("")),
  /** Write-only. Omit to keep, "" to clear. */
  token: z.string().max(1000).optional(),
});

export interface FacebookPublic {
  page_id: string;
  page_name: string | null;
  has_token: boolean;
  token_hint: string | null;
}

interface Stored {
  page_id: string;
  page_name: string | null;
  token_enc: string | null;
  token_hint: string | null;
}

const key = (projectId: string) => `social.facebook.${projectId}`;

export class Social {
  constructor(
    private readonly db: Db,
    private readonly store: EventStore,
    private readonly secrets: Secrets,
    private readonly publisher: Publisher,
    /** Tests point this at a fake Graph API. */
    private readonly graphBase = "https://graph.facebook.com/v21.0",
  ) {}

  #read(projectId: string): Stored | null {
    const row = this.db.select().from(settings).where(eq(settings.key, key(projectId))).get();
    return (row?.value as Stored | undefined) ?? null;
  }

  #write(projectId: string, value: Stored): void {
    this.db.insert(settings).values({ key: key(projectId), value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
  }

  facebook(projectId: string): FacebookPublic {
    if (!this.db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get()) throw new HttpError(404, "project not found");
    const s = this.#read(projectId);
    return { page_id: s?.page_id ?? "", page_name: s?.page_name ?? null, has_token: !!s?.token_enc, token_hint: s?.token_hint ?? null };
  }

  setFacebook(projectId: string, input: z.input<typeof FacebookSettingsInput>): FacebookPublic {
    const data = FacebookSettingsInput.parse(input);
    this.facebook(projectId);
    const prev = this.#read(projectId);
    this.#write(projectId, {
      page_id: data.page_id,
      page_name: data.page_id === prev?.page_id ? (prev?.page_name ?? null) : null,
      token_enc: data.token === undefined ? (prev?.token_enc ?? null) : data.token ? this.secrets.encrypt(data.token) : null,
      token_hint: data.token === undefined ? (prev?.token_hint ?? null) : data.token ? keyHint(data.token) : null,
    });
    return this.facebook(projectId);
  }

  #config(projectId: string): { pageId: string; token: string } | null {
    const s = this.#read(projectId);
    return s?.page_id && s.token_enc ? { pageId: s.page_id, token: this.secrets.decrypt(s.token_enc) } : null;
  }

  async #graph<T>(path: string, init: { method?: string; body?: FormData | URLSearchParams } = {}): Promise<T> {
    const res = await freshFetch(`${this.graphBase}/${path}`, { timeoutMs: 60_000, method: init.method ?? "GET", body: init.body });
    const json = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
    if (!res.ok || json?.error) throw new HttpError(400, `Facebook: ${json?.error?.message ?? res.status}`);
    return json as T;
  }

  /** "Test": the token can read the Page; remembers its name. */
  async testFacebook(projectId: string): Promise<FacebookPublic> {
    const cfg = this.#config(projectId);
    if (!cfg) throw new HttpError(400, "set the Page id and the Page access token first");
    const page = await this.#graph<{ name?: string }>(`${cfg.pageId}?fields=name&access_token=${encodeURIComponent(cfg.token)}`);
    const s = this.#read(projectId)!;
    this.#write(projectId, { ...s, page_name: page.name ?? null });
    return this.facebook(projectId);
  }

  configured(projectId: string): boolean {
    return !!this.#config(projectId);
  }

  /** Post an approved Facebook caption. Records the post link or the error on the draft. */
  async postToFacebook(draftId: string) {
    const row = this.db.select().from(contentDrafts).where(eq(contentDrafts.id, draftId)).get();
    if (!row) throw new HttpError(404, "draft not found");
    if (row.platform !== "facebook") throw new HttpError(400, "only Facebook drafts can be posted to Facebook");
    if (row.status !== "approved" && row.status !== "edited") throw new HttpError(409, row.status === "published" ? "already posted" : "approve the draft first");
    let error: string | null = null;
    let link: string | null = null;
    try {
      const cfg = this.#config(row.project_id);
      if (!cfg) throw new Error("this project has no Facebook Page connected (Projects → Website → Facebook Page)");
      const photo = row.meta?.cover_upload_id ? this.publisher.readUpload(row.meta.cover_upload_id) : null;
      let id: string;
      if (photo) {
        const form = new FormData();
        form.set("caption", row.body);
        form.set("access_token", cfg.token);
        form.set("source", new Blob([new Uint8Array(photo.bytes)], { type: photo.row.content_type }), photo.row.name);
        const out = await this.#graph<{ post_id?: string; id?: string }>(`${cfg.pageId}/photos`, { method: "POST", body: form });
        id = out.post_id ?? out.id ?? "";
      } else {
        const out = await this.#graph<{ id?: string }>(`${cfg.pageId}/feed`, { method: "POST", body: new URLSearchParams({ message: row.body, access_token: cfg.token }) });
        id = out.id ?? "";
      }
      link = id ? `https://www.facebook.com/${id}` : "posted";
    } catch (err) {
      error = (err as Error).message.slice(0, 500);
    }
    const updated = this.store.transact((tx, emit) => {
      const r = tx
        .update(contentDrafts)
        .set(error ? { publish_error: error } : { status: "published", published_url: link, publish_error: null })
        .where(eq(contentDrafts.id, draftId))
        .returning()
        .get()!;
      if (!error) emit({ type: "draft.decided", payload: { draft_id: draftId, status: "published" } }, { agent_id: row.agent_id });
      return r;
    });
    return toDraft(updated);
  }
}
