import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { RunAssignment } from "@agent-office/shared";

const SAFE = /^[a-z0-9][a-z0-9_-]*$/i;

/** Creates `workspaces/<agent-slug>/<run_id>/` and writes the job input into it. */
export async function createWorkspace(root: string, a: RunAssignment): Promise<string> {
  if (!SAFE.test(a.agent.slug) || !SAFE.test(a.run_id)) throw new Error("unsafe agent slug or run id");
  const dir = resolve(join(root, a.agent.slug, a.run_id));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "job.json"), JSON.stringify({ job: a.job, agent: a.agent.slug }, null, 2));
  return dir;
}
