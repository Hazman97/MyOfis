import { afterEach, expect, test } from "bun:test";
import { getJob } from "../src/repo.ts";
import { briefingFacts } from "../src/briefing.ts";
import { schedules } from "../src/db/schema.ts";
import { createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

let env: TestEnv;
afterEach(async () => {
  await env?.close();
});

test("Ketua's morning briefing: seeded off at 07:30, gets fresh facts from the hub, and the model sees them", async () => {
  env = await createTestEnv();
  await env.pairRunner();
  const hub = env.hub.hub;
  // seeded with Ketua, switched off
  const ketua = ((await env.api("/api/agents")).body.agents as { id: string; slug: string }[]).find((a) => a.slug === "ketua")!;
  const sch = hub.db.select().from(schedules).all().find((s) => s.agent_id === ketua.id)!;
  expect(sch).toMatchObject({ cron: "30 7 * * *", enabled: false, job_template: { type: "daily_briefing" } });

  // some work to report: a failed job yesterday is not needed; a pending draft is enough
  const project = (await env.api("/api/projects", { body: { slug: "sp", name: "SmashPoint" } })).body.project;
  const mk = (await env.api("/api/agents", { body: { slug: "mk", name: "Marketing", provider: "mock", model: "mock-script", tools: ["save_draft"], config: { self_review: false } } })).body.agent;
  const check = { facts_match_brief: true, only_released_features: true, no_overclaims: true, tone_and_language_match: true, notes: "" };
  const j = (await env.api("/api/jobs", { body: { agent_id: mk.id, project_id: project.id, title: "captions", input: { script: [{ tool: "save_draft", input: { project: "sp", platform: "facebook", kind: "caption", title: "Promo Isnin", body: "Court RM15/jam", self_check: check } }, { text: "ok" }] } } })).body.job;
  await waitFor(() => hub.store.state.jobs[j.id]?.status === "done", 8000, "draft");

  const facts = briefingFacts(hub, "owner");
  expect(facts.waiting_for_owner).toMatchObject({ drafts: 1, draft_titles: ["Promo Isnin (facebook caption)"] });

  // the briefing job: echo model repeats its prompt, so we can see the facts reached the model
  await env.api(`/api/agents/${ketua.id}`, { method: "PATCH", body: { provider: "mock", model: "mock-echo" } });
  const run = (await env.api(`/api/schedules/${sch.id}/run-now`, { method: "POST" })).body.job_id as string;
  await waitFor(() => hub.store.state.jobs[run]?.status === "done", 8000, "briefing");
  expect(getJob(hub.db, run)!.input.facts).toBeUndefined(); // stored job stays clean; facts are added when it runs
  const out = hub.store.state.runs[hub.store.state.jobs[run]!.run_ids[0]!]!.output ?? "";
  expect(out).toContain("Facts from the hub");
  expect(out).toContain("Promo Isnin");
});
