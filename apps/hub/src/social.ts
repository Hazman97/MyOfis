import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  ZERNIO_PLATFORMS,
  buildZernioPostBody,
  freshFetch,
  isZernioPlatform,
  type WebPost,
  type ZernioMediaItem,
  type ZernioPlatform,
} from "@agent-office/shared";
import { keyHint, type Secrets } from "./crypto.ts";
import type { Db } from "./db/client.ts";
import { contentDrafts, projects, settings } from "./db/schema.ts";
import type { EventStore } from "./events.ts";
import { HttpError, newId } from "./repo.ts";
import { toDraft } from "./content.ts";
import type { Publisher } from "./publisher.ts";

/**
 * Posting approved captions/media to social accounts.
 * - Zernio (zernio.com): generic posting for TikTok, Instagram (feed/carousel/Reels/Story),
 *   Facebook (feed/Reels/Story), Threads, and YouTube Shorts via POST /v1/posts.
 * - Direct Meta fallback: Facebook Page, Instagram Business/Creator, and Threads for single
 *   photo/text posts when no Zernio account is routed.
 * Tokens never reach the browser or runners.
 */
export type SocialPlatform = ZernioPlatform;

export const ProjectSocialAccountsInput = z.object({
  accounts: z.record(z.enum(ZERNIO_PLATFORMS), z.string().max(100).nullable()),
});

export const FacebookSettingsInput = z.object({
  page_id: z.string().regex(/^\d{5,30}$/).or(z.literal("")),
  /** Write-only. Omit to keep, "" to clear. */
  token: z.string().max(1000).optional(),
});
export const ThreadsSettingsInput = z.object({ token: z.string().max(1000) });
export const TikTokSettingsInput = z.object({
  /** Write-only. Omit to keep, "" to remove. */
  api_key: z.string().max(400).optional(),
  account_id: z.string().max(100).nullable().optional(),
});

/** Settings → Social accounts: one Zernio API key (its TikTok accounts are listed from it). */
export const ZernioConnectInput = z.object({
  label: z.string().trim().min(1).max(60),
  api_key: z.string().trim().min(8).max(400),
});
export const ZernioConnectionPatch = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  /** Per account: a name the owner knows it by, and on/off (off = never posted to). */
  accounts: z.record(z.string().max(100), z.object({ label: z.string().trim().max(60).optional(), enabled: z.boolean().optional() })).optional(),
});
export interface ZernioAccount {
  id: string;
  platform: ZernioPlatform;
  username: string;
  display_name: string;
  followers: number | null;
  needs_reconnection: boolean;
  /** The owner's name for it (defaults to the display name). */
  label: string;
  enabled: boolean;
}
interface StoredZernio {
  id: string;
  label: string;
  key_enc: string;
  key_hint: string;
  accounts: ZernioAccount[];
  checked_at: string;
}
export interface ZernioConnectionPublic {
  id: string;
  label: string;
  key_hint: string;
  accounts: ZernioAccount[];
  checked_at: string;
}
/** An account a draft, an agent or a schedule can post to. */
export interface SocialTarget {
  id: string;
  platform: ZernioPlatform;
  label: string;
  username: string;
  connection: string;
  needs_reconnection: boolean;
}

