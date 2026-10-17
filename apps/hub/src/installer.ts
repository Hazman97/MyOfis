import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "./db/client.ts";
import { pairingCodes } from "./db/schema.ts";
import { hashToken, normalizeCode } from "./crypto.ts";

/**
 * One-line runner install for another PC: the hub serves an install script with its own
 * URL and a pairing code filled in, plus the runner bundled into one file (Bun.build).
 * Everything is gated by a live pairing code, so nothing is downloadable without one.
 */
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const RUNNER_ENTRY = here("../../runner/src/index.ts");
const BROWSER_WORKER = here("../../../packages/tools/browser/worker.mjs");

export type ScriptKind = "sh" | "ps1";

/** True when the code exists, is unused and has not expired. Does not consume it. */
export function pairingCodeIsLive(db: Db, code: string): boolean {
  if (!/^[A-Za-z0-9-]{4,20}$/.test(code)) return false;
  const row = db
    .select()
    .from(pairingCodes)
    .where(and(eq(pairingCodes.code_hash, hashToken(normalizeCode(code))), isNull(pairingCodes.used_at), gt(pairingCodes.expires_at, new Date().toISOString())))
    .get();
  return !!row;
}

/** Base URL the other PC used to reach us (works for LAN IPs and the Cloudflare hostname). */
export function requestBaseUrl(url: string, headers: { host?: string; proto?: string }): string | null {
  const u = new URL(url);
  const host = headers.host ?? u.host;
  const proto = (headers.proto ?? u.protocol.replace(":", "")).split(",")[0]!.trim();
  // both end up inside a shell script: allow plain host[:port] only
  if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$|^\[[0-9a-fA-F:]+\](:\d{1,5})?$/.test(host) || !["http", "https"].includes(proto)) return null;
  return `${proto}://${host}`;
}

export function installScript(kind: ScriptKind, hubUrl: string, code: string): string {
  const template = readFileSync(here(`./installer/install.${kind}`), "utf8").replace(/\r\n/g, "\n");
  const text = template.replaceAll("__HUB__", hubUrl).replaceAll("__CODE__", code);
  return kind === "ps1" ? text.replace(/\n/g, "\r\n") : text;
}

let bundle: { js: string; at: number } | null = null;
const BUNDLE_TTL_MS = 60_000;

/** The runner (with shared + tools) as one JS file for Bun. Rebuilt at most once a minute. */
export async function runnerBundle(): Promise<string> {
  if (bundle && Date.now() - bundle.at < BUNDLE_TTL_MS) return bundle.js;
  const out = await Bun.build({ entrypoints: [RUNNER_ENTRY], target: "bun" });
  if (!out.success) throw new Error(`runner bundle failed: ${out.logs.map(String).join("; ")}`);
  bundle = { js: await out.outputs[0]!.text(), at: Date.now() };
  return bundle.js;
}

export const browserWorker = () => readFileSync(BROWSER_WORKER, "utf8");
