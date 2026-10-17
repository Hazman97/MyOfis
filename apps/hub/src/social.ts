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
 * Posting approved captions to the project's social accounts (owner request). Per project:
 * - Facebook Page: Page id + Page access token (encrypted). Photo post or text post.
 * - Instagram (Business/Creator account linked to that Page): uses the same Page token. Instagram
 *   only takes a photo by public URL, so the photo goes to the website's storage first.
 * - Threads: its own user token (Threads API). Text post, or photo by public URL.
 * Tokens never reach the browser or runners.
 */
export type SocialPlatform = "facebook" | "instagram" | "threads";

export const FacebookSettingsInput = z.object({
  page_id: z.string().regex(/^\d{5,30}$/).or(z.literal("")),
  /** Write-only. Omit to keep, "" to clear. */
  token: z.string().max(1000).optional(),
});
export const ThreadsSettingsInput = z.object({ token: z.string().max(1000) });

export interface FacebookPublic {
  page_id: string;
  page_name: string | null;
  has_token: boolean;
  token_hint: string | null;
}
export interface InstagramPublic {
  connected: boolean;
  enabled: boolean;
  ig_user_id: string | null;
  username: string | null;
}
export interface ThreadsPublic {
  has_token: boolean;
  token_hint: string | null;
  user_id: string | null;
  username: string | null;
  /** When the token stops working (known after the first refresh). */
  expires_at: string | null;
}

interface StoredFb {
  page_id: string;
  page_name: string | null;
  token_enc: string | null;
  token_hint: string | null;
}
interface StoredIg {
  enabled: boolean;
  ig_user_id: string | null;
  username: string | null;
}
interface StoredThreads {
  token_enc: string | null;
  token_hint: string | null;
  user_id: string | null;
  username: string | null;
  refreshed_at?: string | null;
  expires_at?: string | null;
}

/** Threads long-lived tokens last 60 days and can be refreshed once they are a day old: refresh weekly. */
const THREADS_REFRESH_MS = 7 * 86_400_000;

const key = (platform: SocialPlatform, projectId: string) => `social.${platform}.${projectId}`;
const READY_TRIES = 15;

export class Social {
  constructor(
    private readonly db: Db,
    private readonly store: EventStore,
    private readonly secrets: Secrets,
    private readonly publisher: Publisher,
    /** Tests point these at fakes. */
    private readonly graphBase = "https://graph.facebook.com/v21.0",
    private readonly threadsBase = "https://graph.threads.net/v1.0",
    private readonly readyDelayMs = 2000,
  ) {}

