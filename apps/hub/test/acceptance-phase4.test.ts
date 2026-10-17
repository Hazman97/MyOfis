/**
 * Phase 4 acceptance (SPEC §14): "merging a PR produces a feature note, a Tester screenshot and
 * Marketing drafts for that project, all waiting for the owner's approval."
 *
 * Real hub, runner, tools and headless browser. Fakes: Gitea (API) and the LLMs (one scripted
 * OpenAI-compatible server per agent, so their scripts cannot interleave).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentEvent, ContentDraft, FeatureNote } from "@agent-office/shared";
import { startFakeGitea, type FakeGitea } from "../../../packages/tools/test/fakeGitea.ts";
import { startFakeOpenAI, type FakeOpenAI } from "../../runner/test/fakeOpenAI.ts";
import { createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

let env: TestEnv;
let gitea: FakeGitea;
let site: ReturnType<typeof Bun.serve>;
const llms: FakeOpenAI[] = [];

const of = <T extends AgentEvent["type"]>(events: AgentEvent[], type: T) => events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type);
const ok = { facts_match_brief: true, only_released_features: true, no_overclaims: true, tone_and_language_match: true, notes: "" };

beforeAll(async () => {
  site = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("<title>Sewa Kamera</title><h1>Sewa Kamera ZV-E10</h1><label>Masa ambil <input type=time></label>", { headers: { "content-type": "text/html" } }),
  });
  gitea = startFakeGitea();
  env = await createTestEnv();
  await env.pairRunner();
}, 60_000);

afterAll(async () => {
  await env?.close();
  gitea?.stop();
  for (const l of llms) l.stop();
  site?.stop(true);
});

describe("Phase 4 acceptance", () => {
  test("merged PR -> Coder's feature note -> Tester screenshot + Marketing drafts, all waiting for the owner", async () => {
    const web = await env.web();
    const api = env.api;
    const prUrl = `${gitea.url}/hazman/sewa/pulls/1`;

    // The owner's setup: Gitea, a project with a live site, repo and brief.
    await api("/api/settings/integrations/gitea", { method: "PUT", body: { url: gitea.url, token: gitea.token } });
    const project = (await api("/api/projects", { body: { slug: "sewa", name: "Sewa Kamera", live_url: `http://127.0.0.1:${site.port}/`, repo_url: `${gitea.url}/hazman/sewa.git` } })).body
      .project as { id: string };
    await api(`/api/projects/${project.id}/brief`, {
      method: "PUT",
      body: { project: "Sewa Kamera ZV-E10", pricing: "RM80 sehari", platforms: ["tiktok", "instagram", "facebook"], languages: { tiktok: "manglish", instagram: "manglish", facebook: "bahasa_melayu" } },
    });

    // One scripted LLM per agent.
    const scripted = async (slug: string, script: Parameters<typeof startFakeOpenAI>[0]) => {
      const llm = startFakeOpenAI(script, `key-${slug}`);
      llms.push(llm);
      await api("/api/providers", { body: { slug: `llm-${slug}`, name: `LLM ${slug}`, kind: "openai_compatible", base_url: llm.url, api_key: `key-${slug}`, models: ["fake-model"] } });
      const agent = ((await api("/api/agents")).body.agents as { id: string; slug: string }[]).find((a) => a.slug === slug)!;
      await api(`/api/agents/${agent.id}`, { method: "PATCH", body: { provider: `llm-${slug}`, model: "fake-model" } });
      return { agent, llm };
    };
    const coder = await scripted("coder", [
      { tool: "gitea_ci_status", input: { owner: "hazman", repo: "sewa", ref: "sha-merged" } },
      { tool: "add_feature_note", input: { title: "Pilih masa ambil kamera", user_facing_note: "Sekarang anda boleh pilih sendiri pukul berapa nak ambil kamera.", source_pr_url: prUrl } },
      { text: "CI passed, feature note added." },
    ]);
    const tester = await scripted("tester", [{ tool: "browser_check", input: { url: `http://127.0.0.1:${site.port}/`, name: "sewa-pickup-time" } }, { text: "The time picker shows on the home page." }]);
    const marketing = await scripted("marketing", [
      { tool: "read_brief", input: {} },
      { tool: "read_feature_log", input: {} },
      ...(["tiktok", "instagram", "facebook"] as const).map((platform) => ({
        tool: "save_draft",
        input: { platform, kind: "announcement", title: `Announce on ${platform}`, body: `Baru! Pilih masa ambil kamera sendiri. Sewa ZV-E10 RM80 sehari. (${platform})`, self_check: ok },
      })),
      { text: "3 announcement drafts are waiting for you." },
    ]);

    // Coder's PR on its agent branch is merged by the owner in Gitea; CI is green.
    const watcher = env.hub.releases;
    gitea.pulls.push({ number: 1, head: "agent/coder-1a2b3c", base: "main", title: "Booking: pick a pickup time", body: "Adds a time picker to booking." });
    expect(await watcher.check()).toEqual([]); // first look (nothing merged yet)
    gitea.statuses["sha-merged"] = "success";
    gitea.merge(1, "sha-merged");
    const [noteJobId] = await watcher.check();
    expect(env.hub.hub.store.state.jobs[noteJobId!]).toMatchObject({ agent_id: coder.agent.id, type: "feature_note", trigger: "event", project_id: project.id });

    // 1) Coder writes the user-facing note (without OpenCode: only CI status + add_feature_note).
    const released = await waitFor(() => of(web.events, "feature.released")[0], 30_000, "feature.released");
    expect(released.agent_id).toBe(coder.agent.id);
    const coderTools = of(web.events, "agent.tool_call").filter((e) => e.agent_id === coder.agent.id).map((e) => e.payload.tool);
    expect(coderTools).toEqual(["gitea_ci_status", "add_feature_note"]);
    expect(readFileSync(join(env.dir, "projects", "sewa", "FEATURES.md"), "utf8")).toContain("Pilih masa ambil kamera");

    // 2) Tester screenshots the new feature; the screenshot lands on the feature's log entry.
    await waitFor(() => of(web.events, "run.finished").find((e) => e.agent_id === tester.agent.id), 120_000, "tester run");
    const shot = of(web.events, "artifact.created").find((e) => e.agent_id === tester.agent.id && e.payload.kind === "screenshot");
    expect(shot?.payload.path).toMatch(/^artifacts\/run_.+\/sewa-pickup-time\.png$/);

    // 3) Marketing drafts the announcements.
    await waitFor(() => of(web.events, "run.finished").find((e) => e.agent_id === marketing.agent.id), 60_000, "marketing run");
    const feature = ((await api(`/api/projects/${project.id}/features`)).body.features as FeatureNote[])[0]!;
    expect(feature).toMatchObject({ title: "Pilih masa ambil kamera", source_pr_url: prUrl, screenshot_path: shot!.payload.path, announced: false });

    // All of it waits for the owner: nothing approved, nothing published.
    const drafts = (await api(`/api/drafts?status=pending&project_id=${project.id}`)).body.drafts as ContentDraft[];
    expect(drafts.map((d) => d.platform).sort()).toEqual(["facebook", "instagram", "tiktok"]);
    expect(drafts.every((d) => d.status === "draft" && d.kind === "announcement" && d.feature_id === feature.id)).toBe(true);
    expect(Object.keys(env.hub.hub.store.state.pending_drafts)).toHaveLength(3);

    // Approving one marks the feature as announced.
    await api(`/api/drafts/${drafts[0]!.id}/decide`, { body: { decision: "approve" } });
    expect(((await api(`/api/projects/${project.id}/features`)).body.features as FeatureNote[])[0]!.announced).toBe(true);

    // Marketing only read the brief and feature log it was given, with its own key.
    expect(marketing.llm.requests.every((r) => r.auth === "Bearer key-marketing")).toBe(true);
  }, 240_000);
});
