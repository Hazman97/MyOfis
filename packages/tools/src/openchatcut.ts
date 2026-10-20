import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { freshFetch } from "@agent-office/shared";
import { scrubbedEnv } from "./safety.ts";
import { ToolDenied, defineTool, type ToolContext } from "./types.ts";
import { attachmentFile } from "./video.ts";

/**
 * OpenChatCut (github.com/0xsline/OpenChatCut, owner choice 2026-10-20): a desktop video editor
 * with a real multitrack timeline that external agents drive through MCP (Streamable HTTP on
 * localhost:5199). The agent's edits appear in the open editor as a proposal the owner previews,
 * approves or undoes, so he can watch the AI edit live. Runs on the runner PC; the MCP token stays
 * there (OPENCHATCUT_MCP_TOKEN, else the app's own ~/.openchatcut/mcp-token).
 */

const BASE = () => (process.env.OPENCHATCUT_URL ?? "http://localhost:5199").replace(/\/$/, "");
const PROTOCOL = "2025-06-18";
/**
 * OpenChatCut only imports files under its AGENT_IMPORT_ROOTS, and keeps pointing at them after
 * the run, so videos are copied out of the throwaway run workspace into one fixed folder first.
 * The owner adds this folder to AGENT_IMPORT_ROOTS once (a user environment variable; the app reads it at start).
 */
export const openchatcutMediaDir = () =>
  process.env.OPENCHATCUT_MEDIA_DIR?.trim() || join(process.env.USERPROFILE ?? homedir(), "Videos", "MyOfis-OpenChatCut");

/** Long answers (template lists) are cut: each one is re-read by the model on every later step. */
const RESULT_MAX = 5_000;

export function openchatcutToken(): string | null {
  const env = process.env.OPENCHATCUT_MCP_TOKEN?.trim();
  if (env) return env;
  const file = join(process.env.USERPROFILE ?? homedir(), ".openchatcut", "mcp-token");
  try {
    return existsSync(file) ? readFileSync(file, "utf8").trim() || null : null;
  } catch {
    return null;
  }
}

/** A JSON-RPC answer from a Streamable HTTP MCP server: plain JSON, or SSE `data:` lines. */
export function parseMcpBody(text: string, id: number): { result?: unknown; error?: { message?: string } } | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    try {
      const msg = JSON.parse(line.slice(5));
      if (msg.id === id) return msg;
    } catch {
      /* a partial or other event */
    }
  }
  return null;
}

/**
 * One MCP session per agent, kept across runs. OpenChatCut ties the project binding and every edit
 * session to the MCP transport, and each chat message is a new run: a fresh transport per run left
 * the last message's edit session "stale" and the agent blaming a second editor tab (2026-10-20).
 */
const sessions = new Map<string, { id: string | null; next: number }>();
const sessionKey = (ctx: ToolContext) => ctx.agent.slug;

/**
 * The session id (and targeted project) is also kept on disk: OpenChatCut releases a transport's
 * edit sessions only on DELETE or after 60 idle minutes, so a runner restart that forgot the id
 * locked the agent out of its own draft for an hour. After a restart the same transport is reused.
 */
type Saved = Record<string, { id?: string | null; target?: string }>;
const savedFile = () => process.env.OPENCHATCUT_SESSION_FILE?.trim() || join(process.env.LOCALAPPDATA ?? join(homedir(), ".cache"), "MyOfis", "openchatcut-sessions.json");

function readSaved(): Saved {
  try {
    return JSON.parse(readFileSync(savedFile(), "utf8")) as Saved;
  } catch {
    return {};
  }
}

function saveSession(key: string, patch: { id?: string | null; target?: string }): void {
  try {
    const all = readSaved();
    all[key] = { ...all[key], ...patch };
    mkdirSync(dirname(savedFile()), { recursive: true });
    writeFileSync(savedFile(), JSON.stringify(all, null, 2));
  } catch {
    /* only a convenience */
  }
}

/** This agent's session: from memory, else from the file (after a runner restart). */
function sessionOf(ctx: ToolContext): { id: string | null; next: number } {
  let s = sessions.get(sessionKey(ctx));
  if (!s) {
    const saved = readSaved()[sessionKey(ctx)];
    s = { id: saved?.id ?? null, next: 1 };
    sessions.set(sessionKey(ctx), s);
    if (saved?.target && !targets.has(sessionKey(ctx))) targets.set(sessionKey(ctx), saved.target);
  }
  return s;
}

