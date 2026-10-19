import type { EventType } from "@agent-office/shared";

/**
 * What the office view shows for each event type (spec §10.3). `null` means
 * "nothing visible on purpose", with the reason. Tests check this table
 * covers every event type and that each listed reaction really happens.
 */
export const REACTIONS: Record<EventType, string | null> = {
  "runner.online": "server rack lights up, lamp turns green, desk screens come on",
  "runner.offline": "its rack shows red, the server-room lamp turns red, the agents' desk screens go dark",
  "system.paused": "idle agents doze in the pantry (zzz)",
  "job.created": "the agent goes to its desk to wait for the job to start",
  "job.queued": "the agent goes to its desk to wait for the job to start",
  "job.cancelled": "the agent leaves its desk for the pantry",
  "run.started": "the agent walks to its desk and sits down",
  "run.finished": "the agent carries the file to the owner's desk, drops it in the tray, then goes to the pantry",
  "run.failed": "the agent looks dizzy, then goes to the pantry; the monitor shows a red cross",
  "agent.thinking": "a … thinking bubble",
  "agent.message": "the thinking bubble clears and the agent keeps working",
  "agent.tool_call":
    "typing for code/shell/git/write, a browser bubble, the library for search/read_docs, the file cabinets for briefs, the meeting room for meeting",
  "agent.tool_result": null, // the next tool call or message shows what happened next
  "agent.needs_approval": "hand up with a pulsing, clickable !",
  "approval.decided": "hand down, back to work",
  "agent.handoff": "the agent walks a document over to the other agent's desk",
  "artifact.created": "a new PR is pinned on the notice board (other artifacts: nothing)",
  "feature.released": "the agent who wrote the release note pins it on the notice board",
  "draft.created": "Marketing carries the draft to the whiteboard and pins it there",
  "draft.decided": "approved or edited: the agent hops with a heart where it stands (rejected: nothing)",
  "draft.updated": null, // e.g. a video rendered again from the studio; the inbox reloads, nobody walks
  "skill.proposed": "the agent walks to the library and shelves the new skill",
  "skill.decided": null, // the owner decides in the Skills inbox; nothing moves in the office
  "budget.exceeded": "the agent walks out through the entrance",
  "agent.idle": "the agent goes back to the pantry",
};
