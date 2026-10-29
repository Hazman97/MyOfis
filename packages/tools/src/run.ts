import { randomUUID } from "node:crypto";
import { redact } from "@agent-office/shared";
import { needsApproval } from "./safety.ts";
import { ToolDenied, type ToolContext, type ToolDef, type ToolOutput } from "./types.ts";

const MAX_ARG_CHARS = 400;
export const MAX_FAILED_RETRIES = 2;

const failedCalls = new WeakMap<ToolContext, Map<string, { count: number; lastSummary: string }>>();

function stableJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${stableJson(val)}`).join(",")}}`;
}

export function toolCallKey(toolName: string, input: unknown): string {
  return `${toolName}:${stableJson(input)}`;
}

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
  const sig = toolCallKey(def.name, rawInput);
  const parsed = def.input.safeParse(rawInput);
  ctx.emit({
    type: "agent.tool_call",
    payload: { call_id: callId, tool: def.name, category: def.category, args: sanitizeArgs(rawInput) },
  });
  const finish = (out: ToolOutput) => {
    let map = failedCalls.get(ctx);
    if (!map) {
      map = new Map();
      failedCalls.set(ctx, map);
    }
    if (!out.ok) {
      const prev = map.get(sig);
      map.set(sig, { count: (prev?.count ?? 0) + 1, lastSummary: out.summary });
    } else {
      map.delete(sig);
    }
    ctx.emit({
      type: "agent.tool_result",
      payload: { call_id: callId, tool: def.name, ok: out.ok, summary: String(redact(out.summary)).slice(0, 500) },
    });
    return out;
  };

  const prior = failedCalls.get(ctx)?.get(sig);
  if (prior && prior.count >= MAX_FAILED_RETRIES) {
    const msg = `${def.name} already failed ${prior.count} times with the exact same input (${prior.lastSummary}). Do not retry with identical arguments; change the input or stop and explain the issue.`;
    return finish({ ok: false, summary: `refused repeated failed call (${def.name})`, output: { error: msg, refused_repeat: true } });
  }

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
