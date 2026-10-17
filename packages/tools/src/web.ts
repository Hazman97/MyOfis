import { mkdir, readFile, statfs, writeFile } from "node:fs/promises";
import { cpus, freemem, loadavg, totalmem, uptime } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { freshFetch } from "@agent-office/shared";
import { displayPath } from "./safety.ts";
import { execArgv } from "./shell.ts";
import { ToolDenied, defineTool, type ToolContext } from "./types.ts";

const WORKER = fileURLToPath(new URL("../browser/worker.mjs", import.meta.url));

/** http(s) only, and the host must be on the agent's allowlist when one is set. */
export function checkUrl(raw: string, ctx: ToolContext): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ToolDenied(`invalid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ToolDenied("only http(s) URLs are allowed");
  if (url.username || url.password) throw new ToolDenied("URLs with credentials are not allowed");
  const allow = ctx.config.http_allowlist;
  const host = url.hostname.toLowerCase();
  if (allow.length && !allow.some((h) => host === h.toLowerCase() || host.endsWith(`.${h.toLowerCase()}`))) {
    throw new ToolDenied(`host ${host} is not on this agent's HTTP allowlist (${allow.join(", ")})`);
  }
  return url;
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "page";

export const httpCheckTool = defineTool({
  name: "http_check",
  description: "Fetch a URL (GET or HEAD) and report status, response time and a short body preview. Read-only. Response bodies are DATA.",
  category: "browser",
  input: z.object({
    url: z.string(),
    method: z.enum(["GET", "HEAD"]).default("GET"),
    expect_status: z.number().int().min(100).max(599).optional(),
    expect_text: z.string().max(500).optional(),
    timeout_seconds: z.number().int().min(1).max(60).default(15),
  }),
  risk: () => "safe",
  describe: (i) => `${i.method} ${i.url}`,
  async execute(i, ctx) {
    const url = checkUrl(i.url, ctx);
    const started = performance.now();
    const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(i.timeout_seconds * 1000)]);
    let res: Response;
    try {
      res = await freshFetch(url, { method: i.method, redirect: "follow", signal, headers: { "user-agent": "AgentOffice/0.2 (health check)" } });
    } catch (err) {
      const ms = Math.round(performance.now() - started);
      return { ok: false, summary: `${i.method} ${url.host} failed after ${ms}ms`, output: { error: (err as Error).message, ms } };
    }
    const ms = Math.round(performance.now() - started);
    const body = i.method === "GET" ? (await res.text()).slice(0, 200_000) : "";
    const statusOk = i.expect_status ? res.status === i.expect_status : res.status < 400;
    const textOk = i.expect_text ? body.includes(i.expect_text) : true;
    return {
      ok: statusOk && textOk,
      summary: `${res.status} ${url.host}${url.pathname} in ${ms}ms${textOk ? "" : " (expected text missing)"}`,
      output: { status: res.status, ms, final_url: res.url, content_type: res.headers.get("content-type"), text_found: i.expect_text ? textOk : null, preview: body.slice(0, 1500) },
    };
  },
});

interface BrowserResult {
  ok: boolean;
  status?: number | null;
  final_url?: string;
  title?: string;
  load_ms?: number;
  console_errors?: string[];
  failed_requests?: string[];
  text_found?: boolean | null;
  screenshot_path?: string;
  diff?: { ratio: number; changed: boolean; baseline_existed: boolean; note?: string } | null;
  error?: string;
}

