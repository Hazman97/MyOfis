import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOL_REGISTRY, parseMcpBody, runTool } from "../src/index.ts";
import { editorDropped, editorWindowArgs, forgetOpenChatCutSessions } from "../src/openchatcut.ts";
import { makeCtx } from "./helpers.ts";

/** A stand-in for OpenChatCut's MCP endpoint: bearer token, session id, SSE answers. */
const TOKEN = "occ_test_token_1234567890";
const calls: { method: string; name?: string; args?: Record<string, unknown>; session: string | null }[] = [];
let server: ReturnType<typeof Bun.serve>;
/** The fake editor: connected projects, and how many calls answer "stale" next. */
const fake = { connected: ["p1"], staleNext: 0 };
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ao-occ-"));
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      if (new URL(req.url).pathname !== "/api/external-mcp/mcp") return new Response("no", { status: 404 });
      if (req.headers.get("authorization") !== `Bearer ${TOKEN}`) return Response.json({ error: "invalid request origin" }, { status: 403 });
      if (req.headers.get("mcp-session-id") === "gone") return Response.json({ error: "MCP session not found or expired" }, { status: 404 });
      const msg = (await req.json()) as { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
      calls.push({ method: msg.method, name: msg.params?.name, args: msg.params?.arguments, session: req.headers.get("mcp-session-id") });
      if (msg.id === undefined) return new Response(null, { status: 202 });
      const sse = (result: unknown) =>
        new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n\n`, { headers: { "content-type": "text/event-stream", "mcp-session-id": "sess-1" } });
      if (msg.method === "initialize") return sse({ protocolVersion: "2025-06-18", serverInfo: { name: "openchatcut" } });
      if (msg.method === "tools/list") return sse({ tools: [{ name: "list_projects", description: "List OpenChatCut projects, newest first. More text." }, { name: "import_asset", description: "Import ONE file.", inputSchema: { type: "object", properties: { path: { type: "string" } } } }] });
      if (msg.params?.name === "openchatcut_status") return sse({ content: [{ type: "text", text: JSON.stringify({ connectedProjectIds: fake.connected }) }] });
      if (msg.params?.name === "target_project") return sse({ content: [{ type: "text", text: '{"ok":true}' }] });
      if (msg.params?.name === "read_timeline" && fake.staleNext > 0) {
        fake.staleNext--;
        return sse({ content: [{ type: "text", text: '{"outcome":"rejected","message":"The editor binding is stale."}' }], isError: true });
      }
      if (msg.params?.name === "read_timeline") return sse({ content: [{ type: "text", text: '{"tracks":[]}' }] });
      if (msg.params?.name === "list_projects") return sse({ content: [{ type: "text", text: '{"result":[{"id":"p1","name":"Promo"}]}' }] });
      if (msg.params?.name === "import_asset") return sse({ content: [{ type: "text", text: `imported ${String(msg.params.arguments?.path).split(/[\\/]/).pop()}` }] });
      return sse({ content: [{ type: "text", text: "unknown tool" }], isError: true });
    },
  });
  process.env.OPENCHATCUT_URL = `http://127.0.0.1:${server.port}`;
  process.env.OPENCHATCUT_MCP_TOKEN = TOKEN;
  process.env.OPENCHATCUT_MEDIA_DIR = join(dir, "occ-media");
  process.env.OPENCHATCUT_BROWSER = join(dir, "no-browser.exe"); // never opens a real window
  process.env.OPENCHATCUT_SESSION_FILE = join(dir, "sessions.json");
  writeFileSync(join(dir, "clip.mp4"), "fake video");
});
afterAll(() => {
  server.stop(true);
  delete process.env.OPENCHATCUT_URL;
  delete process.env.OPENCHATCUT_MCP_TOKEN;
  delete process.env.OPENCHATCUT_MEDIA_DIR;
  delete process.env.OPENCHATCUT_BROWSER;
  delete process.env.OPENCHATCUT_SESSION_FILE;
  rmSync(dir, { recursive: true, force: true });
});

