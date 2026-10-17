import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { AgentEvent, ContentDraft } from "@agent-office/shared";
import { agents, projects } from "../src/db/schema.ts";
import { createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

let env: TestEnv;
afterEach(async () => {
  await env?.close();
});

const find = <T extends AgentEvent["type"]>(events: AgentEvent[], type: T) => events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type);

async function project(e: TestEnv, extra: Record<string, unknown> = {}) {
  const { body, status } = await e.api("/api/projects", { body: { slug: "sewa-kamera", name: "Sewa Kamera", ...extra } });
  if (status !== 201) throw new Error(JSON.stringify(body));
  return body.project as { id: string; slug: string };
}

/** Marketing (built-in) switched to the deterministic mock-script model. */
async function marketing(e: TestEnv) {
  const { body } = await e.api("/api/agents");
  const m = body.agents.find((a: { slug: string }) => a.slug === "marketing");
  await e.api(`/api/agents/${m.id}`, { method: "PATCH", body: { provider: "mock", model: "mock-script" } });
  return m.id as string;
}

const okCheck = { facts_match_brief: true, only_released_features: true, no_overclaims: true, tone_and_language_match: true, notes: "" };

describe("project briefs", () => {
  test("brief round-trips through projects/<slug>/brief.yaml and is validated", async () => {
    env = await createTestEnv();
    const p = await project(env);
    expect((await env.api(`/api/projects/${p.id}/brief`)).body.brief).toBeNull();
    const saved = await env.api(`/api/projects/${p.id}/brief`, {
      method: "PUT",
      body: { project: "Sewa Kamera ZV-E10", pricing: "RM80 sehari", platforms: ["tiktok"], languages: { tiktok: "manglish" }, good_examples: ["Post A"] },
    });
    expect(saved.status).toBe(200);
    const file = join(env.dir, "projects", "sewa-kamera", "brief.yaml");
    expect(readFileSync(file, "utf8")).toContain("pricing: RM80 sehari");
    const back = await env.api(`/api/projects/${p.id}/brief`);
    expect(back.body.brief).toMatchObject({ pricing: "RM80 sehari", languages: { tiktok: "manglish" }, good_examples: ["Post A"] });
    expect((await env.api("/api/projects")).body.projects[0].brief_path).toBe("projects/sewa-kamera/brief.yaml");

    expect((await env.api(`/api/projects/${p.id}/brief`, { method: "PUT", body: { project: "" } })).status).toBe(400);
    writeFileSync(file, "project: [unclosed");
    expect((await env.api(`/api/projects/${p.id}/brief`)).status).toBe(409);
  });
});

