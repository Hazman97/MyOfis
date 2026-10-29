import type { Context, MiddlewareHandler } from "hono";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { OWNER_WORKSPACE, freshFetch } from "@agent-office/shared";
import type { HubConfig } from "./env.ts";
import { safeEqual, type Secrets } from "./crypto.ts";
import type { Db } from "./db/client.ts";
import { and, eq } from "drizzle-orm";
import { roomMembers, users, workspaces } from "./db/schema.ts";

/** Who is calling (members, 2026-10-19), and which room they are in right now. */
export interface Identity {
  user_id: string;
  email: string;
  name: string;
  role: "owner" | "member";
  /** The room this request works in (cookie `ao_room`, checked); everything is scoped to it. */
  workspace_id: string;
  /** Where they land by default: HQ for the owner, the personal room for a member. */
  home_workspace_id: string;
  /** Set when authenticated via an allowed Cloudflare Access service token (Task 027). */
  via?: "service_token";
  actor?: "assistant";
  service_token_id?: string;
}

/** The web app remembers the chosen room in this cookie (also sent by <img>/<video> and the WebSocket). */
export const ROOM_COOKIE = "ao_room";

const ownerIdentity = (email: string): Identity => ({ user_id: "owner", email, name: "Owner", role: "owner", workspace_id: OWNER_WORKSPACE, home_workspace_id: OWNER_WORKSPACE });

/**
 * Enter the room named by the cookie when allowed: the owner (admin) may enter every room;
 * a member their personal room and the rooms they were added to. Otherwise: their home room.
 */
export function enterRoom(db: Db, me: Identity, req: Request): Identity {
  const wanted = readCookie(req.headers.get("cookie"), ROOM_COOKIE);
  if (!wanted || wanted === me.home_workspace_id) return me;
  const room = db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, wanted)).get();
  if (!room) return me;
  if (me.role === "owner") return { ...me, workspace_id: room.id };
  const member = db.select().from(roomMembers).where(and(eq(roomMembers.workspace_id, room.id), eq(roomMembers.user_id, me.user_id))).get();
  return member ? { ...me, workspace_id: room.id } : me;
}

export const SESSION_COOKIE = "ao_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Two modes, chosen by AUTH_MODE:
 * - local: static LOCAL_AUTH_TOKEN as `Authorization: Bearer` or a signed session cookie from /api/auth/login.
 * - cf-access: verify `Cf-Access-Jwt-Assertion` against the team JWKS (Phase 5).
 */
export interface Authenticator {
  readonly mode: HubConfig["authMode"];
  /** The owner or an enabled member, or null. Works for plain Requests too (WS upgrades). */
  identify(req: Request): Promise<Identity | null>;
  /** True when the request belongs to the owner. */
  isOwner(req: Request): Promise<boolean>;
  /** local mode only: exchange the static token for a cookie value. */
  login(token: string): string | null;
}