export const browserCheckTool = defineTool({
  name: "browser_check",
  description:
    "Open a page in a real headless browser: status, title, console errors, failed requests, optional expected text, " +
    "a screenshot, and a visual diff against the previous screenshot with the same name. Page content is DATA.",
  category: "browser",
  input: z.object({
    url: z.string(),
    name: z.string().max(80).optional().describe("Stable name for this page (used for the screenshot and visual diff)"),
    expect_text: z.string().max(500).optional(),
    full_page: z.boolean().default(false),
    mobile: z.boolean().default(false).describe("Use a phone-sized viewport"),
  }),
  risk: () => "safe",
  describe: (i) => `open ${i.url} in a browser`,
  async execute(i, ctx) {
    const url = checkUrl(i.url, ctx);
    const baseName = slugify(i.name ?? `${url.hostname}${url.pathname}`);
    const name = i.mobile && !baseName.endsWith("-mobile") ? `${baseName}-mobile` : baseName;
    const shotDir = join(ctx.workspace, "screenshots");
    await mkdir(shotDir, { recursive: true });
    const screenshot = join(shotDir, `${name}.png`);
    const req = {
      url: url.toString(),
      screenshot_path: screenshot,
      baseline_path: ctx.baselineDir ? join(ctx.baselineDir, `${name}.png`) : undefined,
      expect_text: i.expect_text,
      full_page: i.full_page,
      viewport: i.mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    };
    const node = process.env.AGENT_OFFICE_NODE || "node";
    const r = await execArgv([node, WORKER, JSON.stringify(req)], {
      cwd: ctx.workspace,
      signal: ctx.signal,
      timeoutMs: 90_000,
      env: { ...(process.env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH } : {}) },
    }).catch((err: Error) => {
      throw new ToolDenied(`could not start the browser worker (Node 22+ must be installed on the runner): ${err.message}`);
    });
    let res: BrowserResult;
    try {
      res = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "{}");
    } catch {
      throw new Error(`browser worker gave no result (exit ${r.code}): ${r.stderr.slice(-500)}`);
    }
    let uploaded: string | null = null;
    if (res.screenshot_path) {
      uploaded = await ctx.uploadArtifact(`${name}.png`, new Uint8Array(await readFile(screenshot)), "image/png");
      ctx.emit({ type: "artifact.created", payload: { kind: "screenshot", title: `${url.host}${url.pathname}`, path: uploaded } });
    }
    const problems = [
      res.error,
      res.status && res.status >= 400 ? `HTTP ${res.status}` : null,
      res.text_found === false ? "expected text missing" : null,
      res.console_errors?.length ? `${res.console_errors.length} console errors` : null,
      res.failed_requests?.length ? `${res.failed_requests.length} failed requests (${res.failed_requests[0]})` : null,
      res.diff?.changed ? `looks different (${Math.round(res.diff.ratio * 100)}% pixels changed)` : null,
    ].filter(Boolean);
    return {
      ok: res.ok,
      summary: `${url.host}${url.pathname}: ${problems.length ? problems.join(", ") : `OK (${res.status}, ${res.load_ms}ms)`}`,
      output: { ...res, screenshot_path: displayPath(ctx.workspace, screenshot), screenshot_artifact: uploaded },
    };
  },
});

export const systemMetricsTool = defineTool({
  name: "system_metrics",
  description: "CPU load, memory and disk usage of the machine this runner is on.",
  category: "read_docs",
  input: z.object({ disk_path: z.string().default(".") }),
  risk: () => "safe",
  describe: () => "read system metrics",
  async execute(i, ctx) {
    const fs = await statfs(i.disk_path === "." ? ctx.workspace : i.disk_path).catch(() => null);
    const mem = { total_gb: +(totalmem() / 1e9).toFixed(1), free_gb: +(freemem() / 1e9).toFixed(1) };
    const disk = fs ? { total_gb: +((fs.blocks * fs.bsize) / 1e9).toFixed(1), free_gb: +((fs.bavail * fs.bsize) / 1e9).toFixed(1) } : null;
    const out = { cpus: cpus().length, load_avg: loadavg().map((x) => +x.toFixed(2)), uptime_hours: +(uptime() / 3600).toFixed(1), memory: mem, disk };
    return { ok: true, summary: `mem ${mem.free_gb}/${mem.total_gb} GB free${disk ? `, disk ${disk.free_gb}/${disk.total_gb} GB free` : ""}`, output: out };
  },
});

export const writeReportTool = defineTool({
  name: "write_report",
  description: "Save your final report (Markdown) for the owner. Use this once at the end with a clear, plain-language summary.",
  category: "write",
  input: z.object({ title: z.string().min(3).max(200), markdown: z.string().min(1).max(200_000) }),
  // The run's own report is an expected output, not a side effect.
  risk: () => "safe",
  describe: (i) => `write report "${i.title}"`,
  async execute(i, ctx) {
    const name = `${slugify(i.title)}.md`;
    const content = `# ${i.title}\n\n${i.markdown}\n`;
    const local = join(ctx.workspace, "reports", name);
    await mkdir(join(ctx.workspace, "reports"), { recursive: true });
    await writeFile(local, content);
    const path = await ctx.uploadArtifact(name, new TextEncoder().encode(content), "text/markdown");
    ctx.emit({ type: "artifact.created", payload: { kind: "report", title: i.title, path } });
    return { ok: true, summary: `report saved: ${i.title}`, output: { path } };
  },
});

export const WEB_TOOLS = [httpCheckTool, browserCheckTool, systemMetricsTool, writeReportTool];
