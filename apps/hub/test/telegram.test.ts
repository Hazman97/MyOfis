import { afterEach, describe, expect, test } from "bun:test";
import type { AgentEvent } from "@agent-office/shared";
import { startFakeGitea, type FakeGitea } from "../../../packages/tools/test/fakeGitea.ts";
import { startFakeTelegram, type FakeTelegram } from "./fakeTelegram.ts";
import { createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

let env: TestEnv;
let tg: FakeTelegram | null = null;
let gitea: FakeGitea | null = null;
afterEach(async () => {
  await env?.close();
  tg?.stop();
  gitea?.stop();
  tg = gitea = null;
});

const OWNER = 777001;
const find = <T extends AgentEvent["type"]>(events: AgentEvent[], type: T) => events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type);

describe("Telegram", () => {
  test("approval buttons: only the owner with a valid signature can decide", async () => {
    tg = startFakeTelegram();
    env = await createTestEnv({}, { telegramApiBase: tg.url });
    await env.pairRunner();
    const web = await env.web();
    expect((await env.api("/api/settings/integrations/telegram", { method: "PUT", body: { token: "not a token" } })).status).toBe(400);
    const saved = await env.api("/api/settings/integrations/telegram", { method: "PUT", body: { token: tg.token, chat_id: String(OWNER) } });
    expect(saved.body.telegram).toMatchObject({ has_token: true, chat_id: String(OWNER) });
    expect(JSON.stringify(saved.body)).not.toContain(tg.token);

    const { body } = await env.api("/api/agents", {
      body: { slug: "shell-bot", name: "Shell bot", provider: "mock", model: "mock-script", tools: ["run_command"], permission_level: "safe" },
    });
    await env.api("/api/jobs", { body: { agent_id: body.agent.id, title: "risky", input: { script: [{ tool: "run_command", input: { command: "bun --print 2+2" } }, { text: "done" }] } } });

    const msg = await waitFor(() => tg!.sent.find((s) => s.method === "sendMessage" && s.body.reply_markup), 8000, "approval message");
    expect(msg.body.chat_id).toBe(String(OWNER));
    const buttons = (msg.body.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard[0]!;
    const approve = buttons.find((b) => b.text.includes("Approve"))!.callback_data;
    const approvalId = find(web.events, "agent.needs_approval")[0]!.payload.approval_id;

    // forged signature, and a stranger pressing the real button: both refused
    tg.push({ callback_query: { id: "cq1", from: { id: OWNER }, data: approve.replace(/:[^:]+$/, ":AAAAAAAAAAAA"), message: { message_id: 1, chat: { id: OWNER } } } });
    tg.push({ callback_query: { id: "cq2", from: { id: 999 }, data: approve, message: { message_id: 1, chat: { id: 999 } } } });
    await waitFor(() => tg!.sent.filter((s) => s.method === "answerCallbackQuery").length >= 2, 5000, "refusals");
    expect(tg.sent.filter((s) => s.method === "answerCallbackQuery").every((s) => s.body.text === "Not allowed.")).toBe(true);
    expect(env.hub.hub.store.state.pending_approvals[approvalId]).toBeDefined();

    // the owner's tap decides it
    tg.push({ callback_query: { id: "cq3", from: { id: OWNER }, data: approve, message: { message_id: 1, chat: { id: OWNER } } } });
    const decided = await waitFor(() => find(web.events, "approval.decided")[0], 5000, "decided");
    expect(decided.payload).toMatchObject({ decision: "approved", via: "telegram" });
    await waitFor(() => find(web.events, "run.finished")[0], 8000, "run finished");
    expect(tg.sent.some((s) => s.method === "editMessageText" && String(s.body.text).startsWith("✅ Approved"))).toBe(true);
  });

  test("/id tells anyone their chat id; failures reach the owner", async () => {
    tg = startFakeTelegram();
    env = await createTestEnv({}, { telegramApiBase: tg.url });
    await env.pairRunner();
    await env.api("/api/settings/integrations/telegram", { method: "PUT", body: { token: tg.token, chat_id: String(OWNER) } });
    tg.push({ message: { chat: { id: 4242 }, from: { id: 4242 }, text: "/id" } });
    const reply = await waitFor(() => tg!.sent.find((s) => s.method === "sendMessage" && s.body.chat_id === "4242"), 5000, "/id reply");
    expect(String(reply.body.text)).toContain("4242");

    const { body } = await env.api("/api/agents");
    const echo = body.agents.find((a: { slug: string }) => a.slug === "echo");
    await env.api(`/api/agents/${echo.id}`, { method: "PATCH", body: { model: "mock-fail" } });
    await env.api("/api/jobs", { body: { agent_id: echo.id, title: "will fail", input: { text: "one two three four" } } });
    const fail = await waitFor(() => tg!.sent.find((s) => s.method === "sendMessage" && String(s.body.text).startsWith("❌")), 8000, "failure message");
    expect(fail.body.chat_id).toBe(String(OWNER));
    expect(String(fail.body.text)).toContain("will fail");
  });
});

describe("release watcher", () => {
  test("a newly merged agent PR becomes a feature_note job for Coder; older merges are skipped", async () => {
    gitea = startFakeGitea();
    env = await createTestEnv();
    await env.api("/api/settings/integrations/gitea", { method: "PUT", body: { url: gitea.url, token: gitea.token } });
    await env.api("/api/projects", { body: { slug: "shop", name: "Shop", repo_url: `${gitea.url}/owner/shop.git` } });
    gitea.pulls.push({ number: 1, head: "agent/coder-old", base: "main", title: "Old fix", body: "", merged_sha: "old" });
    gitea.pulls.push({ number: 2, head: "someone/manual", base: "main", title: "Human PR", body: "" });
    const watcher = env.hub.releases;
    expect(await watcher.check()).toEqual([]); // first look: remember PR #1, no job
    gitea.pulls.push({ number: 3, head: "agent/coder-abc123", base: "main", title: "Fix booking time", body: "Lets customers pick a time." });
    gitea.merge(2);
    gitea.merge(3, "sha3");
    const created = await watcher.check();
    expect(created).toHaveLength(1);
    const job = env.hub.hub.store.state.jobs[created[0]!]!;
    expect(job).toMatchObject({ type: "feature_note", trigger: "event", title: "Release note: PR #3 Fix booking time" });
    expect(await watcher.check()).toEqual([]); // never twice
  });
});
