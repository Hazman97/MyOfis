/**
 * Phase 2 acceptance (SPEC §14): "nightly Tester run finds a broken page, hands off to Coder,
 * Coder opens a PR on a branch, any dangerous command waits for approval."
 *
 * Everything is real except the two outside services: the LLM (a scripted OpenAI-compatible
 * server) and Gitea (a fake API that serves real git over smart HTTP via `git http-backend`).
 * Tester runs a real headless browser; Coder runs real OpenCode under our permission rules.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "@agent-office/shared";
import { startFakeGitea, type FakeGitea } from "../../../packages/tools/test/fakeGitea.ts";
import { resolveOpenCode } from "../../runner/src/opencode/binary.ts";
import { startFakeOpenAI, type FakeOpenAI } from "../../runner/test/fakeOpenAI.ts";
import { createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

const opencode = resolveOpenCode();
const GITEA_TOKEN = "gitea-acceptance-token-0123456789";

let env: TestEnv;
let root: string;
let gitea: FakeGitea;
let llm: FakeOpenAI;
let site: ReturnType<typeof Bun.serve>;

const git = async (args: string[], cwd?: string) => {
  const p = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_AUTHOR_NAME: "owner", GIT_AUTHOR_EMAIL: "o@o", GIT_COMMITTER_NAME: "owner", GIT_COMMITTER_EMAIL: "o@o" },
  });
  const out = await new Response(p.stdout).text();
  if ((await p.exited) !== 0) throw new Error(`git ${args.join(" ")}: ${await new Response(p.stderr).text()}`);
  return out.trim();
};

const of = <T extends AgentEvent["type"]>(events: AgentEvent[], type: T) =>
  events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type);

beforeAll(async () => {
  if (!opencode) return;
  root = mkdtempSync(join(tmpdir(), "ao-accept-"));
  // The owner's repo on "Gitea": main has a broken booking page.
  const bare = join(root, "git", "hazman", "sewa.git");
  await git(["init", "--bare", "-b", "main", bare]);
  const seed = join(root, "seed");
  await git(["clone", bare, seed]);
  writeFileSync(join(seed, "index.html"), "<h1>Sewa Kamera ZV-E10</h1>\n");
  writeFileSync(join(seed, "booking.html"), "<h1>Internal Server Error</h1>\n");
  await git(["add", "-A"], seed);
  await git(["commit", "-m", "init"], seed);
  await git(["push", "origin", "HEAD:refs/heads/main"], seed);

  // The live site: home works, /booking is broken.
  site = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) =>
      new URL(req.url).pathname === "/booking"
        ? new Response("<title>Error</title><h1>Internal Server Error</h1>", { status: 500, headers: { "content-type": "text/html" } })
        : new Response("<title>Sewa Kamera</title><h1>Sewa Kamera ZV-E10</h1>", { headers: { "content-type": "text/html" } }),
  });
  gitea = startFakeGitea(GITEA_TOKEN, { gitRoot: join(root, "git") });

  // Coder's "LLM" drives OpenCode: read, fix, run an allowlisted check, then a command that needs approval.
  llm = startFakeOpenAI(
    [
      { tool: "read", input: { filePath: "booking.html" } },
      { tool: "write", input: { filePath: "booking.html", content: "<h1>Booking</h1>\n<p>Pick your dates.</p>\n" } },
      { tool: "bash", input: { command: "bun --version", description: "check the toolchain" } },
      { tool: "bash", input: { command: `node -e "require('fs').writeFileSync('verified.txt','ok')"`, description: "verify the fix" } },
      { text: "The booking page was a static error page. I replaced it with the booking form and verified it with a node script." },
    ],
    "fake-llm-key",
  );

  env = await createTestEnv();
  await env.pairRunner();
}, 60_000);

afterAll(async () => {
  if (!opencode) return;
  await env?.close();
  gitea?.stop();
  llm?.stop();
  site?.stop(true);
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* Windows may hold git pack files briefly */
  }
});

