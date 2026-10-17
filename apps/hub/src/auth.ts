import type { Context, MiddlewareHandler } from "hono";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { freshFetch } from "@agent-office/shared";
import type { HubConfig } from "./env.ts";
import { safeEqual, type Secrets } from "./crypto.ts";

export const SESSION_COOKIE = "ao_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Two modes, chosen by AUTH_MODE:
 * - local: static LOCAL_AUTH_TOKEN as `Authorization: Bearer` or a signed session cookie from /api/auth/login.
 * - cf-access: verify `Cf-Access-Jwt-Assertion` against the team JWKS (Phase 5).
 */
export interface Authenticator {
  readonly mode: HubConfig["authMode"];
  /** True when the request belongs to the owner. Works for plain Requests too (WS upgrades). */
  isOwner(req: Request): Promise<boolean>;
  /** local mode only: exchange the static token for a cookie value. */
  login(token: string): string | null;
}

export function createAuthenticator(config: HubConfig, secrets: Secrets): Authenticator {
  if (config.authMode === "cf-access") return cfAccessAuthenticator(config);
  const verifyCookie = (value: string | undefined): boolean => {
    if (!value) return false;
    const [exp, sig] = value.split(".");
    if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
    return secrets.verify(`session:${exp}`, sig);
  };
  return {
    mode: "local",
    async isOwner(req) {
      const auth = req.headers.get("authorization");
      if (auth?.startsWith("Bearer ") && safeEqual(auth.slice(7), config.localAuthToken)) return true;
      return verifyCookie(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
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
function cfAccessAuthenticator(config: HubConfig): Authenticator {
  const { teamDomain, aud, ownerEmail, certsUrl } = config.cfAccess;
  const issuer = `https://${teamDomain.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  const jwks = createRemoteJWKSet(new URL(certsUrl || `${issuer}/cdn-cgi/access/certs`), {
    [customFetch]: (url: string, init: RequestInit) => freshFetch(url, { ...init, timeoutMs: 10_000 }),
  });
  const owner = ownerEmail.trim().toLowerCase();
  return {
    mode: "cf-access",
    async isOwner(req) {
      const token = req.headers.get("cf-access-jwt-assertion") ?? readCookie(req.headers.get("cookie"), "CF_Authorization");
      if (!token) return false;
      try {
        const { payload } = await jwtVerify(token, jwks, { issuer, audience: aud, algorithms: ["RS256"] });
        return typeof payload.email === "string" && payload.email.toLowerCase() === owner;
      } catch {
        return false;
      }
    },
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

export const requireOwner =
  (auth: Authenticator): MiddlewareHandler =>
  async (c, next) => {
    if (!(await auth.isOwner(c.req.raw))) return c.json({ error: "unauthorized" }, 401);
    await next();
  };

/** Behind Cloudflare Tunnel the hub sees plain http; trust X-Forwarded-Proto for the Secure flag. */
export const isHttps = (c: Context) =>
  (c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.replace(":", "")) === "https";