async function rpc(ctx: ToolContext, method: string, params: Record<string, unknown>, notify = false, retried = false): Promise<unknown> {
  const token = openchatcutToken();
  if (!token) throw new ToolDenied("OpenChatCut is not set up on this PC (install it and open it once; the token is in ~/.openchatcut/mcp-token). Tell the owner.");
  const s = sessionOf(ctx);
  const id = s.next++;
  let res: Response;
  try {
    res = await freshFetch(`${BASE()}/api/external-mcp/mcp`, {
      method: "POST",
      timeoutMs: 120_000,
      signal: ctx.signal,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL,
        ...(s.id ? { "mcp-session-id": s.id } : {}),
      },
      body: JSON.stringify(notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params }),
    });
  } catch (err) {
    throw new ToolDenied(`OpenChatCut is not running on this PC (${(err as Error).message}). Ask the owner to open the OpenChatCut app.`);
  }
  const sid = res.headers.get("mcp-session-id");
  if (sid && sid !== s.id) {
    s.id = sid;
    saveSession(sessionKey(ctx), { id: sid });
  }
  if (notify) return null;
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw new ToolDenied("OpenChatCut refused the MCP token: open the app once so it writes ~/.openchatcut/mcp-token, or set OPENCHATCUT_MCP_TOKEN on the runner");
  if (res.status === 404 && s.id) {
    // the app restarted (or the session expired): open a new session and send this once more
    sessions.delete(sessionKey(ctx));
    saveSession(sessionKey(ctx), { id: null });
    if (retried || method === "initialize") throw new ToolDenied("the OpenChatCut connection was reset (the app restarted?): call target_project again, then begin_edit_session {reuseExisting: true}");
    await ensureSession(ctx);
    const target = targets.get(sessionKey(ctx));
    if (target && method === "tools/call" && params.name !== "target_project") await rpc(ctx, "tools/call", { name: "target_project", arguments: { projectId: target } }, false, true);
    return rpc(ctx, method, params, notify, true);
  }
  const msg = parseMcpBody(text, id);
  if (!msg) throw new ToolDenied(`OpenChatCut gave no answer (HTTP ${res.status})`);
  if (msg.error) throw new ToolDenied(`OpenChatCut: ${msg.error.message ?? "error"}`);
  return msg.result;
}

