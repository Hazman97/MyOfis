import type { Context, MiddlewareHandler } from "hono";
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
  if (config.authMode === "cf-access") {
    throw new Error(
      "AUTH_MODE=cf-access is planned for Phase 5 and not implemented yet. Use AUTH_MODE=local and keep HUB_HOST=127.0.0.1.",
    );
  }
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
