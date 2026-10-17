import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";

/**
 * One model step: either some text, or one tool call.
 * Example job input for the `mock-script` model:
 *   { "script": [ { "tool": "run_command", "input": { "command": "git status" } }, { "text": "All clean." } ] }
 */
const ScriptStep = z.union([
  z.object({ text: z.string() }),
  z.object({ tool: z.string(), input: z.record(z.string(), z.unknown()).default({}) }),
]);
export const Script = z.array(ScriptStep).min(1);
export type Script = z.infer<typeof Script>;

const usage = (inp: number, out: number) => ({
  inputTokens: { total: inp, noCache: inp, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: out, text: out, reasoning: undefined },
});

/**
 * A deterministic "LLM" that plays back a script through the real AI SDK tool
 * loop. Used by tests and for trying approvals in the UI without an API key.
 */
export function scriptedModel(script: Script): MockLanguageModelV4 {
  let step = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const s = script[step++] ?? { text: "(script finished)" };
      if ("text" in s) {
        const id = `t${step}`;
        return {
          stream: simulateReadableStream({
            chunkDelayInMs: 5,
            chunks: [
              { type: "text-start" as const, id },
              { type: "text-delta" as const, id, delta: s.text },
              { type: "text-end" as const, id },
              { type: "finish" as const, finishReason: { unified: "stop" as const, raw: undefined }, usage: usage(20, s.text.length) },
            ],
          }),
        };
      }
      return {
        stream: simulateReadableStream({
          chunkDelayInMs: 5,
          chunks: [
            { type: "tool-call" as const, toolCallId: `call_${step}`, toolName: s.tool, input: JSON.stringify(s.input) },
            { type: "finish" as const, finishReason: { unified: "tool-calls" as const, raw: undefined }, usage: usage(20, 10) },
          ],
        }),
      };
    },
  });
}
