import { afterEach, expect, test } from "bun:test";
import { requiredPrograms, type Agent } from "@agent-office/shared";
import { createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

let env: TestEnv;
afterEach(async () => {
  await env?.close();
});

test("requiredPrograms follows the agent's tools and runtime", () => {
  expect(requiredPrograms({ tools: ["video_probe", "video_edit", "save_draft"] })).toEqual(["ffmpeg"]);
  expect(requiredPrograms({ tools: ["git_clone", "browser_check", "read_file"] })).toEqual(["git", "node"]);
  expect(requiredPrograms({ tools: ["git_push"], runtime: "opencode" })).toEqual(["git", "opencode"]);
  expect(requiredPrograms({ tools: ["git_push"], runtime: "opencode", job_type: "feature_note" })).toEqual(["git"]);
  expect(requiredPrograms({ tools: ["web_search"], job_type: "video_render" })).toEqual(["ffmpeg"]);
  expect(requiredPrograms({ tools: ["web_search", "memory"] })).toEqual([]);
});

async function runnerOf(e: TestEnv, agent: Agent): Promise<string> {
  const { body } = await e.api<{ job: { id: string } }>("/api/jobs", { body: { agent_id: agent.id, title: "Cut", input: { text: "hi" } } });
  const runner = await waitFor(() => Object.values(e.hub.hub.store.state.runs).find((r) => r.job_id === body.job.id)?.runner_id, 5000, "run started");
  // both runners are free again before the next job, so only the programs decide
  await waitFor(() => e.hub.hub.store.state.jobs[body.job.id]?.status === "done", 5000, "job done");
  return runner;
}

test("a job goes to the runner that has the programs its tools need; other jobs go anywhere", async () => {
  env = await createTestEnv();
  await env.pairRunner("plain-pc", { programs: [] });
  await env.pairRunner("editing-pc", { programs: ["ffmpeg", "git"] });
  const { body: rs } = await env.api<{ runners: { id: string; name: string }[] }>("/api/runners");
  await waitFor(() => Object.values(env.hub.hub.store.state.runners).filter((r) => r.online).length === 2, 5000, "two runners online");
  const editingPc = rs.runners.find((r) => r.name === "editing-pc")!.id;
  const plainPc = rs.runners.find((r) => r.name === "plain-pc")!.id;

  const { body } = await env.api<{ agents: Agent[] }>("/api/agents");
  const echo = body.agents.find((a) => a.slug === "echo")!;
  // no special tools: the least-loaded (first) runner
  expect(await runnerOf(env, echo)).toBe(plainPc);

  await env.api(`/api/agents/${echo.id}`, { method: "PATCH", body: { tools: ["video_probe"] } });
  expect(await runnerOf(env, { ...echo, tools: ["video_probe"] })).toBe(editingPc);
});
