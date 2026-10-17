import { expect, test } from "bun:test";
import { boardJobs, isChatJob } from "../src/jobs.ts";

test("chat jobs stay off the Board; every other job type stays on it", () => {
  const jobs = ["task", "chat", "caption", "feature_note", "chat", "smoke_test"].map((type, i) => ({ id: `j${i}`, type }));
  expect(boardJobs(jobs).map((j) => j.type)).toEqual(["task", "caption", "feature_note", "smoke_test"]);
  expect(isChatJob({ type: "chat" })).toBe(true);
  expect(isChatJob({ type: "task" })).toBe(false);
});
