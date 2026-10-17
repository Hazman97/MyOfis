import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOL_REGISTRY, runTool } from "../src/index.ts";
import { startFakeGitea, type FakeGitea } from "./fakeGitea.ts";
import { makeCtx } from "./helpers.ts";

let root: string;
let origin: string;
let gitea: FakeGitea;

const sh = async (cwd: string, ...args: string[]) => {
  const p = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  });
  const out = await new Response(p.stdout).text();
  if ((await p.exited) !== 0) throw new Error(`git ${args.join(" ")}: ${await new Response(p.stderr).text()}`);
  return out.trim();
};

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "ao-git-"));
  origin = join(root, "origin.git");
  await sh(root, "init", "--bare", "-b", "main", origin);
  const seed = join(root, "seed");
  await sh(root, "clone", origin, seed);
  writeFileSync(join(seed, "index.html"), "<h1>Sewa Kamera</h1>\n");
  writeFileSync(join(seed, ".gitignore"), "node_modules\n");
  await sh(seed, "add", "-A");
  await sh(seed, "commit", "-m", "init");
  await sh(seed, "push", "origin", "HEAD:refs/heads/main");
  gitea = startFakeGitea();
  gitea.issues.push({ number: 7, title: "Booking button broken", body: "Clicking Book does nothing", labels: ["agent"] });
});
afterAll(() => {
  gitea.stop();
  rmSync(root, { recursive: true, force: true });
});

const t = (n: string) => TOOL_REGISTRY[n]!;

