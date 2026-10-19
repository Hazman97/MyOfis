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
  const identify = async (req: Request): Promise<Identity | null> => {
    const token = req.headers.get("cf-access-jwt-assertion") ?? readCookie(req.headers.get("cookie"), "CF_Authorization");
    if (!token) return null;
    let email: string;
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer, audience: aud, algorithms: ["RS256"] });
      if (typeof payload.email !== "string") return null;
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

/** Behind Cloudflare Tunnel the hub sees plain http; trust X-Forwarded-Proto for the Secure flag. */
export const isHttps = (c: Context) =>
  (c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.replace(":", "")) === "https";
