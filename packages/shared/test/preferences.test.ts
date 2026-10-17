import { describe, expect, test } from "bun:test";
import { AgentConfig, AgentPreferences, preferencesPrompt } from "../src/index.ts";

describe("agent preferences", () => {
  test("all on auto adds nothing to the prompt", () => {
    expect(preferencesPrompt(AgentPreferences.parse({}))).toBe("");
    expect(preferencesPrompt(undefined)).toBe("");
  });

  test("choices and notes become plain instructions after the role", () => {
    const p = preferencesPrompt({ language: "manglish", length: "short", emoji: "none", notes: "Panggil saya boss" });
    expect(p).toContain("## How the owner wants you to work");
    expect(p).toContain("Manglish");
    expect(p).toContain("Keep replies short");
    expect(p).toContain("Do not use emoji.");
    expect(p).toContain('The owner also said: "Panggil saya boss"');
    expect(p).not.toContain("tone");
  });

  test("older agents without preferences still parse", () => {
    expect(AgentConfig.parse({}).preferences).toEqual(AgentPreferences.parse({}));
  });
});

describe("fixEscapedNewlines", () => {
  test("turns literal backslash-n back into line breaks when they outnumber real ones", async () => {
    const { fixEscapedNewlines } = await import("../src/index.ts");
    // what the model sent: "## Title\n\n- one" with the backslashes as text
    expect(fixEscapedNewlines(String.raw`## Title\n\n- **one**\n- two`)).toBe("## Title\n\n- **one**\n- two");
    // a trailing real line break does not stop the fix
    expect(fixEscapedNewlines(String.raw`a\nb\nc` + "\n")).toBe("a\nb\nc\n");
    // real Markdown that mentions \n once (e.g. in code) is left alone
    const md = "line one\nline two\n`" + String.raw`\n` + "` is a newline\n";
    expect(fixEscapedNewlines(md)).toBe(md);
    expect(fixEscapedNewlines("no breaks at all")).toBe("no breaks at all");
  });
});