describe.skipIf(!opencode)("Phase 2 acceptance", () => {
  test("nightly Tester finds a broken page -> handoff -> Coder (OpenCode) -> PR on a branch; dangerous command waits for approval", async () => {
    const web = await env.web();
    const api = env.api;
    if (process.env.AO_DEBUG) {
      // AO_DEBUG=1: print the event stream with timestamps while the test runs.
      const t0 = Date.now();
      let seen = 0;
      const tick = setInterval(() => {
        for (; seen < web.events.length; seen++) {
          const e = web.events[seen]!;
          console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${e.type} ${JSON.stringify(e.payload).slice(0, 160)}`);
        }
      }, 200);
      setTimeout(() => clearInterval(tick), 290_000);
    }

    // Integrations, project, LLM provider for Coder.
    await api("/api/settings/integrations/gitea", { method: "PUT", body: { url: gitea.url, token: GITEA_TOKEN } });
    const project = (
      await api("/api/projects", {
        body: { slug: "sewa", name: "Sewa Kamera", live_url: `http://127.0.0.1:${site.port}/`, repo_url: `${gitea.url}/hazman/sewa.git` },
      })
    ).body.project;
    expect(
      (
        await api("/api/providers", {
          body: { slug: "fakellm", name: "Scripted LLM", kind: "openai_compatible", base_url: llm.url, api_key: "fake-llm-key", models: ["fake-model"] },
        })
      ).status,
    ).toBe(201);

    const agents = (await api("/api/agents")).body.agents as { id: string; slug: string; config: Record<string, unknown> }[];
    const tester = agents.find((a) => a.slug === "tester")!;
    const coder = agents.find((a) => a.slug === "coder")!;
    // Coder: OpenCode engine, scripted LLM, one allowlisted command.
    await api(`/api/agents/${coder.id}`, {
      method: "PATCH",
      body: { provider: "fakellm", model: "fake-model", permission_level: "review", config: { ...coder.config, runtime: "opencode", shell_allowlist: ["bun --version"], max_steps: 30 } },
    });

    // Tester's seeded nightly schedule, pointed at the project, with a scripted decision path.
    const schedule = (await api("/api/schedules")).body.schedules.find((s: { agent_id: string }) => s.agent_id === tester.id);
    expect(schedule.cron).toBe("0 2 * * *");
    await api(`/api/schedules/${schedule.id}`, {
      method: "PATCH",
      body: {
        job_template: {
          title: "Nightly smoke test",
          type: "smoke_test",
          project_id: project.id,
          input: {
            text: "Run the nightly smoke test.",
            script: [
              { tool: "browser_check", input: { url: `http://127.0.0.1:${site.port}/booking`, name: "sewa-booking" } },
              { tool: "handoff", input: { to_agent: "coder", title: "Fix: booking page returns 500", details: "GET /booking returns HTTP 500 'Internal Server Error'. Expected the booking form.", reason: "booking page is broken" } },
              { tool: "write_report", input: { title: "Nightly smoke test", markdown: "- /booking: FAIL (HTTP 500), handed off to Coder" } },
              { text: "Report written." },
            ],
          },
        },
      },
    });
    const { job_id: testerJobId } = (await api(`/api/schedules/${schedule.id}/run-now`, { method: "POST" })).body;
    expect(env.hub.hub.store.state.jobs[testerJobId]?.trigger).toBe("schedule");

    // 1) Tester finds the broken page and hands off.
    const handoff = await waitFor(() => of(web.events, "agent.handoff")[0], 60_000, "agent.handoff");
    expect(handoff.payload).toMatchObject({ from_agent: "tester", to_agent: "coder" });
    const testerBrowser = of(web.events, "agent.tool_result").find((e) => e.payload.tool === "browser_check");
    expect(testerBrowser?.payload.ok).toBe(false);
    expect(testerBrowser?.payload.summary).toContain("HTTP 500");
    const coderJobId = handoff.payload.new_job_id;
    const coderJob = env.hub.hub.store.state.jobs[coderJobId]!;
    expect(coderJob).toMatchObject({ agent_id: coder.id, trigger: "handoff", parent_job_id: testerJobId, project_id: project.id });

    // 2) The dangerous command stops the Coder until the owner decides.
    const ask = await waitFor(
      () => of(web.events, "agent.needs_approval").find((e) => e.payload.action.includes("node -e")),
      120_000,
      "approval for the dangerous command",
    );
    expect(ask.payload.risk_level).toBe("dangerous");
    expect(env.hub.hub.store.state.jobs[coderJobId]?.status).toBe("waiting_approval");
    // The allowlisted command ran without asking.
    expect(of(web.events, "agent.needs_approval").some((e) => e.payload.action.includes("bun --version"))).toBe(false);
    await Bun.sleep(500);
    expect(of(web.events, "agent.tool_result").some((e) => e.run_id === ask.run_id && e.payload.summary.includes("verify"))).toBe(false);
    expect(gitea.pulls).toHaveLength(0);

    // ~10 s after the runner's last upload: this call would hang on a stale keep-alive socket without freshFetch.
    const decided = await api(`/api/approvals/${ask.payload.approval_id}/decide`, { body: { decision: "approved" } });
    expect(decided.status).toBe(200);

    // 3) Coder finishes; Agent Office commits, pushes the branch and opens the PR.
    const done = await waitFor(() => of(web.events, "run.finished").find((e) => e.payload.job_id === coderJobId), 120_000, "coder run.finished");
    expect(done.payload.status).toBe("done");
    expect(done.payload.tokens_in).toBeGreaterThan(0);

    expect(gitea.pulls).toHaveLength(1);
    const pr = gitea.pulls[0]!;
    expect(pr.base).toBe("main");
    expect(pr.head).toMatch(/^agent\/fix-booking-page-returns-500-/);
    expect(pr.title).toBe("Fix: booking page returns 500");
    expect(pr.body).toContain("booking form");

    const bare = join(root, "git", "hazman", "sewa.git");
    expect(await git(["--git-dir", bare, "show", `${pr.head}:booking.html`])).toContain("Pick your dates");
    expect(await git(["--git-dir", bare, "show", `${pr.head}:verified.txt`])).toBe("ok"); // the approved command really ran
    expect(await git(["--git-dir", bare, "log", "--format=%s", "-1", "main"])).toBe("init"); // main untouched
    expect(await git(["--git-dir", bare, "log", "--format=%an", "-1", pr.head])).toBe("Coder (Agent Office)");

    const coderEvents = web.events.filter((e) => e.run_id === done.run_id);
    const cats = of(coderEvents, "agent.tool_call").map((e) => e.payload.category);
    expect(cats).toContain("code");
    expect(cats).toContain("shell");
    expect(cats).toContain("git");
    expect(of(coderEvents, "artifact.created").some((e) => e.payload.kind === "pr")).toBe(true);
    // The real LLM key never left the runner: every upstream call carried it, OpenCode only saw the proxy.
    expect(llm.requests.every((r) => r.auth === "Bearer fake-llm-key")).toBe(true);
  }, 300_000);
});