test("SSE and plain JSON answers are both read", () => {
  expect(parseMcpBody('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":1}}\n\n', 2)).toMatchObject({ result: { ok: 1 } });
  expect(parseMcpBody('{"jsonrpc":"2.0","id":3,"error":{"message":"bad"}}', 3)).toMatchObject({ error: { message: "bad" } });
});

test("one MCP session per run: initialize once, then tool calls with the session id; import copies the video into the fixed media folder", async () => {
  const { ctx } = makeCtx(join(dir, "ws"));
  ctx.attachments = [{ id: "upl_1", name: "clip.mp4", content_type: "video/mp4" }];
  ctx.downloadAttachment = async (_id, dest) => writeFileSync(dest, "fake video");

  const list = await runTool(TOOL_REGISTRY.openchatcut!, { tool: "tools/list" }, ctx);
  expect(list.output).toEqual([
    { name: "list_projects", does: "List OpenChatCut projects, newest first." },
    { name: "import_asset", does: "Import ONE file." },
  ]);
  const described = await runTool(TOOL_REGISTRY.openchatcut!, { tool: "tools/describe", arguments: { name: "import_asset" } }, ctx);
  expect(JSON.parse(String(described.output))).toEqual({ name: "import_asset", description: "Import ONE file.", arguments: { type: "object", properties: { path: { type: "string" } } } });
  expect((await runTool(TOOL_REGISTRY.openchatcut!, { tool: "tools/describe", arguments: { name: "nope" } }, ctx)).ok).toBe(false);
  const projects = await runTool(TOOL_REGISTRY.openchatcut!, { tool: "list_projects", arguments: {} }, ctx);
  expect(projects).toMatchObject({ ok: true, output: '{"result":[{"id":"p1","name":"Promo"}]}' });
  const imp = await runTool(TOOL_REGISTRY.openchatcut_import!, { video: 1, editSessionId: "es1" }, ctx);
  expect(imp).toMatchObject({ ok: true, output: "imported 10-clip.mp4" });
  const copied = join(dir, "occ-media", "10-clip.mp4");
  expect(calls.find((c) => c.name === "import_asset")?.args).toMatchObject({ editSessionId: "es1", path: copied });
  expect(readFileSync(copied, "utf8")).toBe("fake video");
  // initialize once, every later call carries the session
  expect(calls.filter((c) => c.method === "initialize")).toHaveLength(1);
  expect(calls.filter((c) => c.method !== "initialize").every((c) => c.session === "sess-1")).toBe(true);
  // the next chat message is a new run of the same agent: it keeps the MCP session (binding + edit session)
  const { ctx: next } = makeCtx(join(dir, "ws-next"));
  expect((await runTool(TOOL_REGISTRY.openchatcut!, { tool: "list_projects", arguments: {} }, next)).ok).toBe(true);
  expect(calls.filter((c) => c.method === "initialize")).toHaveLength(1);
  expect(calls.at(-1)?.session).toBe("sess-1");
  // an unknown tool is a failed result, and deleting is the owner's job
  expect((await runTool(TOOL_REGISTRY.openchatcut!, { tool: "nope", arguments: {} }, ctx)).ok).toBe(false);
  expect((await runTool(TOOL_REGISTRY.openchatcut!, { tool: "delete_project", arguments: { id: "p1" } }, ctx)).ok).toBe(false);
});

test("a wrong token is explained", async () => {
  process.env.OPENCHATCUT_MCP_TOKEN = "wrong";
  const { ctx } = makeCtx(join(dir, "ws2"));
  const r = await runTool(TOOL_REGISTRY.openchatcut!, { tool: "list_projects" }, ctx);
  expect(r.ok).toBe(false);
  expect(r.summary).toContain("refused the MCP token");
  process.env.OPENCHATCUT_MCP_TOKEN = TOKEN;
});

