import { TIMEZONE, type JobStatus, type JobTrigger, type RiskLevel, type RunStatus, type ToolCategory } from "./entities.ts";
import type { AgentEvent } from "./events.ts";

/**
 * Everything the UI (boring view and, later, the office view) needs to know,
 * derived purely from the event log. Must stay JSON-serialisable: it is sent
 * to the browser as the WS snapshot.
 */
export interface OfficeState {
  last_event_id: number;
  paused: boolean;
  runners: Record<string, RunnerView>;
  agents: Record<string, AgentView>;
  jobs: Record<string, JobView>;
  runs: Record<string, RunView>;
  /** USD by day (YYYY-MM-DD in Asia/Kuala_Lumpur). */
  cost_by_day: Record<string, number>;
  /** Approvals waiting for the owner, by approval id. */
  pending_approvals: Record<string, PendingApproval>;
  /** Content drafts waiting for the owner, by draft id. */
  pending_drafts: Record<string, PendingDraft>;
  /** Skill proposals waiting for the owner, by proposal id. */
  pending_skills: Record<string, { id: string; name: string; action: string; agent_id: string | null; created_at: string }>;
}

export interface PendingDraft {
  id: string;
  project_id: string;
  agent_id: string | null;
  platform: string;
  kind: string;
  created_at: string;
  /** Set when the draft changed while pending (draft.updated), so open inboxes reload it. */
  updated_at?: string;
}

export interface PendingApproval {
  id: string;
  run_id: string | null;
  agent_id: string | null;
  action: string;
  risk_level: RiskLevel;
  requested_at: string;
}

export interface RunnerView {
  id: string;
  name: string;
  online: boolean;
  since: string;
}

export type AgentActivity = "idle" | "working" | "waiting_approval" | "away";

/**
 * A one-off thing worth acting out in the office view (walk a document over,
 * pin a PR, look dizzy). Identified by the event that caused it, so a viewer
 * can tell a new moment from one it has already shown.
 */
export interface AgentMoment {
  kind: "handoff" | "delivered" | "failed" | "pr_opened" | "draft_pinned" | "feature_pinned" | "skill_shelved" | "praised";
  event_id: number;
  at: string;
  /** handoff: slug of the agent receiving the work. */
  to_agent: string | null;
}

export interface AgentView {
  id: string;
  activity: AgentActivity;
  current_run_id: string | null;
  last_tool_category: ToolCategory | null;
  /** Name of the last tool called (e.g. read_brief sends Marketing to the file cabinets). */
  last_tool: string | null;
  last_message: string | null;
  /** Latest short thinking note while busy; cleared by the next tool call, message or run end. */
  thinking: string | null;
  moment: AgentMoment | null;
  /** Tokens (in + out) by day. */
  tokens_by_day: Record<string, number>;
}

export interface JobView {
  id: string;
  agent_id: string;
  project_id: string | null;
  title: string;
  type: string;
  trigger: JobTrigger;
  parent_job_id: string | null;
  status: JobStatus;
  created_at: string;
  run_ids: string[];
  /** Why it was cancelled (owner, time limit, pause), when it was. */
  cancel_reason?: string | null;
}

export interface RunView {
  id: string;
  job_id: string;
  agent_id: string;
  runner_id: string;
  status: RunStatus;
  started_at: string;
  ended_at: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  cost_unknown: boolean;
  error: string | null;
  /** Concatenated text of all agent.message chunks, in order. */
  output: string;
  event_count: number;
  /** What it is doing now: the latest thinking note, or "tool:<name>" after a tool call. */
  step?: string | null;
  /** Tool calls so far. */
  tool_calls?: number;
  /** When the run last sent anything (to spot a run that has gone quiet). */
  last_event_at?: string;
}

export const initialState = (): OfficeState => ({
  last_event_id: 0,
  paused: false,
  runners: {},
  agents: {},
  jobs: {},
  runs: {},
  cost_by_day: {},
  pending_approvals: {},
  pending_drafts: {},
  pending_skills: {},
});

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** YYYY-MM-DD for an ISO timestamp, in the owner's timezone. */
export const dayKey = (ts: string): string => dayFormatter.format(new Date(ts));

const MAX_OUTPUT_CHARS = 20_000;

function agentView(state: OfficeState, id: string): AgentView {
  let a = state.agents[id];
  if (!a) {
    a = {
      id,
      activity: "idle",
      current_run_id: null,
      last_tool_category: null,
      last_tool: null,
      last_message: null,
      thinking: null,
      moment: null,
      tokens_by_day: {},
    };
    state.agents[id] = a;
  }
  return a;
}

