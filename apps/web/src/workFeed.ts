import type { OfficeState } from "@agent-office/shared";
import { isChatJob } from "./jobs.ts";

/**
 * The work feed beside the 3D office (owner request 2026-10-20, like Taskuary's right-hand list):
 * what needs the owner first, then what is running, queued, and recently finished. Pure, from the
 * reducer state only.
 */
export type FeedKind = "needs_you" | "draft" | "working" | "queued" | "done" | "failed";

export interface FeedItem {
  key: string;
  kind: FeedKind;
  /** Short line, e.g. the job title or the approval's action. */
  title: string;
  agent_id: string | null;
  /** Where a tap goes. */
  to: string;
  /** ISO time used for sorting and "5 min ago". */
  at: string;
}

const ORDER: FeedKind[] = ["needs_you", "draft", "working", "queued", "failed", "done"];
/** Finished jobs older than this drop off the feed. */
const RECENT_MS = 6 * 3600_000;

export function workFeed(state: OfficeState, now = Date.now(), limit = 12): FeedItem[] {
  const items: FeedItem[] = [];
  for (const a of Object.values(state.pending_approvals))
    items.push({ key: `a:${a.id}`, kind: "needs_you", title: a.action, agent_id: a.agent_id, to: "/approvals", at: a.requested_at });
  for (const d of Object.values(state.pending_drafts))
    items.push({ key: `d:${d.id}`, kind: "draft", title: `${d.kind.replace(/_/g, " ")} for ${d.platform}`, agent_id: d.agent_id, to: "/drafts", at: d.updated_at ?? d.created_at });
  for (const j of Object.values(state.jobs)) {
    // chat lives in Chat; consults show through the agent that asked
    if (isChatJob(j) || j.type === "consult") continue;
    const runs = j.run_ids.map((id) => state.runs[id]).filter(Boolean);
    const last = runs.at(-1);
    const at = last?.ended_at ?? last?.started_at ?? j.created_at;
    const to = `/jobs/${j.id}`;
    if (j.status === "running") items.push({ key: `j:${j.id}`, kind: "working", title: j.title, agent_id: j.agent_id, to, at });
    else if (j.status === "queued") items.push({ key: `j:${j.id}`, kind: "queued", title: j.title, agent_id: j.agent_id, to, at: j.created_at });
    else if (now - Date.parse(at) <= RECENT_MS) {
      if (j.status === "done") items.push({ key: `j:${j.id}`, kind: "done", title: j.title, agent_id: j.agent_id, to, at });
      else if (j.status === "failed") items.push({ key: `j:${j.id}`, kind: "failed", title: j.title, agent_id: j.agent_id, to, at });
    }
  }
  return items
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || Date.parse(b.at) - Date.parse(a.at))
    .slice(0, limit);
}

/** Counts for the feed's header chips. */
export function feedCounts(state: OfficeState): { needs_you: number; working: number; queued: number } {
  const jobs = Object.values(state.jobs).filter((j) => !isChatJob(j) && j.type !== "consult");
  return {
    needs_you: Object.keys(state.pending_approvals).length + Object.keys(state.pending_drafts).length,
    working: jobs.filter((j) => j.status === "running").length,
    queued: jobs.filter((j) => j.status === "queued").length,
  };
}
