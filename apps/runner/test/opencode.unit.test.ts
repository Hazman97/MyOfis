import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentConfig, type RunAssignment } from "@agent-office/shared";
import { GIT_DENY, buildOpenCodeSetup, buildPermissions, findRepoOpenCodeConfig } from "../src/opencode/config.ts";
import { startLlmProxy, upstreamBase } from "../src/opencode/llmProxy.ts";
import { describeAsk, repoUrlFor, riskOf } from "../src/opencode/runtime.ts";
import type { RunContext } from "../src/runtimes/types.ts";
import { startFakeOpenAI } from "./fakeOpenAI.ts";

const agent = (over: { allow?: string[]; level?: "safe" | "review" } = {}) =>
  ({
    model: "m",
    config: AgentConfig.parse({ shell_allowlist: over.allow ?? [], runtime: "opencode" }),
    permission_level: over.level ?? "review",
  }) as unknown as RunAssignment["agent"];

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

describe("OpenCode permissions", () => {
  test("bash: catch-all first, allowlist next, git denies last (OpenCode applies the last match)", () => {
    const bash = buildPermissions(agent({ allow: ["bun test"] })).bash as Record<string, string>;
    const keys = Object.keys(bash);
    expect(keys[0]).toBe("*");
    expect(bash["*"]).toBe("ask");
    expect(bash["bun test"]).toBe("allow");
    expect(bash["bun test *"]).toBe("allow");
    expect(keys.slice(-GIT_DENY.length)).toEqual(GIT_DENY);
    for (const k of GIT_DENY) expect(bash[k]).toBe("deny");
    expect(keys.indexOf("bun test *")).toBeLessThan(keys.indexOf("git push*"));
  });

  test("edit follows permission level; secrets denied for read and edit; web and outside paths denied", () => {
    const review = buildPermissions(agent({ level: "review" }));
    const safe = buildPermissions(agent({ level: "safe" }));
    expect((review.edit as Record<string, string>)["*"]).toBe("allow");
    expect((safe.edit as Record<string, string>)["*"]).toBe("ask");
    for (const p of [review.read, review.edit] as Record<string, string>[]) {
      expect(p[".env"]).toBe("deny");
      expect(p["*.pem"]).toBe("deny");
      expect(Object.keys(p)[0]).toBe("*");
    }
    expect(review.webfetch).toBe("deny");
    expect(review.external_directory).toBe("deny");
    expect(review["*"]).toBe("ask");
  });

  test("setup: OpenCode only gets the proxy URL and token, never the real key", () => {
    const a = { agent: agent(), provider: { slug: "x", kind: "openai_compatible", base_url: "https://up.example/v1", api_key: "sk-REAL-KEY-123456789" } } as unknown as RunAssignment;
    const s = buildOpenCodeSetup(a, { baseUrl: "http://127.0.0.1:1/v1", token: "aorun-tok" });
    const all = JSON.stringify(s);
    expect(all).not.toContain("sk-REAL-KEY");
    expect(all).toContain("aorun-tok");
    expect(s.env.OPENCODE_DISABLE_CLAUDE_CODE).toBe("1");
    expect(Object.keys(s.env)).not.toContain("SECRETS_KEY");
  });

  test("repo-shipped OpenCode config is detected", () => {
    const d = mkdtempSync(join(tmpdir(), "ao-occfg-"));
    cleanup.push(() => rmSync(d, { recursive: true, force: true }));
    expect(findRepoOpenCodeConfig(d)).toEqual([]);
    writeFileSync(join(d, "opencode.json"), "{}");
    mkdirSync(join(d, ".opencode"));
    expect(findRepoOpenCodeConfig(d).sort()).toEqual([".opencode", "opencode.json"]);
  });
});

describe("LLM proxy", () => {
  test("requires the run token, only allows chat + models, injects the real key", async () => {
    const fake = startFakeOpenAI([{ text: "hi" }], "sk-real");
    cleanup.push(fake.stop);
    const proxy = startLlmProxy({ slug: "f", kind: "openai_compatible", base_url: fake.url, api_key: "sk-real" });
    cleanup.push(proxy.stop);
    const post = (path: string, token: string | null) =>
      fetch(`${proxy.baseUrl.replace(/\/v1$/, "")}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "x" }], tools: [{ type: "function", function: { name: "t", parameters: {} } }] }),
      });
    expect((await post("/v1/chat/completions", null)).status).toBe(401);
    expect((await post("/v1/chat/completions", "sk-real")).status).toBe(401); // the real key is not the proxy token
    expect((await post("/v1/files", proxy.token)).status).toBe(403);
    expect((await post("/v1/chat/completions", proxy.token)).status).toBe(200);
    expect(fake.requests.at(-1)?.auth).toBe("Bearer sk-real");
  });

  test("only OpenAI-compatible providers are supported", () => {
    expect(upstreamBase({ slug: "a", kind: "anthropic", base_url: null, api_key: "k" })).toBeNull();
    expect(upstreamBase({ slug: "o", kind: "openai", base_url: null, api_key: "k" })).toBe("https://api.openai.com/v1");
    expect(() => startLlmProxy({ slug: "a", kind: "anthropic", base_url: null, api_key: "k" })).toThrow(/OpenAI-compatible/);
  });
});

describe("runtime helpers", () => {
  const ctx = (input: Record<string, unknown>, projectId: string | null, repo: string | null) =>
    ({ assignment: { job: { input, project_id: projectId }, projects: [{ id: "p1", slug: "s", name: "S", live_url: null, repo_url: repo }] } }) as unknown as RunContext;

  test("repo URL comes from the job input or the job's project, never guessed", () => {
    expect(repoUrlFor(ctx({ repo_url: "https://g/x/y.git" }, null, null))).toBe("https://g/x/y.git");
    expect(repoUrlFor(ctx({}, "p1", "https://g/a/b.git"))).toBe("https://g/a/b.git");
    expect(repoUrlFor(ctx({}, "p1", null))).toBeNull();
    expect(repoUrlFor(ctx({}, null, "https://g/a/b.git"))).toBeNull(); // no project on the job: no guessing
  });

  test("risk and wording of OpenCode permission asks", () => {
    const ask = (permission: string, metadata: Record<string, unknown> = {}, patterns: string[] = []) => ({ id: "1", sessionID: "s", permission, metadata, patterns });
    expect(riskOf(ask("bash", { command: "rm -rf build" }))).toBe("dangerous");
    expect(riskOf(ask("external_directory"))).toBe("dangerous");
    expect(riskOf(ask("edit"))).toBe("review");
    expect(describeAsk(ask("bash", { command: "rm -rf build" }))).toBe("run (OpenCode): rm -rf build");
    expect(describeAsk(ask("edit", {}, ["src/a.ts"]))).toBe("edit (OpenCode): src/a.ts");
  });
});