  #read<T>(platform: SocialPlatform, projectId: string): T | null {
    const row = this.db.select().from(settings).where(eq(settings.key, key(platform, projectId))).get();
    return (row?.value as T | undefined) ?? null;
  }

  #write(platform: SocialPlatform, projectId: string, value: object): void {
    this.db.insert(settings).values({ key: key(platform, projectId), value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
  }

  #project(projectId: string): void {
    if (!this.db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get()) throw new HttpError(404, "project not found");
  }

  async #call<T>(url: string, init: { method?: string; body?: FormData | URLSearchParams } = {}): Promise<T> {
    const res = await freshFetch(url, { timeoutMs: 60_000, method: init.method ?? "GET", body: init.body });
    const json = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
    if (!res.ok || json?.error) throw new HttpError(400, json?.error?.message ?? `HTTP ${res.status}`);
    return json as T;
  }

  // ---------------------------------------------------------------- Facebook Page

  facebook(projectId: string): FacebookPublic {
    this.#project(projectId);
    const s = this.#read<StoredFb>("facebook", projectId);
    return { page_id: s?.page_id ?? "", page_name: s?.page_name ?? null, has_token: !!s?.token_enc, token_hint: s?.token_hint ?? null };
  }

  setFacebook(projectId: string, input: z.input<typeof FacebookSettingsInput>): FacebookPublic {
    const data = FacebookSettingsInput.parse(input);
    this.#project(projectId);
    const prev = this.#read<StoredFb>("facebook", projectId);
    this.#write("facebook", projectId, {
      page_id: data.page_id,
      page_name: data.page_id === prev?.page_id ? (prev?.page_name ?? null) : null,
      token_enc: data.token === undefined ? (prev?.token_enc ?? null) : data.token ? this.secrets.encrypt(data.token) : null,
      token_hint: data.token === undefined ? (prev?.token_hint ?? null) : data.token ? keyHint(data.token) : null,
    } satisfies StoredFb);
    return this.facebook(projectId);
  }

  #fb(projectId: string): { pageId: string; token: string } | null {
    const s = this.#read<StoredFb>("facebook", projectId);
    return s?.page_id && s.token_enc ? { pageId: s.page_id, token: this.secrets.decrypt(s.token_enc) } : null;
  }

  async testFacebook(projectId: string): Promise<FacebookPublic> {
    const cfg = this.#fb(projectId);
    if (!cfg) throw new HttpError(400, "set the Page id and the Page access token first");
    const page = await this.#call<{ name?: string }>(`${this.graphBase}/${cfg.pageId}?fields=name&access_token=${encodeURIComponent(cfg.token)}`).catch((e: Error) => {
      throw new HttpError(400, `Facebook: ${e.message}`);
    });
    this.#write("facebook", projectId, { ...this.#read<StoredFb>("facebook", projectId)!, page_name: page.name ?? null });
    return this.facebook(projectId);
  }

  // ---------------------------------------------------------------- Instagram

  instagram(projectId: string): InstagramPublic {
    this.#project(projectId);
    const s = this.#read<StoredIg>("instagram", projectId);
    return { connected: !!s?.ig_user_id, enabled: !!s?.enabled, ig_user_id: s?.ig_user_id ?? null, username: s?.username ?? null };
  }

  /** Find the Instagram account linked to the Facebook Page (same token) and switch posting on. */
  async connectInstagram(projectId: string): Promise<InstagramPublic> {
    const cfg = this.#fb(projectId);
    if (!cfg) throw new HttpError(400, "connect the Facebook Page first: Instagram uses the same Page token");
    const page = await this.#call<{ instagram_business_account?: { id: string; username?: string } }>(
      `${this.graphBase}/${cfg.pageId}?fields=instagram_business_account{id,username}&access_token=${encodeURIComponent(cfg.token)}`,
    ).catch((e: Error) => {
      throw new HttpError(400, `Instagram: ${e.message}`);
    });
    const ig = page.instagram_business_account;
    if (!ig?.id) throw new HttpError(400, "this Page has no Instagram Business/Creator account linked (link it in the Instagram app: Settings → Account → Sharing to other apps / Page)");
    this.#write("instagram", projectId, { enabled: true, ig_user_id: ig.id, username: ig.username ?? null } satisfies StoredIg);
    return this.instagram(projectId);
  }

  setInstagramEnabled(projectId: string, enabled: boolean): InstagramPublic {
    const s = this.#read<StoredIg>("instagram", projectId);
    if (!s?.ig_user_id) throw new HttpError(400, "connect Instagram first");
    this.#write("instagram", projectId, { ...s, enabled });
    return this.instagram(projectId);
  }

  // ---------------------------------------------------------------- Threads

  threads(projectId: string): ThreadsPublic {
    this.#project(projectId);
    const s = this.#read<StoredThreads>("threads", projectId);
    return { has_token: !!s?.token_enc, token_hint: s?.token_hint ?? null, user_id: s?.user_id ?? null, username: s?.username ?? null, expires_at: s?.expires_at ?? null };
  }

  /** Save a Threads token ("" removes it) and check it straight away. */
  async setThreads(projectId: string, input: z.input<typeof ThreadsSettingsInput>): Promise<ThreadsPublic> {
    const { token } = ThreadsSettingsInput.parse(input);
    this.#project(projectId);
    if (!token) {
      this.#write("threads", projectId, { token_enc: null, token_hint: null, user_id: null, username: null } satisfies StoredThreads);
      return this.threads(projectId);
    }
    const me = await this.#call<{ id?: string; username?: string }>(`${this.threadsBase}/me?fields=id,username&access_token=${encodeURIComponent(token)}`).catch((e: Error) => {
      throw new HttpError(400, `Threads: ${e.message}`);
    });
    if (!me.id) throw new HttpError(400, "Threads did not return the account id");
    this.#write("threads", projectId, { token_enc: this.secrets.encrypt(token), token_hint: keyHint(token), user_id: me.id, username: me.username ?? null, refreshed_at: new Date().toISOString(), expires_at: null } satisfies StoredThreads);
    return this.threads(projectId);
  }

  #threads(projectId: string): { userId: string; token: string } | null {
    const s = this.#read<StoredThreads>("threads", projectId);
    return s?.token_enc && s.user_id ? { userId: s.user_id, token: this.secrets.decrypt(s.token_enc) } : null;
  }

  // ---------------------------------------------------------------- token health

  /**
   * Run every few hours by the server: refresh Threads tokens that are a week old (each refresh
   * gives another 60 days) and check that Facebook Page tokens still work. Returns one line per
   * problem for the owner (Telegram); an empty list means all is well.
   */
  async checkTokens(now = new Date()): Promise<string[]> {
    const problems: string[] = [];
    const rows = this.db.select().from(settings).all().filter((r) => r.key.startsWith("social."));
    const names = new Map(this.db.select({ id: projects.id, name: projects.name }).from(projects).all().map((p) => [p.id, p.name]));
    for (const row of rows) {
      const [, platform, projectId] = row.key.split(".") as [string, SocialPlatform, string];
      const name = names.get(projectId);
      if (!name) continue;
      if (platform === "threads") {
        const s = row.value as StoredThreads;
        if (!s.token_enc) continue;
        const last = s.refreshed_at ? Date.parse(s.refreshed_at) : 0;
        if (now.getTime() - last < THREADS_REFRESH_MS) continue;
        try {
          const base = this.threadsBase.replace(/\/v\d+(\.\d+)?$/, "");
          const r = await this.#call<{ access_token?: string; expires_in?: number }>(
            `${base}/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(this.secrets.decrypt(s.token_enc))}`,
          );
          if (!r.access_token) throw new Error("no token in the answer");
          this.#write("threads", projectId, {
            ...s,
            token_enc: this.secrets.encrypt(r.access_token),
            token_hint: keyHint(r.access_token),
            refreshed_at: now.toISOString(),
            expires_at: r.expires_in ? new Date(now.getTime() + r.expires_in * 1000).toISOString() : (s.expires_at ?? null),
          } satisfies StoredThreads);
        } catch (err) {
          const left = s.expires_at ? Math.floor((Date.parse(s.expires_at) - now.getTime()) / 86_400_000) : null;
          problems.push(
            `${name}: the Threads token could not be renewed (${(err as Error).message})${left !== null ? `; it stops working in ${Math.max(0, left)} day(s)` : ""}. Paste a new long-lived token in Projects → ${name} → Website → Instagram & Threads.`,
          );
        }
      } else if (platform === "facebook") {
        const cfg = this.#fb(projectId);
        if (!cfg) continue;
        try {
          await this.#call(`${this.graphBase}/${cfg.pageId}?fields=name&access_token=${encodeURIComponent(cfg.token)}`);
        } catch (err) {
          problems.push(`${name}: the Facebook Page token no longer works (${(err as Error).message}), so Facebook and Instagram posts will fail. Make a new Page token (docs/facebook-page.md) and save it in Projects → ${name} → Website.`);
        }
      }
    }
    return problems;
  }

  // ---------------------------------------------------------------- what is connected

  configured(platform: string, projectId: string): boolean {
    if (platform === "facebook") return !!this.#fb(projectId);
    if (platform === "instagram") {
      const ig = this.#read<StoredIg>("instagram", projectId);
      return !!(ig?.enabled && ig.ig_user_id && this.#fb(projectId));
    }
    if (platform === "threads") return !!this.#threads(projectId);
    return false;
  }

  /** Which platforms approving a caption posts to, for this project (agents see this list). */
  connected(projectId: string): SocialPlatform[] {
    return (["facebook", "instagram", "threads"] as const).filter((p) => this.configured(p, projectId));
  }

  // ---------------------------------------------------------------- posting

  #draft(draftId: string, platform: SocialPlatform) {
    const row = this.db.select().from(contentDrafts).where(eq(contentDrafts.id, draftId)).get();
    if (!row) throw new HttpError(404, "draft not found");
    if (row.platform !== platform) throw new HttpError(400, `this is not a ${platform} draft`);
    if (row.status !== "approved" && row.status !== "edited") throw new HttpError(409, row.status === "published" ? "already posted" : "approve the draft first");
    return row;
  }

  /** Record the outcome on the draft: a link, or the error (the owner can retry). */
  #finish(draftId: string, agentId: string, link: string | null, error: string | null) {
    return toDraft(
      this.store.transact((tx, emit) => {
        const r = tx
          .update(contentDrafts)
          .set(error ? { publish_error: error.slice(0, 500) } : { status: "published", published_url: link, publish_error: null })
          .where(eq(contentDrafts.id, draftId))
          .returning()
          .get()!;
        if (!error) emit({ type: "draft.decided", payload: { draft_id: draftId, status: "published" } }, { agent_id: agentId });
        return r;
      }),
    );
  }

  /** Post one approved caption to its platform. */
  async post(draftId: string) {
    const row = this.db.select().from(contentDrafts).where(eq(contentDrafts.id, draftId)).get();
    if (!row) throw new HttpError(404, "draft not found");
    if (row.platform === "facebook") return this.postToFacebook(draftId);
    if (row.platform === "instagram") return this.postToInstagram(draftId);
    if (row.platform === "threads") return this.postToThreads(draftId);
    throw new HttpError(400, `${row.platform} is not connected for posting`);
  }

  async postToFacebook(draftId: string) {
    const row = this.#draft(draftId, "facebook");
    try {
      const cfg = this.#fb(row.project_id);
      if (!cfg) throw new Error("this project has no Facebook Page connected (Projects → Website → Facebook Page)");
      const photo = row.meta?.cover_upload_id ? this.publisher.readUpload(row.meta.cover_upload_id) : null;
      let id: string;
      if (photo) {
        const form = new FormData();
        form.set("caption", row.body);
        form.set("access_token", cfg.token);
        form.set("source", new Blob([new Uint8Array(photo.bytes)], { type: photo.row.content_type }), photo.row.name);
        const out = await this.#call<{ post_id?: string; id?: string }>(`${this.graphBase}/${cfg.pageId}/photos`, { method: "POST", body: form });
        id = out.post_id ?? out.id ?? "";
      } else {
        const out = await this.#call<{ id?: string }>(`${this.graphBase}/${cfg.pageId}/feed`, { method: "POST", body: new URLSearchParams({ message: row.body, access_token: cfg.token }) });
        id = out.id ?? "";
      }
      return this.#finish(draftId, row.agent_id, id ? `https://www.facebook.com/${id}` : "posted", null);
    } catch (err) {
      return this.#finish(draftId, row.agent_id, null, `Facebook: ${(err as Error).message}`);
    }
  }

  /** Wait until Meta has processed a media container (photos can take a few seconds). */
  async #ready(url: string, field: "status_code" | "status"): Promise<void> {
    for (let i = 0; i < READY_TRIES; i++) {
      const s = await this.#call<Record<string, string>>(url);
      if (s[field] === "FINISHED") return;
      if (s[field] === "ERROR" || s[field] === "EXPIRED") throw new Error(`the photo could not be processed (${s[field]})`);
      await Bun.sleep(this.readyDelayMs);
    }
    throw new Error("the photo took too long to process; try Publish again");
  }

  async postToInstagram(draftId: string) {
    const row = this.#draft(draftId, "instagram");
    try {
      const fb = this.#fb(row.project_id);
      const ig = this.#read<StoredIg>("instagram", row.project_id);
      if (!fb || !ig?.ig_user_id || !ig.enabled) throw new Error("Instagram is not connected for this project (Projects → Website → Instagram)");
      if (!row.meta?.cover_upload_id) throw new Error("Instagram posts need a photo: ask the agent to attach the photo (cover_photo)");
      const imageUrl = await this.publisher.uploadMedia(row.project_id, row.meta.cover_upload_id);
      const t = encodeURIComponent(fb.token);
      const created = await this.#call<{ id: string }>(`${this.graphBase}/${ig.ig_user_id}/media`, {
        method: "POST",
        body: new URLSearchParams({ image_url: imageUrl, caption: row.body, access_token: fb.token }),
      });
      await this.#ready(`${this.graphBase}/${created.id}?fields=status_code&access_token=${t}`, "status_code");
      const pub = await this.#call<{ id: string }>(`${this.graphBase}/${ig.ig_user_id}/media_publish`, {
        method: "POST",
        body: new URLSearchParams({ creation_id: created.id, access_token: fb.token }),
      });
      const link = await this.#call<{ permalink?: string }>(`${this.graphBase}/${pub.id}?fields=permalink&access_token=${t}`).catch(() => ({ permalink: undefined }));
      return this.#finish(draftId, row.agent_id, link.permalink ?? "posted", null);
    } catch (err) {
      return this.#finish(draftId, row.agent_id, null, `Instagram: ${(err as Error).message}`);
    }
  }

  async postToThreads(draftId: string) {
    const row = this.#draft(draftId, "threads");
    try {
      const cfg = this.#threads(row.project_id);
      if (!cfg) throw new Error("Threads is not connected for this project (Projects → Website → Threads)");
      const t = encodeURIComponent(cfg.token);
      const params = new URLSearchParams({ text: row.body.slice(0, 500), access_token: cfg.token });
      if (row.meta?.cover_upload_id) {
        params.set("media_type", "IMAGE");
        params.set("image_url", await this.publisher.uploadMedia(row.project_id, row.meta.cover_upload_id));
      } else params.set("media_type", "TEXT");
      const created = await this.#call<{ id: string }>(`${this.threadsBase}/${cfg.userId}/threads`, { method: "POST", body: params });
      await this.#ready(`${this.threadsBase}/${created.id}?fields=status&access_token=${t}`, "status");
      const pub = await this.#call<{ id: string }>(`${this.threadsBase}/${cfg.userId}/threads_publish`, {
        method: "POST",
        body: new URLSearchParams({ creation_id: created.id, access_token: cfg.token }),
      });
      const link = await this.#call<{ permalink?: string }>(`${this.threadsBase}/${pub.id}?fields=permalink&access_token=${t}`).catch(() => ({ permalink: undefined }));
      return this.#finish(draftId, row.agent_id, link.permalink ?? "posted", null);
    } catch (err) {
      return this.#finish(draftId, row.agent_id, null, `Threads: ${(err as Error).message}`);
    }
  }
}
