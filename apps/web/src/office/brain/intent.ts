import type { AgentMoment, AgentView, OfficeState, ToolCategory } from "@agent-office/shared";

/**
 * What each character should be doing, derived only from the reducer output
 * (OfficeState) and the agents' config. Pure functions, no clocks.
 */
export type Pose = "stand" | "sit" | "type" | "hand";
export type BubbleKind = "think" | "alert" | "browser" | "search" | "book" | "pr" | "chat" | "check" | "fail" | "zzz" | "coffee";
export type ScreenKind = "off" | "idle" | "code" | "browser" | "alert" | "done" | "failed";

/** The bits of an agent's config the office cares about. */
export interface AgentInfo {
  id: string;
  slug: string;
  name: string;
  sprite: string;
  enabled: boolean;
  runner_id: string | null;
  desk_x: number;
  desk_y: number;
}

export type Target = { place: string } | { zone: string } | { visit: string } | { here: true };

/** One thing to do: go to `target`, then show `pose`/`bubble` there for `hold` ms (0 = until told otherwise). */
export interface Step {
  kind: "steady" | "moment" | "leave";
  target: Target;
  pose: Pose;
  bubble: BubbleKind | null;
  carrying: boolean;
  effect: "dizzy" | null;
  hold: number;
  onArrive?: "drop_tray" | "pin_note" | "give_doc";
}

export interface Intent {
  present: boolean;
  target: Target;
  pose: Pose;
  bubble: BubbleKind | null;
  /** What the agent's own desk monitor shows. */
  screen: ScreenKind;
}

const CATEGORY_LOOK: Record<ToolCategory, { zone?: string; pose: Pose; bubble: BubbleKind | null; screen: ScreenKind }> = {
  think: { pose: "sit", bubble: "think", screen: "idle" },
  code: { pose: "type", bubble: null, screen: "code" },
  shell: { pose: "type", bubble: null, screen: "code" },
  write: { pose: "type", bubble: null, screen: "code" },
  git: { pose: "type", bubble: null, screen: "code" },
  browser: { pose: "type", bubble: "browser", screen: "browser" },
  search: { zone: "library", pose: "stand", bubble: "search", screen: "idle" },
  read_docs: { zone: "library", pose: "stand", bubble: "book", screen: "idle" },
  notify: { pose: "sit", bubble: "chat", screen: "idle" },
  meeting: { zone: "meeting_room", pose: "sit", bubble: "chat", screen: "idle" },
};

/** Tools that send the character somewhere specific, overriding their category (spec §8.4: read the brief at the file cabinets). */
const TOOL_LOOK: Record<string, { zone: string; pose: Pose; bubble: BubbleKind; screen: ScreenKind }> = {
  read_brief: { zone: "file_cabinets", pose: "stand", bubble: "book", screen: "idle" },
  read_feature_log: { zone: "file_cabinets", pose: "stand", bubble: "book", screen: "idle" },
  read_past_drafts: { zone: "file_cabinets", pose: "stand", bubble: "book", screen: "idle" },
};

export interface IntentContext {
  /** Desk place id assigned to this agent, or null when there are more agents than desks. */
  desk: string | null;
  /** The agent's runner (or, when unassigned, any runner) is online. */
  runnerOnline: boolean;
  /** Working on the same job family as another busy agent right now. */
  inMeeting: boolean;
  /** Has a queued job waiting for a runner. */
  hasQueuedJob: boolean;
  paused: boolean;
}