describe("Marketing drafts", () => {
  test("a run reads the brief, saves drafts; the owner edits, approves and rejects; style guide becomes style notes", async () => {
    env = await createTestEnv();
    await env.pairRunner();
    const web = await env.web();
    const p = await project(env);
    await env.api(`/api/projects/${p.id}/brief`, { method: "PUT", body: { project: "Sewa Kamera", pricing: "RM80", do_not: ['guna "terbaik di Malaysia"'], good_examples: ["Weekend ni nak shoot vlog? Jom sewa kamera dengan kami, siap flash dan tripod sekali untuk korang semua."] } });
    const agentId = await marketing(env);
    const script = [
      { tool: "read_brief", input: {} },
      { tool: "save_draft", input: { platform: "tiktok", kind: "caption", title: "Caption A", body: "Nak vlog cuti sekolah? Sewa ZV-E10, RM80 je.", self_check: okCheck } },
      // blocked: the brief forbids this phrase
      { tool: "save_draft", input: { platform: "tiktok", kind: "caption", title: "Caption B", body: "Kamera terbaik di Malaysia!", self_check: okCheck } },
      // blocked: copies an example post word for word
      { tool: "save_draft", input: { platform: "instagram", kind: "caption", title: "Copy", body: "Weekend ni nak shoot vlog? Jom sewa kamera dengan kami, siap flash dan tripod sekali untuk korang.", self_check: okCheck } },
      // blocked: failed self-check
      { tool: "save_draft", input: { platform: "facebook", kind: "caption", title: "Unsure", body: "Diskaun 50%!", self_check: { ...okCheck, facts_match_brief: false } } },
      { tool: "save_draft", input: { platform: "general", kind: "style_guide", title: "Style", body: "Santai, soalan sebagai hook, CTA WhatsApp.", self_check: okCheck } },
      { text: "Saved 2 drafts." },
    ];
    await env.api("/api/jobs", { body: { agent_id: agentId, project_id: p.id, type: "caption", title: "captions", input: { script } } });
    await waitFor(() => find(web.events, "run.finished")[0], 10_000, "run.finished");

    expect(find(web.events, "draft.created")).toHaveLength(2);
    const denied = find(web.events, "agent.tool_result").filter((e) => !e.payload.ok).map((e) => e.payload.summary);
    expect(denied.some((s) => s.includes("terbaik di malaysia"))).toBe(true);
    expect(denied.some((s) => s.includes("word for word"))).toBe(true);
    expect(denied.some((s) => s.includes("self-check failed"))).toBe(true);
    expect(Object.keys(env.hub.hub.store.state.pending_drafts)).toHaveLength(2);

    const { body } = await env.api("/api/drafts?status=pending");
    const drafts = body.drafts as ContentDraft[];
    const caption = drafts.find((d) => d.kind === "caption")!;
    const style = drafts.find((d) => d.kind === "style_guide")!;
    expect(caption.self_check?.no_overclaims).toBe(true);

    const edited = await env.api(`/api/drafts/${caption.id}/decide`, { body: { decision: "approve", body: "Cuti sekolah dah dekat! Sewa ZV-E10 RM80 sehari.", feedback: "lebih pendek" } });
    expect(edited.body.draft).toMatchObject({ status: "edited", original_body: caption.body, owner_feedback: "lebih pendek" });
    expect((await env.api(`/api/drafts/${caption.id}/decide`, { body: { decision: "reject" } })).status).toBe(409);
    await env.api(`/api/drafts/${style.id}/decide`, { body: { decision: "approve" } });
    expect((await env.api(`/api/projects/${p.id}/brief`)).body.brief.style_notes).toBe("Santai, soalan sebagai hook, CTA WhatsApp.");
    expect(Object.keys(env.hub.hub.store.state.pending_drafts)).toHaveLength(0);
    expect(find(web.events, "draft.decided").map((e) => e.payload.status)).toEqual(["edited", "approved"]);

    // the next run sees the owner's edit and feedback (style memory)
    const ctx = env.hub.hub.content.context([p.id]);
    expect(ctx.projects[0]!.past_drafts.find((d) => d.kind === "caption")).toMatchObject({ status: "edited", owner_feedback: "lebih pendek" });
    expect(ctx.projects[0]!.brief?.style_notes).toContain("CTA WhatsApp");
  });
});

describe("feature log", () => {
  test("a released note writes FEATURES.md and asks Tester for a screenshot and Marketing for announcements", async () => {
    env = await createTestEnv();
    const web = await env.web();
    const p = await project(env, { live_url: "https://sewa.example" });
    const res = await env.api(`/api/projects/${p.id}/features`, { body: { title: "Booking ikut masa", user_facing_note: "Sekarang boleh pilih masa ambil kamera sendiri." } });
    expect(res.status).toBe(201);
    expect(find(web.events, "feature.released")).toHaveLength(1);
    const md = readFileSync(join(env.dir, "projects", "sewa-kamera", "FEATURES.md"), "utf8");
    expect(md).toContain("Booking ikut masa");
    const jobs = Object.values(env.hub.hub.store.state.jobs);
    const slugOf = (agentId: string) => env.hub.hub.db.select({ slug: agents.slug }).from(agents).where(eq(agents.id, agentId)).get()!.slug;
    expect(jobs.map((j) => [slugOf(j.agent_id), j.type, j.trigger]).sort()).toEqual([
      ["marketing", "announcement", "event"],
      ["tester", "feature_screenshot", "event"],
    ]);
    expect((await env.api(`/api/projects/${p.id}/features`)).body.features[0].title).toBe("Booking ikut masa");
  });
});