const momentOf = (event: AgentEvent, kind: AgentMoment["kind"], to_agent: string | null = null): AgentMoment => ({
  kind,
  event_id: event.id,
  at: event.ts,
  to_agent,
});

/**
 * Applies one event to `s` in place. Deterministic: same state + same event
 * always gives the same result (no clocks, no randomness — the day key comes
 * from the event's own timestamp).
 *
 * Idempotent with respect to replays: events with id <= last_event_id are
 * ignored and `false` is returned.
 */
export function apply(s: OfficeState, event: AgentEvent): boolean {
  if (event.id <= s.last_event_id) return false;
  s.last_event_id = event.id;
  const run = event.run_id ? s.runs[event.run_id] : undefined;
  if (run) {
    run.event_count += 1;
    run.last_event_at = event.ts;
  }

  switch (event.type) {
    case "runner.online":
    case "runner.offline": {
      const { runner_id, name } = event.payload;
      s.runners[runner_id] = { id: runner_id, name, online: event.type === "runner.online", since: event.ts };
      break;
    }
    case "system.paused":
      s.paused = event.payload.paused;
      break;
    case "job.created": {
      const p = event.payload;
      s.jobs[p.job_id] = {
        id: p.job_id,
        agent_id: p.agent_id,
        project_id: p.project_id,
        title: p.title,
        type: p.type,
        trigger: p.trigger,
        parent_job_id: p.parent_job_id,
        status: "queued",
        created_at: event.ts,
        run_ids: [],
      };
      agentView(s, p.agent_id);
      break;
    }
    case "job.queued": {
      const job = s.jobs[event.payload.job_id];
      if (job) job.status = "queued";
      break;
    }
    case "job.cancelled": {
      const job = s.jobs[event.payload.job_id];
      if (job) {
        job.status = "cancelled";
        job.cancel_reason = event.payload.reason ?? null;
        const last = job.run_ids.at(-1);
        const r = last ? s.runs[last] : undefined;
        if (r && !r.error) r.error = event.payload.reason ?? null;
      }
      break;
    }
    case "run.started": {
      const p = event.payload;
      s.runs[p.run_id] = {
        id: p.run_id,
        job_id: p.job_id,
        agent_id: p.agent_id,
        runner_id: p.runner_id,
        status: "running",
        started_at: event.ts,
        ended_at: null,
        tokens_in: 0,
        tokens_out: 0,
        cost_usd: 0,
        cost_unknown: false,
        error: null,
        output: "",
        event_count: 1,
        step: null,
        tool_calls: 0,
        last_event_at: event.ts,
      };
      const job = s.jobs[p.job_id];
      if (job) {
        job.status = "running";
        if (!job.run_ids.includes(p.run_id)) job.run_ids.push(p.run_id);
      }
      const a = agentView(s, p.agent_id);
      a.activity = "working";
      a.current_run_id = p.run_id;
      a.last_tool_category = null;
      a.last_tool = null;
      a.thinking = null;
      break;
    }
    case "run.finished":
    case "run.failed": {
      const p = event.payload;
      const r = s.runs[p.run_id];
      const status: RunStatus = event.type === "run.failed" ? "failed" : event.payload.status;
      if (r) {
        r.status = status;
        r.ended_at = event.ts;
        r.tokens_in = p.tokens_in;
        r.tokens_out = p.tokens_out;
        r.cost_usd = p.cost_usd;
        r.cost_unknown = p.cost_unknown;
        if (event.type === "run.failed") r.error = event.payload.error;
      }
      const job = s.jobs[p.job_id];
      if (job) job.status = status;
      // Approvals still open when a run ends can no longer be acted on.
      for (const a of Object.values(s.pending_approvals)) if (a.run_id === p.run_id) delete s.pending_approvals[a.id];
      const day = dayKey(event.ts);
      s.cost_by_day[day] = (s.cost_by_day[day] ?? 0) + p.cost_usd;
      if (r) {
        const a = agentView(s, r.agent_id);
        a.tokens_by_day[day] = (a.tokens_by_day[day] ?? 0) + p.tokens_in + p.tokens_out;
        if (a.current_run_id === r.id) {
          a.current_run_id = null;
          a.activity = "idle";
          a.thinking = null;
        }
        if (status === "failed") a.moment = momentOf(event, "failed");
        else if (status === "done") a.moment = momentOf(event, "delivered");
      }
      break;
    }
    case "agent.thinking":
      if (event.agent_id) agentView(s, event.agent_id).thinking = event.payload.summary;
      if (run) run.step = event.payload.summary;
      break;
    case "agent.message": {
      if (run && run.output.length < MAX_OUTPUT_CHARS) {
        run.output = (run.output + event.payload.text).slice(0, MAX_OUTPUT_CHARS);
      }
      if (event.agent_id) {
        const a = agentView(s, event.agent_id);
        a.last_message = run ? run.output.slice(-280) : event.payload.text.slice(-280);
        a.thinking = null;
      }
      break;
    }
    case "agent.tool_call":
      if (run) {
        run.step = `tool:${event.payload.tool}`;
        run.tool_calls = (run.tool_calls ?? 0) + 1;
      }
      if (event.agent_id) {
        const a = agentView(s, event.agent_id);
        a.last_tool_category = event.payload.category;
        a.last_tool = event.payload.tool;
        a.thinking = null;
      }
      break;
    case "agent.needs_approval": {
      const p = event.payload;
      s.pending_approvals[p.approval_id] = {
        id: p.approval_id,
        run_id: event.run_id,
        agent_id: event.agent_id,
        action: p.action,
        risk_level: p.risk_level,
        requested_at: event.ts,
      };
      if (event.agent_id) agentView(s, event.agent_id).activity = "waiting_approval";
      if (run) {
        const job = s.jobs[run.job_id];
        if (job) job.status = "waiting_approval";
      }
      break;
    }
    case "approval.decided": {
      delete s.pending_approvals[event.payload.approval_id];
      const stillWaiting = (pred: (a: PendingApproval) => boolean) => Object.values(s.pending_approvals).some(pred);
      if (event.agent_id && !stillWaiting((a) => a.agent_id === event.agent_id)) {
        const a = agentView(s, event.agent_id);
        if (a.activity === "waiting_approval") a.activity = a.current_run_id ? "working" : "idle";
      }
      if (run && !stillWaiting((a) => a.run_id === run.id)) {
        const job = s.jobs[run.job_id];
        if (job && job.status === "waiting_approval") job.status = "running";
      }
      break;
    }
    case "budget.exceeded":
      agentView(s, event.payload.agent_id).activity = "away";
      break;
    case "agent.idle": {
      const a = agentView(s, event.payload.agent_id);
      a.activity = "idle";
      a.current_run_id = null;
      a.thinking = null;
      break;
    }
    case "agent.handoff":
      if (event.agent_id) agentView(s, event.agent_id).moment = momentOf(event, "handoff", event.payload.to_agent);
      break;
    case "artifact.created":
      if (event.agent_id && event.payload.kind === "pr") agentView(s, event.agent_id).moment = momentOf(event, "pr_opened");
      break;
    case "draft.created": {
      const p = event.payload;
      s.pending_drafts[p.draft_id] = { id: p.draft_id, project_id: p.project_id, agent_id: event.agent_id, platform: p.platform, kind: p.kind, created_at: event.ts };
      if (event.agent_id) agentView(s, event.agent_id).moment = momentOf(event, "draft_pinned");
      break;
    }
    case "draft.decided":
      delete s.pending_drafts[event.payload.draft_id];
      // the owner liked it: the agent cheers in the office
      if (event.agent_id && event.payload.status !== "rejected") agentView(s, event.agent_id).moment = momentOf(event, "praised");
      break;
    case "draft.updated": {
      const d = s.pending_drafts[event.payload.draft_id];
      if (d) d.updated_at = event.ts;
      break;
    }
    case "skill.proposed": {
      const p = event.payload;
      (s.pending_skills ??= {})[p.proposal_id] = { id: p.proposal_id, name: p.name, action: p.action, agent_id: event.agent_id, created_at: event.ts };
      if (event.agent_id) agentView(s, event.agent_id).moment = momentOf(event, "skill_shelved");
      break;
    }
    case "skill.decided":
      if (s.pending_skills) delete s.pending_skills[event.payload.proposal_id];
      break;
    case "feature.released":
      if (event.agent_id) agentView(s, event.agent_id).moment = momentOf(event, "feature_pinned");
      break;
    // No derived state: the next tool call or message shows what happened.
    case "agent.tool_result":
      break;
    default: {
      const _exhaustive: never = event;
      void _exhaustive;
    }
  }
  return true;
}

/** Pure wrapper around `apply`: never touches `prev`. */
export function reduce(prev: OfficeState, event: AgentEvent): OfficeState {
  if (event.id <= prev.last_event_id) return prev;
  const s = structuredClone(prev);
  apply(s, event);
  return s;
}

/** Pure: folds events over a copy of `from`. */
export function reduceAll(events: Iterable<AgentEvent>, from: OfficeState = initialState()): OfficeState {
  const s = structuredClone(from);
  for (const e of events) apply(s, e);
  return s;
}