export interface TikTokAccount {
  id: string;
  username: string;
  display_name: string;
  followers: number | null;
  needs_reconnection: boolean;
}
export interface TikTokPublic {
  has_key: boolean;
  key_hint: string | null;
  account_id: string | null;
  username: string | null;
  display_name: string | null;
  accounts: TikTokAccount[];
}

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
interface StoredTikTok {
  key_enc: string | null;
  key_hint: string | null;
  account_id: string | null;
  username: string | null;
  display_name: string | null;
  accounts: TikTokAccount[];
}
/** A Zernio post whose public URL is not known yet (arrives a few minutes later). */
interface PendingZernioPost {
  draft_id: string;
  project_id: string;
  post_id: string;
  platform?: ZernioPlatform;
  since: string;
  /** The Social accounts connection that posted it (null = the project's older setting). */
  workspace_id?: string;
  conn_id?: string | null;
}
const TIKTOK_PENDING = "tiktok.pending.";
const ZERNIO_PENDING = "zernio.pending.";
const PROJECT_ACCOUNTS_PREFIX = "social.project_accounts.";
const TIKTOK_RESOLVE_MS = 30 * 60_000;

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
    private readonly zernioBase = "https://zernio.com/api/v1",
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

  // ---------------------------------------------------------------- TikTok (Zernio)

  tiktok(projectId: string): TikTokPublic {
    this.#project(projectId);
    const s = this.#read<StoredTikTok>("tiktok", projectId);
    return {
      has_key: !!s?.key_enc,
      key_hint: s?.key_hint ?? null,
      account_id: s?.account_id ?? null,
      username: s?.username ?? null,
      display_name: s?.display_name ?? null,
      accounts: s?.accounts ?? [],
    };
  }

  /** Save the Zernio key ("" removes it) and/or pick the account; a new key lists the accounts at once. */
  async setTikTok(projectId: string, input: z.input<typeof TikTokSettingsInput>): Promise<TikTokPublic> {
    const data = TikTokSettingsInput.parse(input);
    this.#project(projectId);
    const prev = this.#read<StoredTikTok>("tiktok", projectId);
    if (data.api_key === "") {
      this.#write("tiktok", projectId, { key_enc: null, key_hint: null, account_id: null, username: null, display_name: null, accounts: [] } satisfies StoredTikTok);
      return this.tiktok(projectId);
    }
    let s: StoredTikTok = prev ?? { key_enc: null, key_hint: null, account_id: null, username: null, display_name: null, accounts: [] };
    if (data.api_key) {
      const accounts = await this.#tiktokAccounts(data.api_key);
      s = { ...s, key_enc: this.secrets.encrypt(data.api_key), key_hint: keyHint(data.api_key), accounts };
      // keep the chosen account if it is still there; one account = choose it
      if (!accounts.some((a) => a.id === s.account_id)) s.account_id = accounts.length === 1 ? accounts[0]!.id : null;
    }
    if (data.account_id !== undefined) {
      if (data.account_id && !s.accounts.some((a) => a.id === data.account_id)) throw new HttpError(400, "that TikTok account is not connected in Zernio");
      s.account_id = data.account_id;
    }
    const chosen = s.accounts.find((a) => a.id === s.account_id);
    s.username = chosen?.username ?? null;
    s.display_name = chosen?.display_name ?? null;
    this.#write("tiktok", projectId, s);
    return this.tiktok(projectId);
  }

  /** Ask Zernio again for the connected accounts (and whether they need reconnecting). */
  async testTikTok(projectId: string): Promise<TikTokPublic> {
    const s = this.#read<StoredTikTok>("tiktok", projectId);
    if (!s?.key_enc) throw new HttpError(400, "paste the Zernio API key first");
    const accounts = await this.#tiktokAccounts(this.secrets.decrypt(s.key_enc));
    const chosen = accounts.find((a) => a.id === s.account_id);
    this.#write("tiktok", projectId, { ...s, accounts, username: chosen?.username ?? null, display_name: chosen?.display_name ?? null, account_id: chosen ? s.account_id : accounts.length === 1 ? accounts[0]!.id : null });
    return this.tiktok(projectId);
  }

  async #zernio<T>(apiKey: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: T }> {
    const res = await freshFetch(`${this.zernioBase}${path}`, {
      timeoutMs: 60_000,
      method: init.method ?? "GET",
      headers: { authorization: `Bearer ${apiKey}`, ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const body = (await res.json().catch(() => null)) as (T & { error?: string | { message?: string }; message?: string }) | null;
    if (!res.ok) {
      const e = body?.error;
      throw new HttpError(res.status === 429 ? 429 : 400, `Zernio: ${(typeof e === "string" ? e : e?.message) ?? body?.message ?? `HTTP ${res.status}`}`);
    }
    return { status: res.status, body: body as T };
  }

  async #zernioAccounts(apiKey: string, platform?: ZernioPlatform): Promise<(TikTokAccount & { platform: ZernioPlatform })[]> {
    type Acc = { _id: string; platform: string; username?: string; displayName?: string; followersCount?: number; needsReconnection?: boolean; isActive?: boolean };
    const query = platform ? `/accounts?platform=${encodeURIComponent(platform)}&limit=100` : "/accounts?limit=100";
    const { body } = await this.#zernio<{ accounts?: Acc[] }>(apiKey, query);
    return (body.accounts ?? [])
      .filter((a): a is Acc & { platform: ZernioPlatform } => isZernioPlatform(a.platform) && (!platform || a.platform === platform))
      .map((a) => ({
        id: a._id,
        platform: a.platform,
        username: a.username ?? "",
        display_name: a.displayName ?? a.username ?? "",
        followers: a.followersCount ?? null,
        needs_reconnection: !!a.needsReconnection || a.isActive === false,
      }));
  }

  async #tiktokAccounts(apiKey: string): Promise<TikTokAccount[]> {
    return (await this.#zernioAccounts(apiKey, "tiktok")).map(({ platform: _p, ...rest }) => rest);
  }

  #tt(projectId: string): { apiKey: string; accountId: string } | null {
    const s = this.#read<StoredTikTok>("tiktok", projectId);
    return s?.key_enc && s.account_id ? { apiKey: this.secrets.decrypt(s.key_enc), accountId: s.account_id } : null;
  }

  // ---------------------------------------------------------------- Social accounts (Zernio, all platforms)
  //
  // Connect Zernio once (or several keys) and use any of its accounts across TikTok, Instagram,
  // Facebook, Threads and YouTube. Stored per room in settings `zernio.connections.<workspace>`.
  // Older per-project direct Meta / TikTok settings still work as fallbacks.

  #conns(ws: string): StoredZernio[] {
    const row = this.db.select().from(settings).where(eq(settings.key, `zernio.connections.${ws}`)).get();
    return (row?.value as StoredZernio[] | undefined) ?? [];
  }

  #saveConns(ws: string, value: StoredZernio[]): void {
    const k = `zernio.connections.${ws}`;
    this.db.insert(settings).values({ key: k, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
  }

  #publicConn = (c: StoredZernio): ZernioConnectionPublic => ({ id: c.id, label: c.label, key_hint: c.key_hint, accounts: c.accounts, checked_at: c.checked_at });

  zernioConnections(ws: string): ZernioConnectionPublic[] {
    return this.#conns(ws).map(this.#publicConn);
  }

  /** Enabled Zernio accounts in this room (filtered by platform when given), for pickers. */
  socialTargets(ws: string, platform?: ZernioPlatform): SocialTarget[] {
    return this.#conns(ws).flatMap((c) =>
      c.accounts
        .filter((a) => a.enabled && (!platform || a.platform === platform))
        .map((a) => ({
          id: a.id,
          platform: a.platform,
          label: a.label || a.display_name || a.username,
          username: a.username,
          connection: c.label,
          needs_reconnection: a.needs_reconnection,
        })),
    );
  }

  /** Backwards-compatible wrapper for TikTok pickers. */
  tiktokTargets(ws: string): SocialTarget[] {
    return this.socialTargets(ws, "tiktok");
  }

  /** Per-project chosen Zernio account per platform (Settings → Social accounts / Project). */
  projectAccounts(projectId: string): Partial<Record<ZernioPlatform, string>> {
    this.#project(projectId);
    const row = this.db.select().from(settings).where(eq(settings.key, `${PROJECT_ACCOUNTS_PREFIX}${projectId}`)).get();
    return (row?.value as Partial<Record<ZernioPlatform, string>> | undefined) ?? {};
  }

  setProjectAccounts(projectId: string, input: z.input<typeof ProjectSocialAccountsInput>): Partial<Record<ZernioPlatform, string>> {
    const { accounts } = ProjectSocialAccountsInput.parse(input);
    this.#project(projectId);
    const ws = this.#wsOf(projectId);
    const conns = this.#conns(ws);
    const all = new Map(conns.flatMap((c) => c.accounts.map((a) => [a.id, a] as const)));
    const next: Partial<Record<ZernioPlatform, string>> = { ...this.projectAccounts(projectId) };
    for (const [plat, accId] of Object.entries(accounts) as [ZernioPlatform, string | null][]) {
      if (!accId) {
        delete next[plat];
        continue;
      }
      const found = all.get(accId);
      if (!found || found.platform !== plat) {
        throw new HttpError(400, `account ${accId} is not a connected ${plat} account in this room`);
      }
      next[plat] = accId;
    }
    const k = `${PROJECT_ACCOUNTS_PREFIX}${projectId}`;
    this.db.insert(settings).values({ key: k, value: next }).onConflictDoUpdate({ target: settings.key, set: { value: next } }).run();
    return next;
  }

  /** Connect a Zernio API key: all supported platform accounts are listed at once (all on). */
  async addZernio(ws: string, input: z.input<typeof ZernioConnectInput>): Promise<ZernioConnectionPublic> {
    const data = ZernioConnectInput.parse(input);
    const conns = this.#conns(ws);
    const found = await this.#zernioAccounts(data.api_key);
    // an account already listed under another key stays there (one account, one key)
    const taken = new Set(conns.flatMap((c) => c.accounts.map((a) => a.id)));
    const conn: StoredZernio = {
      id: newId("zrn"),
      label: data.label,
      key_enc: this.secrets.encrypt(data.api_key),
      key_hint: keyHint(data.api_key),
      accounts: found.filter((a) => !taken.has(a.id)).map((a) => ({ ...a, label: a.display_name || a.username, enabled: true })),
      checked_at: new Date().toISOString(),
    };
    this.#saveConns(ws, [...conns, conn]);
    return this.#publicConn(conn);
  }

  /** Ask Zernio again (new accounts appear, gone ones are dropped, labels and switches are kept). */
  async refreshZernio(ws: string, id: string): Promise<ZernioConnectionPublic> {
    const conns = this.#conns(ws);
    const c = conns.find((x) => x.id === id);
    if (!c) throw new HttpError(404, "connection not found");
    const found = await this.#zernioAccounts(this.secrets.decrypt(c.key_enc));
    const old = new Map(c.accounts.map((a) => [a.id, a]));
    c.accounts = found.map((a) => ({ ...a, label: old.get(a.id)?.label ?? (a.display_name || a.username), enabled: old.get(a.id)?.enabled ?? true }));
    c.checked_at = new Date().toISOString();
    this.#saveConns(ws, conns);
    return this.#publicConn(c);
  }

  patchZernio(ws: string, id: string, input: z.input<typeof ZernioConnectionPatch>): ZernioConnectionPublic {
    const data = ZernioConnectionPatch.parse(input);
    const conns = this.#conns(ws);
    const c = conns.find((x) => x.id === id);
    if (!c) throw new HttpError(404, "connection not found");
    if (data.label !== undefined) c.label = data.label;
    for (const [accId, patch] of Object.entries(data.accounts ?? {})) {
      const a = c.accounts.find((x) => x.id === accId);
      if (!a) throw new HttpError(404, `account ${accId} is not in this connection`);
      if (patch.label !== undefined) a.label = patch.label;
      if (patch.enabled !== undefined) a.enabled = patch.enabled;
    }
    this.#saveConns(ws, conns);
    return this.#publicConn(c);
  }

  removeZernio(ws: string, id: string): void {
    const conns = this.#conns(ws);
    if (!conns.some((c) => c.id === id)) throw new HttpError(404, "connection not found");
    this.#saveConns(ws, conns.filter((c) => c.id !== id));
  }

  /**
   * Routing rule for Zernio accounts:
   * 1. Draft's explicit `meta.social_account` (if switched off/removed -> null, never swapped);
   * 2. Project's chosen account for this platform (if switched off/removed -> null, never swapped);
   * 3. The only enabled Zernio account of this platform in the room;
   * 4. For TikTok, the legacy per-project TikTok setting;
   * 5. Otherwise null (caller may fall back to legacy direct Meta for single photo/text).
   */
  #socialTarget(
    ws: string,
    platform: ZernioPlatform,
    accountId: string | null,
    projectId: string,
  ): { apiKey: string; accountId: string; connId: string | null } | null {
    const conns = this.#conns(ws);
    const allForPlatform = conns.flatMap((c) => c.accounts.filter((a) => a.platform === platform).map((a) => ({ c, a })));
    const usable = allForPlatform.filter((x) => x.a.enabled);

    if (accountId) {
      const pick = usable.find((x) => x.a.id === accountId);
      if (pick) return { apiKey: this.secrets.decrypt(pick.c.key_enc), accountId: pick.a.id, connId: pick.c.id };
      // Account was explicitly chosen on the draft, and is switched off or removed: NEVER swap for another!
      if (allForPlatform.some((x) => x.a.id === accountId) || usable.length > 0) return null;
      if (platform === "tiktok") {
        const legacy = this.#tt(projectId);
        if (legacy && legacy.accountId === accountId) return { ...legacy, connId: null };
      }
      return null;
    }

    const projAcc = this.projectAccounts(projectId)[platform];
    if (projAcc) {
      const pick = usable.find((x) => x.a.id === projAcc);
      if (pick) return { apiKey: this.secrets.decrypt(pick.c.key_enc), accountId: pick.a.id, connId: pick.c.id };
      // Project explicitly pinned a switched-off/removed account: never swap
      return null;
    }

    if (usable.length === 1) {
      const pick = usable[0]!;
      return { apiKey: this.secrets.decrypt(pick.c.key_enc), accountId: pick.a.id, connId: pick.c.id };
    }

    if (platform === "tiktok") {
      const legacy = this.#tt(projectId);
      return legacy ? { ...legacy, connId: null } : null;
    }
    return null;
  }

  /** Whether legacy direct Meta connection can handle this draft (single photo or text only). */
  #canUseLegacyMeta(draft: { project_id: string; platform: string; meta?: Partial<WebPost> | null }): boolean {
    const meta = draft.meta ?? null;
    if (meta?.social_account) return false;
    if (meta?.video_upload_id) return false;
    const p = meta?.placement;
    if (p && p !== "fb_feed" && p !== "ig_feed" && p !== "threads") return false;
    if ((meta?.images?.length ?? 0) > 1) return false;
    if (draft.platform === "facebook") return !!this.#fb(draft.project_id);
    if (draft.platform === "instagram") {
      const ig = this.#read<StoredIg>("instagram", draft.project_id);
      return !!(ig?.enabled && ig.ig_user_id && this.#fb(draft.project_id));
    }
    if (draft.platform === "threads") return !!this.#threads(draft.project_id);
    return false;
  }

  /** Whether approving this social draft posts it somewhere (Zernio or legacy direct Meta). */
  canPost(draft: { project_id: string; platform: string; meta?: Partial<WebPost> | null }): boolean {
    if (!isZernioPlatform(draft.platform)) return false;
    const ws = this.#wsOf(draft.project_id);
    const target = this.#socialTarget(ws, draft.platform, draft.meta?.social_account ?? null, draft.project_id);
    if (target) return true;
    return this.#canUseLegacyMeta(draft);
  }

  /** Backwards-compatible wrapper for TikTok drafts. */
  canPostTikTok(draft: { project_id: string; meta?: { social_account?: string | null } | null }): boolean {
    return this.canPost({ ...draft, platform: "tiktok" });
  }

  #wsOf(projectId: string): string {
    return this.db.select({ ws: projects.workspace_id }).from(projects).where(eq(projects.id, projectId)).get()?.ws ?? "owner";
  }

  /** The key of a stored connection (link resolving). */
  #connKey(ws: string, connId: string): string | null {
    const c = this.#conns(ws).find((x) => x.id === connId);
    return c ? this.secrets.decrypt(c.key_enc) : null;
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
      } else if (platform === "tiktok") {
        const cfg = this.#tt(projectId);
        if (!cfg) continue;
        try {
          const acc = (await this.#tiktokAccounts(cfg.apiKey)).find((a) => a.id === cfg.accountId);
          if (!acc) problems.push(`${name}: the TikTok account is no longer connected in Zernio. Connect it again in Zernio, then press Test in Projects → ${name} → TikTok.`);
          else if (acc.needs_reconnection) problems.push(`${name}: TikTok @${acc.username} needs reconnecting in Zernio, so TikTok posts will fail until you do.`);
        } catch (err) {
          problems.push(`${name}: could not reach Zernio for TikTok (${(err as Error).message}).`);
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
    // Settings → Social accounts: every Zernio connection of every room (all platforms)
    for (const row of this.db.select().from(settings).all().filter((r) => r.key.startsWith("zernio.connections."))) {
      const ws = row.key.slice("zernio.connections.".length);
      for (const c of row.value as StoredZernio[]) {
        try {
          const found = await this.#zernioAccounts(this.secrets.decrypt(c.key_enc));
          for (const a of c.accounts.filter((x) => x.enabled)) {
            const nowAcc = found.find((f) => f.id === a.id);
            const platLabel = a.platform[0]!.toUpperCase() + a.platform.slice(1);
            if (!nowAcc) problems.push(`${platLabel} "${a.label}" (@${a.username}) is no longer in Zernio connection "${c.label}". Connect it again in Zernio, then press Refresh in Settings → Social accounts.`);
            else if (nowAcc.needs_reconnection) problems.push(`${platLabel} "${a.label}" (@${a.username}) needs reconnecting in Zernio, so its posts will fail until you do.`);
          }
        } catch (err) {
          problems.push(`Could not reach Zernio for connection "${c.label}"${ws !== "owner" ? ` (room ${ws})` : ""}: ${(err as Error).message}`);
        }
      }
    }
    return problems;
  }

  // ---------------------------------------------------------------- what is connected

  configured(platform: string, projectId: string): boolean {
    if (!isZernioPlatform(platform)) return false;
    const ws = this.#wsOf(projectId);
    if (this.socialTargets(ws, platform).length > 0) return true;
    if (platform === "facebook") return !!this.#fb(projectId);
    if (platform === "instagram") {
      const ig = this.#read<StoredIg>("instagram", projectId);
      return !!(ig?.enabled && ig.ig_user_id && this.#fb(projectId));
    }
    if (platform === "threads") return !!this.#threads(projectId);
    if (platform === "tiktok") return !!this.#tt(projectId);
    return false;
  }

  /** Which platforms approving a caption posts to, for this project (agents see this list). */
  connected(projectId: string): SocialPlatform[] {
    return ZERNIO_PLATFORMS.filter((p) => this.configured(p, projectId));
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
        // a failed post: open draft lists reload and show the error
        else emit({ type: "draft.updated", payload: { draft_id: draftId, video_upload_id: null } }, { agent_id: agentId });
        return r;
      }),
    );
  }

  /** Post one approved draft to its platform (Zernio first, legacy Meta fallback for single photo/text). */
  async post(draftId: string) {
    const row = this.db.select().from(contentDrafts).where(eq(contentDrafts.id, draftId)).get();
    if (!row) throw new HttpError(404, "draft not found");
    if (!isZernioPlatform(row.platform)) throw new HttpError(400, `${row.platform} is not connected for posting`);
    if (row.platform === "tiktok" || row.platform === "youtube") return this.postViaZernio(draftId);

    const ws = row.workspace_id ?? "owner";
    const account = (row.meta as Partial<WebPost> | null)?.social_account ?? null;
    const zTarget = this.#socialTarget(ws, row.platform, account, row.project_id);
    if (zTarget) return this.postViaZernio(draftId);
    if (account) {
      // Explicitly selected Zernio account is switched off/removed: never silently fall back or swap
      return this.postViaZernio(draftId);
    }
    if (this.#canUseLegacyMeta({ project_id: row.project_id, platform: row.platform, meta: row.meta })) {
      if (row.platform === "facebook") return this.postToFacebook(draftId);
      if (row.platform === "instagram") return this.postToInstagram(draftId);
      if (row.platform === "threads") return this.postToThreads(draftId);
    }
    return this.postViaZernio(draftId);
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

  async #uploadToZernio(apiKey: string, uploadId: string): Promise<ZernioMediaItem> {
    const f = this.publisher.uploadFile(uploadId);
    if (!f) throw new Error(`media upload ${uploadId} not found`);
    const size = Bun.file(f.file).size;
    const isVideo = f.row.content_type.startsWith("video/");
    const fallbackName = isVideo ? "video.mp4" : "image.png";
    const { body: pre } = await this.#zernio<{ uploadUrl: string; publicUrl: string }>(apiKey, "/media/presign", {
      method: "POST",
      body: { filename: f.row.name.replace(/[^\w.\- ]+/g, "_") || fallbackName, contentType: f.row.content_type, size },
    });
    const put = await freshFetch(pre.uploadUrl, {
      method: "PUT",
      timeoutMs: 30 * 60_000,
      headers: { "content-type": f.row.content_type },
      body: Bun.file(f.file),
    });
    if (!put.ok) throw new Error(`media upload to Zernio failed (HTTP ${put.status})`);
    return { type: isVideo ? "video" : "image", url: pre.publicUrl };
  }

  /**
   * Generic Zernio posting (TikTok, Instagram, Facebook, Threads, YouTube Shorts):
   * presign -> PUT (preserving carousel order) -> POST /v1/posts publishNow.
   * HTTP 207 = failed; missing platformPostUrl is queued for resolvePendingLinks().
   */
  async postViaZernio(draftId: string) {
    const peek = this.db.select().from(contentDrafts).where(eq(contentDrafts.id, draftId)).get();
    if (!peek) throw new HttpError(404, "draft not found");
    if (!isZernioPlatform(peek.platform)) throw new HttpError(400, `${peek.platform} is not supported by Zernio`);
    const platform = peek.platform;
    const row = this.#draft(draftId, platform);
    const platLabel = platform[0]!.toUpperCase() + platform.slice(1);
    try {
      const ws = row.workspace_id ?? "owner";
      const meta = (row.meta as Partial<WebPost> | null) ?? null;
      const account = meta?.social_account ?? null;
      const cfg = this.#socialTarget(ws, platform, account, row.project_id);
      if (!cfg) {
        throw new Error(
          account
            ? `the ${platLabel} account on this draft is switched off or no longer connected: pick another one on the draft, or turn it on in Settings → Social accounts`
            : `no ${platLabel} account to post to: connect Zernio in Settings → Social accounts (and pick the account on the draft or project when there are several)`,
        );
      }

      const mediaItems: ZernioMediaItem[] = [];
      if (meta?.video_upload_id) {
        mediaItems.push(await this.#uploadToZernio(cfg.apiKey, meta.video_upload_id));
      } else if (meta?.images?.length) {
        // Keep exact display order for carousels
        for (const imgId of meta.images) {
          mediaItems.push(await this.#uploadToZernio(cfg.apiKey, imgId));
        }
      } else if (meta?.cover_upload_id) {
        mediaItems.push(await this.#uploadToZernio(cfg.apiKey, meta.cover_upload_id));
      }

      if ((platform === "tiktok" || platform === "youtube") && !mediaItems.some((m) => m.type === "video")) {
        throw new Error(`${platLabel} posts need a video: this draft has none`);
      }
      if (platform === "instagram" && mediaItems.length === 0) {
        throw new Error("Instagram posts need at least one image or video");
      }

      let tiktokPrivacy: string | undefined;
      if (platform === "tiktok") {
        const info = await this.#zernio<{ privacyLevels?: { value: string }[] }>(
          cfg.apiKey,
          `/accounts/${encodeURIComponent(cfg.accountId)}/tiktok/creator-info`,
        ).catch(() => null);
        const levels = info?.body.privacyLevels?.map((l) => l.value) ?? [];
        tiktokPrivacy = !levels.length || levels.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : levels[0]!;
      }

      const payload = buildZernioPostBody(
        { platform, title: row.title, body: row.body, meta },
        { accountId: cfg.accountId, mediaItems, tiktokPrivacy },
      );

      type PostOut = { post?: { _id?: string; status?: string; platforms?: { status?: string; platformPostUrl?: string | null; errorMessage?: string }[] } };
      const { status, body } = await this.#zernio<PostOut>(cfg.apiKey, "/posts", { method: "POST", body: payload });
      const plat = body.post?.platforms?.[0];
      // 207 = Zernio accepted the request but the post failed
      if (status === 207 || body.post?.status === "failed" || plat?.status === "failed") {
        throw new Error(plat?.errorMessage ?? `${platLabel} refused the post`);
      }
      if (body.post?._id && !plat?.platformPostUrl) {
        const pending: PendingZernioPost = {
          draft_id: draftId,
          project_id: row.project_id,
          post_id: body.post._id,
          platform,
          since: new Date().toISOString(),
          workspace_id: ws,
          conn_id: cfg.connId,
        };
        this.db
          .insert(settings)
          .values({ key: `${ZERNIO_PENDING}${draftId}`, value: pending })
          .onConflictDoUpdate({ target: settings.key, set: { value: pending } })
          .run();
      }
      return this.#finish(draftId, row.agent_id, plat?.platformPostUrl ?? "posted", null);
    } catch (err) {
      return this.#finish(draftId, row.agent_id, null, `${platLabel}: ${(err as Error).message}`);
    }
  }

  /** Backwards-compatible wrapper for TikTok posting. */
  async postToTikTok(draftId: string) {
    return this.postViaZernio(draftId);
  }

  /** Fill in Zernio post links that were not known at posting time (run every minute; gives up after 30 min). */
  async resolvePendingLinks(now = new Date()): Promise<{ draft_id: string; url: string }[]> {
    const done: { draft_id: string; url: string }[] = [];
    const pendingRows = this.db
      .select()
      .from(settings)
      .all()
      .filter((r) => r.key.startsWith(ZERNIO_PENDING) || r.key.startsWith(TIKTOK_PENDING));
    for (const row of pendingRows) {
      const p = row.value as PendingZernioPost;
      const drop = () => this.db.delete(settings).where(eq(settings.key, row.key)).run();
      if (now.getTime() - Date.parse(p.since) > TIKTOK_RESOLVE_MS) {
        drop();
        continue;
      }
      const connKey = p.conn_id ? this.#connKey(p.workspace_id ?? "owner", p.conn_id) : null;
      const cfg = connKey ? { apiKey: connKey } : this.#tt(p.project_id);
      if (!cfg) {
        drop();
        continue;
      }
      const platLabel = p.platform ? p.platform[0]!.toUpperCase() + p.platform.slice(1) : "TikTok";
      try {
        const { body } = await this.#zernio<{ post?: { platforms?: { platformPostUrl?: string | null; status?: string; errorMessage?: string }[] } }>(
          cfg.apiKey,
          `/posts/${encodeURIComponent(p.post_id)}`,
        );
        const plat = body.post?.platforms?.[0];
        // either way open draft lists reload (draft.updated), so a failed post stops looking live
        const changed = (set: Partial<typeof contentDrafts.$inferInsert>) =>
          this.store.transact((tx, emit) => {
            const updatedRow = tx.update(contentDrafts).set(set).where(eq(contentDrafts.id, p.draft_id)).returning().get();
            if (updatedRow) emit({ type: "draft.updated", payload: { draft_id: p.draft_id, video_upload_id: null } }, { agent_id: updatedRow.agent_id });
          });
        if (plat?.status === "failed") {
          changed({ status: "approved", published_url: null, publish_error: `${platLabel}: ${plat.errorMessage ?? "the post failed"}`.slice(0, 500) });
          drop();
        } else if (plat?.platformPostUrl) {
          changed({ published_url: plat.platformPostUrl });
          done.push({ draft_id: p.draft_id, url: plat.platformPostUrl });
          drop();
        }
      } catch {
        /* try again next minute */
      }
    }
    return done;
  }

  /** Backwards-compatible wrapper for resolving delayed Zernio links. */
  async resolveTikTokLinks(now = new Date()): Promise<{ draft_id: string; url: string }[]> {
    return this.resolvePendingLinks(now);
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
