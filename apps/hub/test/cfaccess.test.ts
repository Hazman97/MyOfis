import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from "jose";
import { createTestEnv, type TestEnv } from "./helpers.ts";

/** A stand-in Cloudflare Access team: its JWKS endpoint and a way to mint Access JWTs. */
const TEAM = "myofis.cloudflareaccess.com";
const AUD = "aud-tag-0123456789abcdef";
const OWNER = "owner@example.com";
let privateKey: CryptoKey;
let otherKey: CryptoKey;
let jwks: ReturnType<typeof Bun.serve>;
let env: TestEnv;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair("RS256")).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  jwks = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ keys: [jwk] }) });
});
afterAll(() => jwks?.stop(true));
afterEach(async () => {
  await env?.close();
});

const mint = (claims: { email?: string; aud?: string; iss?: string; exp?: string | number }, key = privateKey) =>
  new SignJWT({ email: claims.email ?? OWNER })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(claims.iss ?? `https://${TEAM}`)
    .setAudience(claims.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(claims.exp ?? "1h")
    .sign(key);

const start = () =>
  createTestEnv({}, { authMode: "cf-access", cfAccess: { teamDomain: TEAM, aud: AUD, ownerEmail: OWNER, certsUrl: `http://127.0.0.1:${jwks.port}/certs` } });

describe("AUTH_MODE=cf-access", () => {
  test("only a valid Access JWT for the owner's email gets in", async () => {
    env = await start();
    const get = (headers: Record<string, string>) => fetch(`${env.hub.url}/api/agents`, { headers }).then((r) => r.status);
    expect(await get({ "cf-access-jwt-assertion": await mint({}) })).toBe(200);
    expect(await get({ cookie: `CF_Authorization=${await mint({ email: "OWNER@example.com" })}` })).toBe(200);
    expect(await get({})).toBe(401);
    expect(await get({ "cf-access-jwt-assertion": await mint({ email: "someone@else.com" }) })).toBe(401);
    expect(await get({ "cf-access-jwt-assertion": await mint({ aud: "other-app" }) })).toBe(401);
    expect(await get({ "cf-access-jwt-assertion": await mint({ iss: "https://evil.cloudflareaccess.com" }) })).toBe(401);
    expect(await get({ "cf-access-jwt-assertion": await mint({}, otherKey) })).toBe(401);
    expect(await get({ "cf-access-jwt-assertion": await mint({ exp: Math.floor(Date.now() / 1000) - 60 }) })).toBe(401);
    // the static token means nothing in this mode
    expect(await get({ authorization: "Bearer test-owner-token-123456" })).toBe(401);
  });

  test("login page learns the mode; token login is refused; runners still pair with a code", async () => {
    env = await start();
    expect(await fetch(`${env.hub.url}/api/auth/mode`).then((r) => r.json())).toEqual({ mode: "cf-access" });
    const login = await fetch(`${env.hub.url}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "x" }) });
    expect(login.status).toBe(401);
    const jwt = await mint({});
    const code = await fetch(`${env.hub.url}/api/runners/pairing-code`, { method: "POST", headers: { "cf-access-jwt-assertion": jwt, origin: env.hub.url } }).then((r) => r.json() as Promise<{ code: string }>);
    const pair = await fetch(`${env.hub.url}/api/runners/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: code.code, name: "far-pc" }) });
    expect(pair.status).toBe(200);
  });
});