describe("git tools", () => {
  test("clone -> branch -> edit -> commit -> push branch, without approval for a review-level agent", async () => {
    const ws = mkdtempSync(join(root, "ws-"));
    const { ctx, approvals, events } = makeCtx(ws, { permission: "review" });
    expect((await runTool(t("git_clone"), { url: origin }, ctx)).ok).toBe(true);
    expect((await runTool(t("git_branch"), { name: "fix/booking-button" }, ctx)).ok).toBe(true);
    expect((await runTool(t("edit_file"), { path: "repo/index.html", old_text: "Sewa Kamera", new_text: "Sewa Kamera ZV-E10" }, ctx)).ok).toBe(true);
    const status = await runTool(t("git_status"), {}, ctx);
    expect(JSON.stringify(status.output)).toContain("index.html");
    const commit = await runTool(t("git_commit"), { message: "fix: booking button label" }, ctx);
    expect(commit.ok).toBe(true);
    const push = await runTool(t("git_push"), { branch: "fix/booking-button" }, ctx);
    expect(push.ok).toBe(true);
    expect(approvals).toHaveLength(0);
    expect(await sh(root, "--git-dir", origin, "log", "--format=%an|%s", "fix/booking-button", "-1")).toBe("Coder (Agent Office)|fix: booking button label");
    // main untouched
    expect(await sh(root, "--git-dir", origin, "log", "--format=%s", "main", "-1")).toBe("init");
    const cats = events.filter((e) => e.type === "agent.tool_call").map((e) => (e.type === "agent.tool_call" ? e.payload.category : ""));
    expect(cats).toContain("git");
  });

  test("pushing main is dangerous: asks, and nothing is pushed when rejected", async () => {
    const ws = mkdtempSync(join(root, "ws-"));
    const { ctx, approvals } = makeCtx(ws, { permission: "review", approve: false });
    await runTool(t("git_clone"), { url: origin }, ctx);
    writeFileSync(join(ws, "repo", "index.html"), "<h1>hacked</h1>\n");
    await runTool(t("git_commit"), { message: "direct to main" }, ctx);
    const push = await runTool(t("git_push"), { branch: "main" }, ctx);
    expect(approvals.map((a) => a.risk_level)).toEqual(["dangerous"]);
    expect(push.ok).toBe(false);
    expect(await sh(root, "--git-dir", origin, "log", "--format=%s", "main", "-1")).toBe("init");
  });

  test("protected branch names cannot be created; bad names are rejected", async () => {
    const ws = mkdtempSync(join(root, "ws-"));
    const { ctx } = makeCtx(ws);
    await runTool(t("git_clone"), { url: origin }, ctx);
    expect((await runTool(t("git_branch"), { name: "master" }, ctx)).summary).toContain("protected");
    expect((await runTool(t("git_branch"), { name: "--force" }, ctx)).ok).toBe(false);
    expect((await runTool(t("git_branch"), { name: "a..b" }, ctx)).ok).toBe(false);
  });

  test("secret files are never committed", async () => {
    const ws = mkdtempSync(join(root, "ws-"));
    const { ctx } = makeCtx(ws);
    await runTool(t("git_clone"), { url: origin }, ctx);
    writeFileSync(join(ws, "repo", ".env"), "SECRET=1\n");
    writeFileSync(join(ws, "repo", "a.txt"), "ok\n");
    const r = await runTool(t("git_commit"), { message: "add stuff" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.summary).toContain(".env");
    const staged = await sh(join(ws, "repo"), "diff", "--cached", "--name-only");
    expect(staged).not.toContain(".env");
  });

  test("clone refuses option-like URLs", async () => {
    const ws = mkdtempSync(join(root, "ws-"));
    const { ctx } = makeCtx(ws);
    expect((await runTool(t("git_clone"), { url: "--upload-pack=evil" }, ctx)).ok).toBe(false);
  });
});

describe("gitea tools", () => {
  test("list issues, open PR, comment, CI status", async () => {
    const ws = mkdtempSync(join(root, "ws-"));
    const { ctx, events } = makeCtx(ws, { gitea: { url: gitea.url, token: gitea.token } });
    const issues = await runTool(t("gitea_list_issues"), { owner: "hazman", repo: "sewa", label: "agent" }, ctx);
    expect((issues.output as { number: number }[])[0]!.number).toBe(7);

    const pr = await runTool(t("gitea_create_pr"), { owner: "hazman", repo: "sewa", head: "fix/booking-button", title: "Fix booking button" }, ctx);
    expect(pr.ok).toBe(true);
    expect(gitea.pulls[0]).toMatchObject({ head: "fix/booking-button", base: "main" });
    expect(events.some((e) => e.type === "artifact.created" && e.payload.kind === "pr")).toBe(true);

    expect((await runTool(t("gitea_comment"), { owner: "hazman", repo: "sewa", number: 7, body: "Fixed in PR" }, ctx)).ok).toBe(true);
    gitea.statuses["main"] = "success";
    const ci = await runTool(t("gitea_ci_status"), { owner: "hazman", repo: "sewa" }, ctx);
    expect((ci.output as { state: string }).state).toBe("success");

    // The token is sent to Gitea but never appears in events.
    expect(gitea.requests.every((r) => r.auth === `token ${gitea.token}`)).toBe(true);
    expect(JSON.stringify(events)).not.toContain(gitea.token);
  });

  test("wrong token surfaces Gitea's 401 as a tool error; missing config is denied", async () => {
    const ws = mkdtempSync(join(root, "ws-"));
    const bad = makeCtx(ws, { gitea: { url: gitea.url, token: "wrong" } });
    const r = await runTool(t("gitea_list_issues"), { owner: "a", repo: "b" }, bad.ctx);
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("401");
    const none = makeCtx(ws);
    expect((await runTool(t("gitea_list_issues"), { owner: "a", repo: "b" }, none.ctx)).summary).toContain("not configured");
  });

  test("owner/repo names are validated (no path tricks)", async () => {
    const ws = mkdtempSync(join(root, "ws-"));
    const { ctx } = makeCtx(ws, { gitea: { url: gitea.url, token: gitea.token } });
    expect((await runTool(t("gitea_list_issues"), { owner: "../admin", repo: "x" }, ctx)).ok).toBe(false);
  });
});

describe("handoff tool", () => {
  test("only to known agents; queues the request", async () => {
    const ws = mkdtempSync(join(root, "ws-"));
    const { ctx, handoffs } = makeCtx(ws, { targets: [{ slug: "coder", name: "Coder", role: "dev" }] });
    const bad = await runTool(t("handoff"), { to_agent: "ghost", title: "Fix it", details: "x", reason: "y" }, ctx);
    expect(bad.ok).toBe(false);
    expect(bad.summary).toContain("coder");
    const ok = await runTool(t("handoff"), { to_agent: "coder", title: "Fix booking", details: "steps…", reason: "page broken" }, ctx);
    expect(ok.ok).toBe(true);
    expect(handoffs).toEqual([{ to_agent: "coder", title: "Fix booking", input: { text: "steps…", from_agent: "coder" }, reason: "page broken", project_id: null }]);
  });
});
