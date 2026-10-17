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