async function ensureSession(ctx: ToolContext): Promise<void> {
  if (sessionOf(ctx).id) return;
  await rpc(ctx, "initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "agent-office", version: "1.0" } });
  await rpc(ctx, "notifications/initialized", {}, true);
}

/** Call one OpenChatCut MCP tool; the text it returns (trimmed). */
export async function callOpenChatCut(ctx: ToolContext, tool: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  await ensureSession(ctx);
  const r = (await rpc(ctx, "tools/call", { name: tool, arguments: args })) as { content?: { type: string; text?: string }[]; isError?: boolean; structuredContent?: unknown };
  const text = (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n") || (r.structuredContent ? JSON.stringify(r.structuredContent) : "");
  return { text: text.length > RESULT_MAX ? `${text.slice(0, RESULT_MAX)}\n… (cut; ask for a narrower view)` : text, isError: !!r.isError };
}

/**
 * The editor window (2026-10-20). Edits need an open editor page for the project, and a page in a
 * normal browser tab is throttled when hidden: its 30 s heartbeat comes late, OpenChatCut drops it
 * (45 s), the page reconnects as a new editor instance and every binding and edit session goes
 * stale. So the bridge opens its own Edge/Chrome app window with throttling off (it stays connected
 * when minimised) whenever no editor of the project is connected, and re-binds after a drop.
 * OPENCHATCUT_EDITOR_WINDOW=0 turns this off; OPENCHATCUT_BROWSER picks the browser.
 */
const editorWindows = new Map<string, number>();
/** The project each agent last targeted, to re-bind after the editor dropped. */
const targets = new Map<string, string>();

export function editorBrowser(): string | null {
  const env = process.env.OPENCHATCUT_BROWSER?.trim();
  if (env) return existsSync(env) ? env : null;
  if (process.platform !== "win32") return null;
  const x86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const pf = process.env.ProgramFiles ?? "C:\\Program Files";
  const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  return (
    [
      join(x86, "Microsoft", "Edge", "Application", "msedge.exe"),
      join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
      join(pf, "Google", "Chrome", "Application", "chrome.exe"),
      join(local, "Google", "Chrome", "Application", "chrome.exe"),
    ].find((p) => existsSync(p)) ?? null
  );
}

/** A separate profile (so it is its own browser process) with background throttling off. */
export const editorWindowArgs = (url: string, profile: string): string[] => [
  `--user-data-dir=${profile}`,
  `--app=${url}`,
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--no-first-run",
  "--no-default-browser-check",
  "--window-size=1500,950",
];

const alive = (pid: number | undefined): boolean => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function editorConnected(ctx: ToolContext, projectId: string): Promise<boolean> {
  const r = await callOpenChatCut(ctx, "openchatcut_status", {});
  try {
    return ((JSON.parse(r.text) as { connectedProjectIds?: string[] }).connectedProjectIds ?? []).includes(projectId);
  } catch {
    return false;
  }
}

/** Make sure an editor of the project is connected; opens the window when none is. A note for the model, or "". */
export async function ensureEditor(ctx: ToolContext, projectId: string): Promise<string> {
  if (process.env.OPENCHATCUT_EDITOR_WINDOW === "0" || !/^[\w-]{1,100}$/.test(projectId)) return "";
  if (await editorConnected(ctx, projectId)) return "";
  // a window we opened that is still running reconnects by itself; otherwise open one
  if (!alive(editorWindows.get(projectId))) {
    const browser = editorBrowser();
    if (!browser) return "No OpenChatCut editor is open and no Edge/Chrome was found to open one: ask the owner to open the project in the OpenChatCut app.";
    const profile = join(process.env.LOCALAPPDATA ?? join(homedir(), ".cache"), "MyOfis", "openchatcut-editor");
    mkdirSync(profile, { recursive: true });
    const child = spawn(browser, editorWindowArgs(`${BASE()}/#/editor/${projectId}`, profile), { detached: true, stdio: "ignore", env: scrubbedEnv() });
    child.on("error", () => {});
    child.unref();
    if (child.pid) editorWindows.set(projectId, child.pid);
  }
  for (let i = 0; i < 25; i++) {
    if (ctx.signal.aborted) break;
    await Bun.sleep(2000);
    if (await editorConnected(ctx, projectId)) return "The OpenChatCut editor window for this project is open on the owner's PC (opened by the office); the owner can watch there.";
  }
  return "The editor window did not connect within 50 s: ask the owner to check the OpenChatCut app is running.";
}

/** An answer that means the editor dropped or the binding went stale (safe to re-bind and retry: nothing was applied). */
export const editorDropped = (text: string): boolean =>
  /"outcome":"(rejected|stale)"/.test(text) && /stale|no openchatcut editor is connected|not connected|binding|editor instance/i.test(text);

export const openchatcutTool = defineTool({
  name: "openchatcut",
  description:
    "Drive the OpenChatCut video editor on this PC (a full multitrack timeline the owner can watch). Calls one of its MCP tools by name. " +
    'tool "tools/list" lists them all. Usual flow: list_projects or create_project (1080×1920, 30 fps for TikTok) → ' +
    "target_project (opens the editor window on the owner's PC by itself) → begin_edit_session {reuseExisting: true} → openchatcut_import your videos → read_timeline / read_transcript → " +
    "edit_item, split_item, set_item_timing, add_motion_graphic, add_audio, edit_captions, manage_effects (pass editSessionId every time) → review_edit_session → get_edit_session until applied.",
  category: "write",
  input: z.object({
    tool: z.string().min(1).max(80).describe('An OpenChatCut tool name, "tools/list", or "tools/describe" {name}'),
    arguments: z.record(z.string(), z.unknown()).default({}),
  }),
  risk: () => "safe",
  describe: (i) => `OpenChatCut ${i.tool}`,
  async execute(i, ctx) {
    if (i.tool === "tools/describe") {
      await ensureSession(ctx);
      const name = String(i.arguments.name ?? "");
      const r = (await rpc(ctx, "tools/list", {})) as { tools?: { name: string; description?: string; inputSchema?: unknown }[] };
      const t = (r.tools ?? []).find((x) => x.name === name);
      if (!t) return { ok: false, summary: `no OpenChatCut tool ${name}`, output: `No tool named "${name}". tool "tools/list" lists them.` };
      const text = JSON.stringify({ name: t.name, description: t.description, arguments: t.inputSchema });
      return { ok: true, summary: `OpenChatCut ${name} arguments`, output: text.length > RESULT_MAX ? `${text.slice(0, RESULT_MAX)}…` : text };
    }
    if (i.tool === "tools/list") {
      await ensureSession(ctx);
      const r = (await rpc(ctx, "tools/list", {})) as { tools?: { name: string; description?: string }[] };
      const all = r.tools ?? [];
      // names only when the list is long (131 with an editor open): descriptions cost ~5k tokens on every later step
      if (all.length > 20) {
        return { ok: true, summary: `${all.length} OpenChatCut tools`, output: `${all.map((t) => t.name).join(", ")}\nCall a tool directly; for its arguments use tool "tools/describe" {name: "<tool name>"}.` };
      }
      const tools = all.map((t) => ({ name: t.name, does: (t.description ?? "").split(/(?<=\.)\s/)[0]?.slice(0, 160) }));
      return { ok: true, summary: `${tools.length} OpenChatCut tools`, output: tools };
    }
    // deleting projects is the owner's job, in the app
    if (/delete/i.test(i.tool) && !/^(remove_item|discard_edit_session)$/.test(i.tool)) throw new ToolDenied("deleting in OpenChatCut is done by the owner in the app");
    const project = typeof i.arguments.projectId === "string" ? i.arguments.projectId : null;
    let note = "";
    if (i.tool === "target_project" && project) {
      targets.set(sessionKey(ctx), project);
      saveSession(sessionKey(ctx), { target: project });
      note = await ensureEditor(ctx, project);
    }
    let r = await callOpenChatCut(ctx, i.tool, i.arguments);
    // the editor reconnected (or was closed): open it again if needed, re-bind, retry once
    const target = targets.get(sessionKey(ctx));
    if (target && i.tool !== "target_project" && editorDropped(r.text)) {
      note = await ensureEditor(ctx, target);
      await callOpenChatCut(ctx, "target_project", { projectId: target });
      r = await callOpenChatCut(ctx, i.tool, i.arguments);
      note = `(The editor had reconnected; the office re-bound it and retried.) ${note}`.trim();
    }
    return { ok: !r.isError, summary: `${i.tool}${r.isError ? " failed" : ""}`, output: note ? `${r.text}\n${note}` : r.text };
  },
});

export const openchatcutImportTool = defineTool({
  name: "openchatcut_import",
  description:
    "Put a video the owner sent (or a clip from clip_library) into the OpenChatCut project's media pool, by its number. Needs an edit session (begin_edit_session) on the targeted project.",
  category: "write",
  input: z.object({
    video: z.number().int().min(1).max(10).describe("Which file (1 = first)"),
    editSessionId: z.string().min(1).max(200),
  }),
  risk: () => "safe",
  describe: (i) => `import video ${i.video} into OpenChatCut`,
  async execute(i, ctx) {
    const { file, name } = await attachmentFile(ctx, i.video);
    const src = join(ctx.workspace, "media", file);
    const dir = openchatcutMediaDir();
    mkdirSync(dir, { recursive: true });
    // the same video (name + size) is copied once; a different one with the same name gets its own file
    const size = statSync(src).size;
    const safe = name.replace(/[^\w.-]+/g, "_").slice(-80) || file;
    const path = join(dir, `${size}-${safe}`);
    if (!existsSync(path) || statSync(path).size !== size) copyFileSync(src, path);
    const r = await callOpenChatCut(ctx, "import_asset", { path, editSessionId: i.editSessionId });
    const hint = /IMPORT_ROOTS/.test(r.text) ? `\nOpenChatCut does not allow this folder yet: the owner must add ${dir} to AGENT_IMPORT_ROOTS (a Windows user environment variable) and restart OpenChatCut. Stop and tell the owner.` : "";
    return { ok: !r.isError, summary: `imported ${name}${r.isError ? " (failed)" : ""}`, output: r.text + hint };
  },
});

export const OPENCHATCUT_TOOLS = [openchatcutTool, openchatcutImportTool];

/** Tests: forget the in-memory sessions, as a runner restart does (the file stays). */
export function forgetOpenChatCutSessions(): void {
  sessions.clear();
  targets.clear();
}
