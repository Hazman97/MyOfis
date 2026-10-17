import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PermissionLevel } from "@agent-office/shared";
import { TOOL_REGISTRY, runTool } from "../src/index.ts";
import { makeCtx } from "./helpers.ts";

let ws: string;
beforeAll(() => {
  ws = mkdtempSync(join(tmpdir(), "ao-run-"));
  mkdirSync(join(ws, "src"));
  writeFileSync(join(ws, "src", "a.ts"), "const a = 1;\nconst b = 2;\n");
  writeFileSync(join(ws, ".env"), "SECRETS_KEY=abc");
});
afterAll(() => rmSync(ws, { recursive: true, force: true }));

function ctx(opts: { permission?: PermissionLevel; approve?: boolean; allow?: string[] } = {}) {
  const { ctx: c, events, approvals } = makeCtx(ws, opts);
  return { c, events, approvals };
}
const tool = (name: string) => TOOL_REGISTRY[name]!;

describe("runTool", () => {
  test("safe read runs without approval and emits call + result", async () => {
    const { c, events, approvals } = ctx({ permission: "safe" });
    const out = await runTool(tool("read_file"), { path: "src/a.ts" }, c);
    expect(out.ok).toBe(true);
    expect((out.output as { content: string }).content).toContain("const a");
    expect(approvals).toHaveLength(0);
    expect(events.map((e) => e.type)).toEqual(["agent.tool_call", "agent.tool_result"]);
    const call = events[0]!;
    if (call.type !== "agent.tool_call") throw new Error();
    expect(call.payload.category).toBe("read_docs");
  });

  test("reading .env is denied", async () => {
    const { c } = ctx();
    const out = await runTool(tool("read_file"), { path: ".env" }, c);
    expect(out.ok).toBe(false);
    expect(out.summary).toContain("secret");
  });

  test("list_dir hides secret files", async () => {
    const { c } = ctx();
    const out = await runTool(tool("list_dir"), { path: "." }, c);
    expect((out.output as { entries: string[] }).entries).not.toContain(".env");
  });

  test("write asks for approval when agent is 'safe', rejection is not executed", async () => {
    const { c, approvals } = ctx({ permission: "safe", approve: false });
    const out = await runTool(tool("write_file"), { path: "out.txt", content: "hi" }, c);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]!.risk_level).toBe("review");
    expect(out.ok).toBe(false);
    expect(out.summary).toBe("rejected by owner");
    expect(() => readFileSync(join(ws, "out.txt"))).toThrow();
  });

  test("write does not ask when agent is trusted with 'review'", async () => {
    const { c, approvals } = ctx({ permission: "review" });
    const out = await runTool(tool("write_file"), { path: "out.txt", content: "hi" }, c);
    expect(out.ok).toBe(true);
    expect(approvals).toHaveLength(0);
    expect(readFileSync(join(ws, "out.txt"), "utf8")).toBe("hi");
  });

  test("edit_file requires a unique match", async () => {
    const { c } = ctx();
    expect((await runTool(tool("edit_file"), { path: "src/a.ts", old_text: "const", new_text: "let" }, c)).ok).toBe(false);
    expect((await runTool(tool("edit_file"), { path: "src/a.ts", old_text: "const b", new_text: "let b" }, c)).ok).toBe(true);
    expect(readFileSync(join(ws, "src", "a.ts"), "utf8")).toContain("let b = 2");
  });

  test("allowlisted command runs; others are dangerous and need approval", async () => {
    const allowed = ctx({ allow: ["bun --version"] });
    const out = await runTool(tool("run_command"), { command: "bun --version" }, allowed.c);
    expect(out.ok).toBe(true);
    expect(allowed.approvals).toHaveLength(0);

    const other = ctx({ allow: ["bun --version"], approve: false });
    const denied = await runTool(tool("run_command"), { command: "bun --print 1+1" }, other.c);
    expect(other.approvals[0]!.risk_level).toBe("dangerous");
    expect(other.approvals[0]!.action).toBe("run: bun --print 1+1");
    expect(denied.ok).toBe(false);

    const yes = ctx({ allow: [], approve: true });
    const ran = await runTool(tool("run_command"), { command: "bun --print 1+1" }, yes.c);
    expect(ran.ok).toBe(true);
    expect((ran.output as { stdout: string }).stdout.trim()).toBe("2");
  });

  test("child processes do not see hub secrets", async () => {
    process.env.SECRETS_KEY_TEST_PROBE = "leak-me";
    const { c } = ctx({ approve: true });
    const out = await runTool(tool("run_command"), { command: `bun --print "process.env.SECRETS_KEY_TEST_PROBE ?? 'none'"` }, c);
    expect((out.output as { stdout: string }).stdout.trim()).toBe("none");
    delete process.env.SECRETS_KEY_TEST_PROBE;
  });

  test("invalid input becomes an error result, not a crash", async () => {
    const { c } = ctx();
    const out = await runTool(tool("read_file"), { nope: 1 }, c);
    expect(out.ok).toBe(false);
    expect(out.summary).toContain("invalid input");
  });

  test("tool_call args are redacted", async () => {
    const { c, events } = ctx({ approve: false });
    await runTool(tool("write_file"), { path: "k.txt", content: "token=sk-ant-api03-abcdefghijklmnopqrstuvwxyz" }, c);
    const call = events.find((e) => e.type === "agent.tool_call");
    expect(JSON.stringify(call)).not.toContain("abcdefghijklmnop");
  });
});
