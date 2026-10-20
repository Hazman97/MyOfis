import { expect, test } from "bun:test";
import { initialState, type OfficeState } from "@agent-office/shared";
import { feedCounts, workFeed } from "../src/workFeed.ts";

const now = Date.parse("2026-10-20T10:00:00Z");
const job = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, agent_id: "agt_a", project_id: null, title: `job ${id}`, type: "task", trigger: "manual", parent_job_id: null, status, created_at: "2026-10-20T09:00:00Z", run_ids: [], ...extra,
});

test("the feed puts what needs the owner first, then running, queued, failed and recent done; chat and old jobs are left out", () => {
  const s = initialState() as OfficeState;
  s.pending_approvals.ap1 = { id: "ap1", run_id: null, agent_id: "agt_a", action: "push to main", risk_level: "review", requested_at: "2026-10-20T09:50:00Z" };
  s.pending_drafts.d1 = { id: "d1", project_id: "p", agent_id: "agt_b", platform: "tiktok", kind: "video", created_at: "2026-10-20T09:40:00Z" };
  Object.assign(s.jobs, {
    j1: job("j1", "running"),
    j2: job("j2", "queued"),
    j3: job("j3", "done", { run_ids: ["r3"] }),
    j4: job("j4", "failed", { run_ids: ["r4"] }),
    j5: job("j5", "done", { run_ids: ["r5"] }),
    c1: job("c1", "running", { type: "chat" }),
  });
  Object.assign(s.runs, {
    r3: { id: "r3", job_id: "j3", status: "done", started_at: "2026-10-20T09:10:00Z", ended_at: "2026-10-20T09:30:00Z" },
    r4: { id: "r4", job_id: "j4", status: "failed", started_at: "2026-10-20T09:10:00Z", ended_at: "2026-10-20T09:20:00Z" },
    r5: { id: "r5", job_id: "j5", status: "done", started_at: "2026-10-19T01:00:00Z", ended_at: "2026-10-19T01:10:00Z" },
  });
  const feed = workFeed(s, now);
  expect(feed.map((i) => i.key)).toEqual(["a:ap1", "d:d1", "j:j1", "j:j2", "j:j4", "j:j3"]);
  expect(feed[0]).toMatchObject({ kind: "needs_you", title: "push to main", to: "/approvals" });
  expect(feed[1]).toMatchObject({ kind: "draft", title: "video for tiktok", to: "/drafts" });
  expect(feed[2]).toMatchObject({ kind: "working", to: "/jobs/j1" });
  expect(feedCounts(s)).toEqual({ needs_you: 2, working: 1, queued: 1 });
  expect(workFeed(s, now, 2)).toHaveLength(2);
});

test("fmtAgo", async () => {
  const { fmtAgo } = await import("../src/format.ts");
  expect(fmtAgo("2026-10-20T09:59:40Z", now)).toBe("just now");
  expect(fmtAgo("2026-10-20T09:55:00Z", now)).toBe("5 min ago");
  expect(fmtAgo("2026-10-20T07:00:00Z", now)).toBe("3 h ago");
  expect(fmtAgo("2026-10-18T10:00:00Z", now)).toBe("2 d ago");
});
