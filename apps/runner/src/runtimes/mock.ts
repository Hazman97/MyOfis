import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MessageStreamer, jobText } from "./text.ts";
import type { AgentRuntime, RunContext, RunResult } from "./types.ts";

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

/**
 * No LLM. Streams the input back word by word so the full loop (events,
 * cancel, tokens) can be exercised without API keys.
 * Models: `mock-echo` (fast), `mock-slow` (~300 ms per word, for testing cancel),
 * `mock-fail` (throws half-way).
 */
export const mockRuntime: AgentRuntime = {
  id: "mock",
  async execute(ctx: RunContext): Promise<RunResult> {
    const { model } = ctx.assignment.agent;
    const delay = model === "mock-slow" ? 300 : 20;
    const text = jobText(ctx);
    const words = text.split(/(\s+)/).filter(Boolean);

    ctx.emit({ type: "agent.thinking", payload: { summary: `Reading ${words.length} words` } });
    await sleep(delay, ctx.signal);

    const out = new MessageStreamer(ctx, "m1", model === "mock-echo" ? 50 : 250);
    out.push("Echo: ");
    for (let i = 0; i < words.length; i++) {
      if (model === "mock-fail" && i >= words.length / 2) throw new Error("mock-fail model failed on purpose");
      out.push(words[i]!);
      await sleep(delay, ctx.signal);
    }
    out.flush(true);

    const file = join(ctx.workspace, "output.md");
    await writeFile(file, `Echo: ${text}\n`);
    ctx.emit({ type: "artifact.created", payload: { kind: "file", title: "output.md", path: "output.md" } });

    // Rough token estimate: ~4 chars per token.
    return { tokens_in: Math.ceil((ctx.assignment.agent.system_prompt.length + text.length) / 4), tokens_out: Math.ceil(text.length / 4) + 2 };
  },
};