test("target_project checks the editor; a stale answer is re-bound and retried once", async () => {
  const { ctx } = makeCtx(join(dir, "ws3"));
  // the editor of p1 is connected: no window, no note
  const t = await runTool(TOOL_REGISTRY.openchatcut!, { tool: "target_project", arguments: { projectId: "p1" } }, ctx);
  expect(t).toMatchObject({ ok: true, output: '{"ok":true}' });
  // the editor reconnected: the call is answered stale once, then re-bound and retried
  fake.staleNext = 1;
  const before = calls.length;
  const r = await runTool(TOOL_REGISTRY.openchatcut!, { tool: "read_timeline", arguments: { editSessionId: "es1" } }, ctx);
  expect(r.ok).toBe(true);
  expect(String(r.output)).toContain('{"tracks":[]}');
  expect(String(r.output)).toContain("re-bound it and retried");
  expect(calls.slice(before).map((c) => c.name)).toEqual(["read_timeline", "openchatcut_status", "target_project", "read_timeline"]);
  // no editor and no browser to open one: the model is told to ask the owner
  fake.connected = [];
  const none = await runTool(TOOL_REGISTRY.openchatcut!, { tool: "target_project", arguments: { projectId: "p2" } }, ctx);
  expect(String(none.output)).toContain("ask the owner to open the project");
  fake.connected = ["p1"];
});

test("editor window: own profile, throttling off; stale detection", () => {
  const args = editorWindowArgs("http://localhost:5199/#/editor/p1", "C:/x/profile");
  expect(args).toContain("--app=http://localhost:5199/#/editor/p1");
  expect(args).toContain("--user-data-dir=C:/x/profile");
  expect(args).toContain("--disable-background-timer-throttling");
  expect(args).toContain("--disable-backgrounding-occluded-windows");
  expect(editorDropped('{"outcome":"rejected","message":"Project p1 browser ownership is stale."}')).toBe(true);
  expect(editorDropped('{"outcome":"rejected","message":"No OpenChatCut editor is connected. Call target_project"}')).toBe(true);
  expect(editorDropped('{"outcome":"rejected","message":"editSessionId is required"}')).toBe(false);
  expect(editorDropped('{"tracks":[]}')).toBe(false);
});

test("a runner restart reuses the saved MCP session; an expired one is replaced, re-targeted and retried", async () => {
  const { ctx } = makeCtx(join(dir, "ws4"));
  await runTool(TOOL_REGISTRY.openchatcut!, { tool: "target_project", arguments: { projectId: "p1" } }, ctx);
  expect(JSON.parse(readFileSync(join(dir, "sessions.json"), "utf8")).coder).toEqual({ id: "sess-1", target: "p1" });
  // restart: memory gone, the file stays → same transport, no new initialize
  forgetOpenChatCutSessions();
  const inits = calls.filter((c) => c.method === "initialize").length;
  expect((await runTool(TOOL_REGISTRY.openchatcut!, { tool: "list_projects", arguments: {} }, makeCtx(join(dir, "ws5")).ctx)).ok).toBe(true);
  expect(calls.filter((c) => c.method === "initialize")).toHaveLength(inits);
  expect(calls.at(-1)?.session).toBe("sess-1");
  // the app forgot the session (404): a new one, target_project again, then the call
  writeFileSync(join(dir, "sessions.json"), JSON.stringify({ coder: { id: "gone", target: "p1" } }));
  forgetOpenChatCutSessions();
  const before = calls.length;
  const r = await runTool(TOOL_REGISTRY.openchatcut!, { tool: "list_projects", arguments: {} }, makeCtx(join(dir, "ws6")).ctx);
  expect(r.ok).toBe(true);
  expect(calls.slice(before).map((c) => c.name ?? c.method)).toEqual(["initialize", "notifications/initialized", "target_project", "list_projects"]);
  expect(JSON.parse(readFileSync(join(dir, "sessions.json"), "utf8")).coder.id).toBe("sess-1");
});