/** Where an agent belongs right now and how it looks there. */
export function steadyIntent(agent: AgentInfo, view: AgentView | undefined, ctx: IntentContext): Intent {
  const desk: Target = ctx.desk ? { place: ctx.desk } : { zone: "meeting_room" };
  const offScreen: ScreenKind = ctx.runnerOnline ? "idle" : "off";
  if (!agent.enabled || view?.activity === "away") return { present: false, target: { zone: "entrance" }, pose: "stand", bubble: null, screen: "off" };

  if (view?.activity === "waiting_approval") return { present: true, target: desk, pose: "hand", bubble: "alert", screen: ctx.runnerOnline ? "alert" : "off" };

  if (view?.activity === "working") {
    const look = (view.last_tool && TOOL_LOOK[view.last_tool]) || CATEGORY_LOOK[view.last_tool_category ?? "think"];
    const screen = ctx.runnerOnline ? look.screen : "off";
    // no tool used yet: just sitting with the job, unless it is thinking out loud
    const bubble = view.thinking ? "think" : view.last_tool_category ? look.bubble : null;
    if (ctx.inMeeting) return { present: true, target: { zone: "meeting_room" }, pose: look.pose === "stand" ? "sit" : look.pose, bubble: bubble ?? "chat", screen };
    if (look.zone) return { present: true, target: { zone: look.zone }, pose: look.pose, bubble, screen };
    // no tool yet and not thinking out loud: sitting at the desk, reading the job
    return { present: true, target: desk, pose: view.last_tool_category ? look.pose : "sit", bubble, screen };
  }

  // idle (or not seen in any event yet)
  // a job is waiting for a runner: sit at the desk with a coffee until it starts
  if (ctx.hasQueuedJob && !ctx.paused) return { present: true, target: desk, pose: "sit", bubble: "coffee", screen: offScreen };
  const last = view?.moment?.kind;
  const screen: ScreenKind = !ctx.runnerOnline ? "off" : last === "delivered" ? "done" : last === "failed" ? "failed" : "idle";
  return { present: true, target: { zone: "pantry" }, pose: "stand", bubble: ctx.paused ? "zzz" : null, screen };
}

/** Steps to act out a one-off moment before returning to the steady intent. */
export function momentSteps(m: AgentMoment, targetDesk: (slug: string) => string | null): Step[] {
  const base = { pose: "stand" as Pose, bubble: null, carrying: false, effect: null, kind: "moment" as const };
  switch (m.kind) {
    case "delivered":
      return [{ ...base, target: { zone: "owner_desk" }, carrying: true, bubble: "check", hold: 1200, onArrive: "drop_tray" }];
    case "failed":
      return [{ ...base, target: { here: true }, effect: "dizzy", bubble: "fail", hold: 3500 }];
    case "pr_opened":
      return [{ ...base, target: { zone: "notice_board" }, bubble: "pr", hold: 1500, onArrive: "pin_note" }];
    case "feature_pinned":
      return [{ ...base, target: { zone: "notice_board" }, carrying: true, bubble: "check", hold: 1500, onArrive: "pin_note" }];
    case "skill_shelved":
      return [{ ...base, target: { zone: "library" }, carrying: true, bubble: "book", hold: 1200 }];
    case "draft_pinned":
      return [{ ...base, target: { zone: "whiteboard" }, carrying: true, bubble: "check", hold: 1000 }];
    case "handoff": {
      const desk = m.to_agent ? targetDesk(m.to_agent) : null;
      if (!desk) return [];
      return [{ ...base, target: { visit: desk }, carrying: true, bubble: "chat", hold: 1300, onArrive: "give_doc" }];
    }
  }
}

export const intentStep = (i: Intent): Step => ({
  kind: i.present ? "steady" : "leave",
  target: i.target,
  pose: i.pose,
  bubble: i.bubble,
  carrying: false,
  effect: null,
  hold: 0,
});

/** Identity of "where": a change here makes the character walk; other changes just update its look in place. */
export const whereKey = (i: Intent) => `${i.present ? "in" : "out"}:${JSON.stringify(i.target)}`;

/** Root job id of a job's handoff chain. */
export function jobFamily(state: OfficeState, jobId: string): string {
  let id = jobId;
  for (let i = 0; i < 20; i++) {
    const parent = state.jobs[id]?.parent_job_id;
    if (!parent || !state.jobs[parent]) return id;
    id = parent;
  }
  return id;
}

/**
 * Agents whose running jobs belong to the same family as another busy agent's
 * (a handoff chain with both ends still at work). Returns agent ids per family root.
 */
export function busyFamilies(state: OfficeState): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const a of Object.values(state.agents)) {
    if (a.activity !== "working" || !a.current_run_id) continue;
    const run = state.runs[a.current_run_id];
    if (!run) continue;
    const root = jobFamily(state, run.job_id);
    if (!out.has(root)) out.set(root, new Set());
    out.get(root)!.add(a.id);
  }
  for (const [k, v] of out) if (v.size < 2) out.delete(k);
  return out;
}