describe("chat", () => {
  test("messages in a thread carry the earlier conversation", async () => {
    env = await createTestEnv();
    await env.pairRunner();
    const { body: agents } = await env.api("/api/agents");
    const echo = agents.agents.find((a: { slug: string }) => a.slug === "echo");
    const first = await env.api("/api/chat", { body: { agent_id: echo.id, text: "hello coach" } });
    expect(first.status).toBe(201);
    const threadId = first.body.thread_id as string;
    await waitFor(() => env.hub.hub.store.state.jobs[first.body.job.id]?.status === "done", 8000, "first reply");
    const second = await env.api("/api/chat", { body: { agent_id: echo.id, text: "and again", thread_id: threadId } });
    expect(second.body.thread_id).toBe(threadId);
    const history = second.body.job.input.history as { role: string; text: string }[];
    expect(history[0]).toEqual({ role: "owner", text: "hello coach" });
    expect(history[1]!.role).toBe("agent");
    expect(history[1]!.text).toContain("hello coach");

    const thread = await env.api(`/api/chat/threads/${threadId}`);
    expect(thread.body.messages.map((m: { text: string }) => m.text)).toEqual(["hello coach", "and again"]);
    expect((await env.api(`/api/chat/threads?agent_id=${echo.id}`)).body.threads[0]).toMatchObject({ thread_id: threadId, messages: 2 });
    const tester = agents.agents.find((a: { slug: string }) => a.slug === "tester");
    expect((await env.api("/api/chat", { body: { agent_id: tester.id, text: "hi", thread_id: threadId } })).status).toBe(409);
  });
});

describe("budgets", () => {
  test("over today's budget: the agent goes home and its jobs wait; a higher budget brings it back", async () => {
    env = await createTestEnv();
    await env.pairRunner();
    const web = await env.web();
    const { body: agents } = await env.api("/api/agents");
    const echo = agents.agents.find((a: { slug: string }) => a.slug === "echo");
    await env.api(`/api/agents/${echo.id}`, { method: "PATCH", body: { daily_token_budget: 5 } });
    const job = (t: string) => env.api("/api/jobs", { body: { agent_id: echo.id, title: t, input: { text: "a few words to use up the budget" } } });
    await job("first");
    await waitFor(() => find(web.events, "budget.exceeded")[0], 8000, "budget.exceeded");
    expect(env.hub.hub.store.state.agents[echo.id]?.activity).toBe("away");

    const { body: second } = await job("second");
    await Bun.sleep(300);
    expect(env.hub.hub.store.state.jobs[second.job.id]?.status).toBe("queued");

    await env.api(`/api/agents/${echo.id}`, { method: "PATCH", body: { daily_token_budget: 0 } }); // 0 = no limit
    await waitFor(() => env.hub.hub.store.state.jobs[second.job.id]?.status === "done", 8000, "second job after raising the budget");
    expect(find(web.events, "agent.idle").length).toBeGreaterThan(0);
  });
});

describe("files stay inside projects/", () => {
  test("slugs are validated before touching the disk", async () => {
    env = await createTestEnv();
    const p = await project(env);
    env.hub.hub.db.update(projects).set({ slug: "../../evil" }).where(eq(projects.id, p.id)).run();
    expect((await env.api(`/api/projects/${p.id}/brief`, { method: "PUT", body: { project: "x" } })).status).toBe(400);
    expect(existsSync(join(env.dir, "evil"))).toBe(false);
  });
});
