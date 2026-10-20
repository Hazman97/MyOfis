import { expect, test } from "bun:test";
import { STUCK_STEPS, repairForBridge, repeatStop, repeating, runTokenLimit, stuckStop, toolErrors } from "../src/runtimes/aiSdk.ts";

const step = (text: string, ok: number, errors: { toolName: string; error: unknown }[] = []) => ({
  text,
  toolResults: Array.from({ length: ok }, () => ({})),
  content: errors.map((e) => ({ type: "tool-error", ...e })),
});

test("a run stops after STUCK_STEPS steps in a row with no text and no working tool call", async () => {
  const stop = stuckStop();
  const bad = step("", 0, [{ toolName: "get_editor_url", error: new Error("no such tool") }]);
  expect(await stop({ steps: [step("", 1), bad, bad] as never })).toBe(false);
  expect(await stop({ steps: Array.from({ length: STUCK_STEPS }, () => bad) as never })).toBe(true);
  // one working step in the last few keeps it going
  expect(await stop({ steps: [bad, bad, step("", 1)] as never })).toBe(false);
  expect(await stop({ steps: [bad, bad, step("Here is the link", 0)] as never })).toBe(false);
  expect(toolErrors(bad)).toEqual(["get_editor_url: no such tool"]);
});

test("an OpenChatCut tool called by its own name goes through the openchatcut bridge", async () => {
  const repair = repairForBridge(["openchatcut", "memory"]);
  const call = (toolName: string, input: unknown) => ({ type: "tool-call" as const, toolCallId: "c1", toolName, input: JSON.stringify(input) });
  expect(await repair({ toolCall: call("get_editor_url", { projectId: "p1" }), error: { name: "AI_NoSuchToolError" } })).toMatchObject({
    toolName: "openchatcut",
    input: JSON.stringify({ tool: "get_editor_url", arguments: { projectId: "p1" } }),
  });
  // arguments sent as a JSON string, or the tool under "name"
  expect(await repair({ toolCall: call("openchatcut", { name: "list_projects", arguments: "{\"includeDeleted\":false}" }), error: { name: "AI_InvalidToolInputError" } })).toMatchObject({
    toolName: "openchatcut",
    input: JSON.stringify({ tool: "list_projects", arguments: { includeDeleted: false } }),
  });
  // agents without the bridge are left alone
  expect(await repairForBridge(["memory"])({ toolCall: call("get_editor_url", {}), error: { name: "AI_NoSuchToolError" } })).toBeNull();
});

test("the same tool call 3 times in a row is a loop; different calls are not", async () => {
  const call = (toolName: string, input: unknown) => ({ toolCalls: [{ toolName, input }] });
  const same = call("openchatcut", { tool: "list_projects", arguments: {} });
  expect(repeating([same, same])).toBe(false);
  expect(repeating([call("memory", {}), same, same, same])).toBe(true);
  expect(repeating([same, call("openchatcut", { tool: "read_timeline", arguments: {} }), same])).toBe(false);
  // steps without tool calls are not a "same call" loop (the stuck guard handles them)
  expect(repeating([{ toolCalls: [] }, { toolCalls: [] }, { toolCalls: [] }])).toBe(false);
  expect(await repeatStop()({ steps: [same, same, same] as never })).toBe(true);
});

test("a run's token limit is its own cap, or today's budget when that is smaller", () => {
  expect(runTokenLimit(250_000, null)).toBe(250_000);
  expect(runTokenLimit(250_000, 40_000)).toBe(40_000);
  expect(runTokenLimit(undefined, 40_000)).toBe(40_000);
  expect(runTokenLimit(undefined, null)).toBeNull();
});
