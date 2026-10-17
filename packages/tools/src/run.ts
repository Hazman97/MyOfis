import { randomUUID } from "node:crypto";
import { redact } from "@agent-office/shared";
import { needsApproval } from "./safety.ts";
import { ToolDenied, type ToolContext, type ToolDef, type ToolOutput } from "./types.ts";

const MAX_ARG_CHARS = 400;

/** Redacted, length-capped copy of tool args, safe for the event log. */
export function sanitizeArgs(input: unknown): Record<string, unknown> {
  const clip = (v: unknown): unknown => {
    if (typeof v === "string") return v.length > MAX_ARG_CHARS ? `${v.slice(0, MAX_ARG_CHARS)}… (${v.length} chars)` : v;
    if (Array.isArray(v)) return v.slice(0, 20).map(clip);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).slice(0, 20).map(([k, x]) => [k, clip(x)]));
    return v;
  };
  const value = clip(redact(input));
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : { value };
}

/**
 * The one path every tool call goes through:
 * validate → assess risk → (approval) → execute → events.
 * Never throws for tool-level problems; the model gets an error result instead.
 */
export async function runTool(def: ToolDef, rawInput: unknown, ctx: ToolContext): Promise<ToolOutput> {
  const callId = randomUUID();
  const parsed = def.input.safeParse(rawInput);
  ctx.emit({
    type: "agent.tool_call",
    payload: { call_id: callId, tool: def.name, category: def.category, args: sanitizeArgs(rawInput) },
  });
  const finish = (out: ToolOutput) => {
    ctx.emit({
      type: "agent.tool_result",
      payload: { call_id: callId, tool: def.name, ok: out.ok, summary: String(redact(out.summary)).slice(0, 500) },
    });
    return out;
  };

  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    return finish({ ok: false, summary: `invalid input: ${msg}`, output: { error: `invalid input: ${msg}` } });
  }
  const input = parsed.data;

  try {
    const risk = def.risk(input, ctx);
    if (needsApproval(risk, ctx.permissionLevel)) {
      const approved = await ctx.requestApproval({
        action: def.describe(input),
        risk_level: risk,
        details: { tool: def.name, args: sanitizeArgs(input) },
      });
      if (!approved) {
        return finish({
          ok: false,
          summary: "rejected by owner",
          output: { error: "The owner rejected this action. Do not retry it; choose another approach or stop." },
        });
      }
    }
    if (ctx.signal.aborted) throw ctx.signal.reason;
    return finish(await def.execute(input, ctx));
  } catch (err) {
    if (ctx.signal.aborted) throw err; // cancellation ends the run
    const message = err instanceof Error ? err.message : String(err);
    const denied = err instanceof ToolDenied;
    return finish({ ok: false, summary: denied ? `denied: ${message}` : `error: ${message}`, output: { error: message } });
  }
}