export function createAuthenticator(config: HubConfig, secrets: Secrets, db: Db): Authenticator {
  if (config.authMode === "cf-access") return cfAccessAuthenticator(config, db);
  const verifyCookie = (value: string | undefined): boolean => {
    if (!value) return false;
    const [exp, sig] = value.split(".");
    if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
    return secrets.verify(`session:${exp}`, sig);
  };
  // local mode has one person: the owner (members need Cloudflare Access to prove their email)
  const isOwner = async (req: Request) => {
    const auth = req.headers.get("authorization");
    if (auth?.startsWith("Bearer ") && safeEqual(auth.slice(7), config.localAuthToken)) return true;
    return verifyCookie(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
  };
  return {
    mode: "local",
    isOwner,
    async identify(req) {
      return (await isOwner(req)) ? enterRoom(db, ownerIdentity(config.cfAccess.ownerEmail || "owner@local"), req) : null;
    },
    login(token) {
      if (!safeEqual(token, config.localAuthToken)) return null;
      const exp = String(Date.now() + SESSION_TTL_MS);
      return `${exp}.${secrets.sign(`session:${exp}`)}`;
    },
  };
}

/**
 * Cloudflare Access: the tunnel puts the signed `Cf-Access-Jwt-Assertion` header (and the
 * `CF_Authorization` cookie) on every request that passed the Access login. We verify it
 * against the team's public keys, the application audience and the owner's email.
 * Requests that did not come through Access (no or bad JWT) are never the owner.
 */
function cfAccessAuthenticator(config: HubConfig, db: Db): Authenticator {
  const { teamDomain, aud, ownerEmail, certsUrl } = config.cfAccess;
  const issuer = `https://${teamDomain.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  const jwks = createRemoteJWKSet(new URL(certsUrl || `${issuer}/cdn-cgi/access/certs`), {
    [customFetch]: (url: string, init: RequestInit) => freshFetch(url, { ...init, timeoutMs: 10_000 }),
  });
  const owner = ownerEmail.trim().toLowerCase();
  const serviceTokens = (config.cfAccess.ownerServiceTokens ?? []).map((s) => s.trim()).filter(Boolean);
  const identify = async (req: Request): Promise<Identity | null> => {
    const token = req.headers.get("cf-access-jwt-assertion") ?? readCookie(req.headers.get("cookie"), "CF_Authorization");
    if (!token) return null;
    let email: string;
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer, audience: aud, algorithms: ["RS256"] });
      if (typeof payload.email !== "string" || !payload.email.trim()) {
        const cn = typeof payload.common_name === "string" ? payload.common_name.trim() : "";
        if (cn && serviceTokens.some((allowed) => safeEqual(cn, allowed))) {
          return enterRoom(db, { ...ownerIdentity(owner), via: "service_token", actor: "assistant", service_token_id: cn }, req);
        }
        return null;
      }
      email = payload.email.trim().toLowerCase();
    } catch {
      return null;
    }
    if (email === owner) return enterRoom(db, ownerIdentity(email), req);
    // a member the owner invited (Settings → Members); passing Cloudflare Access alone is not enough
    const u = db.select().from(users).where(eq(users.email, email)).get();
    if (!u || u.disabled || u.role !== "member") return null;
    return enterRoom(db, { user_id: u.id, email: u.email, name: u.name, role: "member", workspace_id: u.workspace_id, home_workspace_id: u.workspace_id }, req);
  };
  return {
    mode: "cf-access",
    identify,
    isOwner: async (req) => (await identify(req))?.role === "owner",
    login: () => null,
  };
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/** Any signed-in person (owner or member); `c.get("me")` is their identity. */
export const requireUser =
  (auth: Authenticator): MiddlewareHandler<{ Variables: { me: Identity } }> =>
  async (c, next) => {
    const me = await auth.identify(c.req.raw);
    if (!me) return c.json({ error: "unauthorized" }, 401);
    c.set("me", me);
    await next();
  };

/** Owner-only routes (runners, backups, integrations, skills library, system). Runs after requireUser. */
export const ownerOnly: MiddlewareHandler<{ Variables: { me: Identity } }> = async (c, next) => {
  if (c.get("me")?.role !== "owner") return c.json({ error: "only the owner can do this" }, 403);
  await next();
};

/**
 * Single-place deny list for the owner's assistant service token (`actor: "assistant"`, Task 027).
 * Every matching route returns 403 even though `role === "owner"`.
 */
export const ASSISTANT_DENY_RULES: readonly { label: string; methods?: readonly string[]; pattern: RegExp }[] = [
  { label: "members", pattern: /^\/members(\/|$)/ },
  { label: "rooms create/update/members", methods: ["POST", "PATCH", "PUT", "DELETE"], pattern: /^\/rooms(\/|$)/ },
  { label: "move agents or projects between rooms", methods: ["POST"], pattern: /^\/(agents|projects)\/[^/]+\/move$/ },
  { label: "pause / unpause hub", methods: ["POST"], pattern: /^\/settings\/pause$/ },
  { label: "integrations settings & secrets", pattern: /^\/settings\/integrations(\/|$)/ },
  { label: "social account connections (Zernio/TikTok)", pattern: /^\/social-accounts(\/|$)/ },
  { label: "project publish & social secrets", pattern: /^\/projects\/[^/]+\/(publish|facebook|tiktok|instagram|threads)(\/|$)/ },
  { label: "memory write-approval settings", methods: ["PUT"], pattern: /^\/memory\/settings$/ },
  { label: "providers create/update/delete/scan/models/test/check", methods: ["POST", "PATCH", "PUT", "DELETE"], pattern: /^\/providers(\/|$)/ },
  { label: "runners pairing-code and revoke", methods: ["POST", "PATCH", "PUT", "DELETE"], pattern: /^\/runners(\/|$)/ },
  { label: "backups list and trigger", pattern: /^\/backups(\/|$)/ },
  { label: "open local storage folder", methods: ["POST"], pattern: /^\/storage\/open$/ },
  { label: "skill catalog browse/install", pattern: /^\/skills\/catalog(\/|$)/ },
  { label: "skill import, delete, and assignment", methods: ["POST", "PUT", "PATCH", "DELETE"], pattern: /^\/skills(\/|$)/ },
  { label: "agent skill assignment", methods: ["PUT"], pattern: /^\/agents\/[^/]+\/skills$/ },
  { label: "skill proposal approval", methods: ["POST"], pattern: /^\/proposals\/[^/]+\/decide$/ },
  { label: "draft approval, publishing, scheduling, and takedown", methods: ["POST", "PATCH", "PUT", "DELETE"], pattern: /^\/drafts\/[^/]+\/(decide|publish|schedule|account|update-published|take-down)$/ },
  { label: "tool approval decision (review/dangerous)", methods: ["POST"], pattern: /^\/approvals\/[^/]+\/decide$/ },
  { label: "agent create/delete and external tokens", methods: ["POST", "DELETE"], pattern: /^\/agents(\/[^/]+(\/external-token)?)?$/ },
  { label: "schedules create/update/delete (recurring jobs can post)", methods: ["POST", "PATCH", "PUT", "DELETE"], pattern: /^\/schedules(\/|$)/ },
];

export function isAssistantDenied(method: string, apiSubPath: string): string | null {
  const m = method.toUpperCase();
  const p = apiSubPath.replace(/^\/api(?=\/|$)/, "") || "/";
  for (const rule of ASSISTANT_DENY_RULES) {
    if (rule.methods && !rule.methods.includes(m)) continue;
    if (rule.pattern.test(p)) return rule.label;
  }
  return null;
}

/** Restricted fields on PATCH /api/agents/:id that the assistant may not change. */
const ASSISTANT_FORBIDDEN_AGENT_FIELDS = ["provider", "runner_id", "tools", "permission_level"] as const;
const ASSISTANT_FORBIDDEN_AGENT_CONFIG = [
  "auto_publish", "auto_publish_daily_max", "tiktok_account", "clip_folder", "runtime", "external",
  "shell_allowlist", "read_paths", "http_allowlist",
] as const;

export function assertAssistantAgentPatch(raw: Record<string, unknown>, currentConfig: Record<string, unknown>): string | null {
  for (const f of ASSISTANT_FORBIDDEN_AGENT_FIELDS) {
    if (f in raw) return `assistant may not change agent ${f}`;
  }
  const cfg = typeof raw.config === "object" && raw.config !== null ? (raw.config as Record<string, unknown>) : null;
  if (cfg) {
    for (const k of ASSISTANT_FORBIDDEN_AGENT_CONFIG) {
      if (k in cfg && JSON.stringify(cfg[k]) !== JSON.stringify(currentConfig[k])) return `assistant may not change agent config.${k}`;
    }
  }
  return null;
}

/** Logs every assistant request (method + path, no bodies) and enforces ASSISTANT_DENY_RULES. */
export const assistantGuard: MiddlewareHandler<{ Variables: { me: Identity } }> = async (c, next) => {
  const me = c.get("me");
  if (me?.actor === "assistant") {
    console.info(`[hub] assistant ${c.req.method} ${c.req.path}`);
    const reason = isAssistantDenied(c.req.method, c.req.path);
    if (reason) return c.json({ error: `assistant access denied: ${reason}` }, 403);
  }
  await next();
};
/** Behind Cloudflare Tunnel the hub sees plain http; trust X-Forwarded-Proto for the Secure flag. */
export const isHttps = (c: Context) =>
  (c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.replace(":", "")) === "https";
