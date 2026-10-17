import { z } from "zod";
import { JobTrigger, RiskLevel, ToolCategory } from "./entities.ts";

/**
 * Event bodies: `{ type, payload }`. The hub wraps each body in an envelope
 * (id, ts, run_id, agent_id) when it is appended to the event log.
 */
const body = <T extends string, P extends z.ZodRawShape>(type: T, payload: P) =>
  z.object({ type: z.literal(type), payload: z.object(payload) });

const tokens = {
  tokens_in: z.number().int().nonnegative(),
  tokens_out: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative(),
};

export const EVENT_BODIES = [
  body("runner.online", { runner_id: z.string(), name: z.string() }),
  body("runner.offline", { runner_id: z.string(), name: z.string() }),

  body("system.paused", { paused: z.boolean() }),

  body("job.created", {
    job_id: z.string(),
    agent_id: z.string(),
    project_id: z.string().nullable(),
    type: z.string(),
    title: z.string(),
    trigger: JobTrigger,
    parent_job_id: z.string().nullable(),
  }),
  body("job.queued", { job_id: z.string() }),
  body("job.cancelled", { job_id: z.string(), reason: z.string().optional() }),

  body("run.started", { run_id: z.string(), job_id: z.string(), agent_id: z.string(), runner_id: z.string() }),
  body("run.finished", {
    run_id: z.string(),
    job_id: z.string(),
    status: z.enum(["done", "cancelled"]),
    ...tokens,
    /** True when the model has no known price, so cost_usd is 0 but not actually free. */
    cost_unknown: z.boolean().default(false),
  }),
  body("run.failed", {
    run_id: z.string(),
    job_id: z.string(),
    error: z.string(),
    ...tokens,
    cost_unknown: z.boolean().default(false),
  }),

  /** Short summary only — never raw chain-of-thought. */
  body("agent.thinking", { summary: z.string().max(500) }),
  /** Streamed text. Chunks with the same message_id are concatenated in order. */
  body("agent.message", { message_id: z.string(), text: z.string(), final: z.boolean().default(false) }),
  body("agent.tool_call", {
    call_id: z.string(),
    tool: z.string(),
    category: ToolCategory,
    args: z.record(z.string(), z.unknown()),
  }),
  body("agent.tool_result", { call_id: z.string(), tool: z.string(), ok: z.boolean(), summary: z.string() }),
  body("agent.needs_approval", { approval_id: z.string(), action: z.string(), risk_level: RiskLevel }),
  body("approval.decided", {
    approval_id: z.string(),
    decision: z.enum(["approved", "rejected"]),
    via: z.enum(["web", "telegram"]),
  }),
  body("agent.handoff", { from_agent: z.string(), to_agent: z.string(), new_job_id: z.string(), reason: z.string() }),
  body("artifact.created", {
    kind: z.enum(["screenshot", "file", "pr", "draft", "report"]),
    title: z.string().optional(),
    path: z.string().optional(),
    url: z.string().optional(),
  }),
  body("feature.released", { project_id: z.string(), feature_log_id: z.string() }),
  body("draft.created", { draft_id: z.string(), project_id: z.string(), platform: z.string(), kind: z.string() }),
  body("draft.decided", { draft_id: z.string(), status: z.enum(["approved", "rejected", "edited"]) }),
  body("budget.exceeded", { agent_id: z.string(), used: z.number().int(), budget: z.number().int() }),
  body("agent.idle", { agent_id: z.string() }),
] as const;

export const EventBody = z.discriminatedUnion("type", EVENT_BODIES);
export type EventBody = z.infer<typeof EventBody>;
export type EventType = EventBody["type"];
export const EVENT_TYPES = EVENT_BODIES.map((b) => b.shape.type.value) as EventType[];

export const EventEnvelope = z.object({
  id: z.number().int().positive(),
  ts: z.string(),
  run_id: z.string().nullable(),
  agent_id: z.string().nullable(),
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;

export const AgentEvent = z.intersection(EventEnvelope, EventBody);
export type AgentEvent = EventEnvelope & EventBody;

export type EventOf<T extends EventType> = EventEnvelope & Extract<EventBody, { type: T }>;
export type PayloadOf<T extends EventType> = Extract<EventBody, { type: T }>["payload"];

/** Event types a runner is allowed to emit on its own. Lifecycle events are emitted by the hub. */
export const RUNNER_EVENT_TYPES = [
  "agent.thinking",
  "agent.message",
  "agent.tool_call",
  "agent.tool_result",
  "artifact.created",
] as const satisfies readonly EventType[];

export type RunnerEventBody = Extract<EventBody, { type: (typeof RUNNER_EVENT_TYPES)[number] }>;

export const RunnerEventBody = EventBody.refine(
  (b): b is RunnerEventBody => (RUNNER_EVENT_TYPES as readonly string[]).includes(b.type),
  { message: "event type not allowed from runner" },
);
