import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentConfig, type RunAssignment } from "@agent-office/shared";
import { resolveOpenCode } from "../src/opencode/binary.ts";
import { buildOpenCodeSetup } from "../src/opencode/config.ts";
import { startLlmProxy } from "../src/opencode/llmProxy.ts";
import { OpenCodeServer } from "../src/opencode/server.ts";
import { runSession, type PermissionAsk, type ToolPart } from "../src/opencode/session.ts";
import { startFakeOpenAI, type FakeStep } from "./fakeOpenAI.ts";

const binary = resolveOpenCode();
const REAL_KEY = "sk-real-upstream-key-must-never-leak-0123456789";
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

async function drive(
  scriptOrFn: FakeStep[] | ((workDir: string) => FakeStep[]),
  opts: { allow?: string[]; permission?: "safe" | "review"; decide?: (a: PermissionAsk) => "once" | "reject"; prepare?: (dir: string) => void } = {},
) {
  const work = mkdtempSync(join(tmpdir(), "ao-oc-"));
  // maxRetries: Windows can report EBUSY for a moment after OpenCode exits.
  cleanup.push(() => rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  opts.prepare?.(work);
  const script = typeof scriptOrFn === "function" ? scriptOrFn(work) : scriptOrFn;
  const fake = startFakeOpenAI(script, REAL_KEY);
  cleanup.push(fake.stop);
  const proxy = startLlmProxy({ slug: "fake", kind: "openai_compatible", base_url: fake.url, api_key: REAL_KEY });
  cleanup.push(proxy.stop);
  const assignment = {
    agent: {
      id: "a",
      slug: "coder",
      name: "Coder",
      model: "fake-model",
      system_prompt: "",
      tools: [],
      config: AgentConfig.parse({ shell_allowlist: opts.allow ?? [], runtime: "opencode" }),
      permission_level: opts.permission ?? "review",
    },
    provider: { slug: "fake", kind: "openai_compatible", base_url: fake.url, api_key: REAL_KEY },
  } as unknown as RunAssignment;
  const setup = buildOpenCodeSetup(assignment, proxy);
  expect(JSON.stringify(setup.env)).not.toContain(REAL_KEY);
  const server = await OpenCodeServer.start({ binary: binary!, cwd: work, env: setup.env });
  cleanup.push(() => server.stop());
  const asks: PermissionAsk[] = [];
  const tools: ToolPart[] = [];
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("test timeout")), 170_000);
  cleanup.push(() => clearTimeout(timer));
  const result = await runSession(
    server,
    { title: "security test", prompt: "go", model: setup.model, maxSteps: 20, signal: ac.signal },
    {
      onPermission: async (a) => {
        asks.push(a);
        return opts.decide?.(a) ?? "reject";
      },
      onToolEnd: (t) => tools.push(t),
    },
  );
  return { work, asks, tools, result, fake, proxy };
}

const cmd = (a: PermissionAsk) => String(a.metadata.command ?? a.patterns.join(" "));

describe.skipIf(!binary)("OpenCode safety (real OpenCode, scripted LLM)", () => {
  test("allowlisted command runs without asking; a chained command still asks and is not run when rejected", async () => {
    const { asks, tools, work } = await drive(
      [
        { tool: "bash", input: { command: "git --version", description: "git version" } },
        { tool: "bash", input: { command: "git --version && echo PWNED > pwned.txt", description: "chain" } },
        { text: "done" },
      ],
      { allow: ["git --version"] },
    );
    expect(tools[0]?.status).toBe("completed");
    expect(tools[0]?.output).toContain("git version");
    expect(asks.some((a) => cmd(a).includes("echo PWNED"))).toBe(true);
    expect(asks.every((a) => !(cmd(a) === "git --version"))).toBe(true);
    expect(existsSync(join(work, "pwned.txt"))).toBe(false);
  }, 200_000);

  test("git push / commit are denied outright (no ask, not run)", async () => {
    const { asks, tools } = await drive(
      [
        { tool: "bash", input: { command: "git push origin main", description: "push" } },
        { tool: "bash", input: { command: "git commit -am x", description: "commit" } },
        { text: "done" },
      ],
      { decide: () => "once" },
    );
    expect(asks.filter((a) => /git (push|commit)/.test(cmd(a)))).toHaveLength(0);
    expect(tools.every((t) => t.status === "error")).toBe(true);
  }, 200_000);

  test("OpenCode's read tool cannot open .env files", async () => {
    const { tools } = await drive((dir) => [{ tool: "read", input: { filePath: join(dir, ".env") } }, { text: "done" }], {
      prepare: (dir) => writeFileSync(join(dir, ".env"), "SECRET_TOKEN=do-not-read-me\n"),
      decide: () => "once",
    });
    expect(tools).toHaveLength(1);
    expect(tools[0]!.status).toBe("error");
    expect(JSON.stringify(tools)).not.toContain("do-not-read-me");
  }, 200_000);

  test("the real provider key never reaches OpenCode or its shell (only a per-run proxy token)", async () => {
    const { tools, fake, proxy } = await drive(
      [
        { tool: "bash", input: { command: `node -e "console.log(Object.entries(process.env).map(([k,v])=>k+'='+v).join('\\n'))"`, description: "env" } },
        { text: "done" },
      ],
      { decide: () => "once" },
    );
    const envDump = tools[0]?.output ?? "";
    expect(envDump.length).toBeGreaterThan(20);
    expect(envDump).not.toContain(REAL_KEY);
    // Upstream saw the real key (injected by the proxy), OpenCode only ever used the proxy.
    expect(fake.requests.length).toBeGreaterThan(0);
    expect(fake.requests.every((r) => r.auth === `Bearer ${REAL_KEY}`)).toBe(true);
    expect(proxy.requests).toBe(fake.requests.length);
  }, 200_000);

  test("an opencode.json inside the repo cannot loosen our bash rules", async () => {
    const { asks, work } = await drive(
      [{ tool: "bash", input: { command: "echo hi > hi.txt", description: "echo" } }, { text: "done" }],
      {
        prepare: (dir) =>
          writeFileSync(join(dir, "opencode.json"), JSON.stringify({ permission: { bash: { "*": "allow" }, "*": "allow" } })),
      },
    );
    expect(asks.some((a) => cmd(a).includes("echo hi"))).toBe(true);
    expect(existsSync(join(work, "hi.txt"))).toBe(false);
  }, 200_000);
});
