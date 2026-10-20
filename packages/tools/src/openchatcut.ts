import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { freshFetch } from "@agent-office/shared";
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

/** One MCP session per run (the session binds to a project with target_project). */
const sessions = new WeakMap<ToolContext, { id: string | null; next: number }>();

async function rpc(ctx: ToolContext, method: string, params: Record<string, unknown>, notify = false): Promise<unknown> {
  const token = openchatcutToken();
  if (!token) throw new ToolDenied("OpenChatCut is not set up on this PC (install it and open it once; the token is in ~/.openchatcut/mcp-token). Tell the owner.");
  let s = sessions.get(ctx);
  if (!s) {
    s = { id: null, next: 1 };
    sessions.set(ctx, s);
  }
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
  if (sid) s.id = sid;
  if (notify) return null;
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw new ToolDenied("OpenChatCut refused the MCP token: open the app once so it writes ~/.openchatcut/mcp-token, or set OPENCHATCUT_MCP_TOKEN on the runner");
  if (res.status === 404 && s.id) {
    // the app restarted: start a new session next time
    sessions.delete(ctx);
    throw new ToolDenied("the OpenChatCut session ended (the app restarted?): try again");
  }
  const msg = parseMcpBody(text, id);
  if (!msg) throw new ToolDenied(`OpenChatCut gave no answer (HTTP ${res.status})`);
  if (msg.error) throw new ToolDenied(`OpenChatCut: ${msg.error.message ?? "error"}`);
  return msg.result;
}

async function ensureSession(ctx: ToolContext): Promise<void> {
  if (sessions.get(ctx)?.id) return;
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

export const openchatcutTool = defineTool({
  name: "openchatcut",
  description:
    "Drive the OpenChatCut video editor on this PC (a full multitrack timeline the owner can watch). Calls one of its MCP tools by name. " +
    'tool "tools/list" lists them all. Usual flow: list_projects or create_project (1080×1920, 30 fps for TikTok) → get_editor_url (tell the owner to open it to watch live) → ' +
    'target_project → begin_edit_session (approvalMode "manual" when the owner has the editor open, else "auto") → openchatcut_import your videos → read_timeline / read_transcript → ' +
    "edit_item, split_item, set_item_timing, add_motion_graphic, add_audio, edit_captions, manage_effects (pass editSessionId every time) → review_edit_session → get_edit_session until applied.",
  category: "write",
  input: z.object({
    tool: z.string().min(1).max(80).describe('An OpenChatCut tool name, or "tools/list"'),
    arguments: z.record(z.string(), z.unknown()).default({}),
  }),
  risk: () => "safe",
  describe: (i) => `OpenChatCut ${i.tool}`,
  async execute(i, ctx) {
    if (i.tool === "tools/list") {
      await ensureSession(ctx);
      const r = (await rpc(ctx, "tools/list", {})) as { tools?: { name: string; description?: string }[] };
      const tools = (r.tools ?? []).map((t) => ({ name: t.name, does: (t.description ?? "").split(/(?<=\.)\s/)[0]?.slice(0, 160) }));
      return { ok: true, summary: `${tools.length} OpenChatCut tools`, output: tools };
    }
    // deleting projects is the owner's job, in the app
    if (/delete/i.test(i.tool) && !/^(remove_item|discard_edit_session)$/.test(i.tool)) throw new ToolDenied("deleting in OpenChatCut is done by the owner in the app");
    const r = await callOpenChatCut(ctx, i.tool, i.arguments);
    return { ok: !r.isError, summary: `${i.tool}${r.isError ? " failed" : ""}`, output: r.text };
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
