import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { freshFetch } from "@agent-office/shared";

const RunnerState = z.object({ hub_url: z.string(), runner_id: z.string(), token: z.string() });
export type RunnerState = z.infer<typeof RunnerState>;

export async function loadState(path: string): Promise<RunnerState | null> {
  try {
    return RunnerState.parse(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return null;
  }
}

/** Exchange a one-time pairing code for a long-lived runner token and save it locally. */
export async function pair(opts: { hubUrl: string; code: string; name: string; statePath: string }): Promise<RunnerState> {
  const res = await freshFetch(new URL("/api/runners/pair", opts.hubUrl), {
    timeoutMs: 30_000,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: opts.code, name: opts.name }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`pairing failed (${res.status}): ${body.error ?? res.statusText}`);
  }
  const { runner_id, token } = z.object({ runner_id: z.string(), token: z.string() }).parse(await res.json());
  const state = { hub_url: opts.hubUrl, runner_id, token };
  await mkdir(dirname(opts.statePath), { recursive: true });
  await writeFile(opts.statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
  await chmod(opts.statePath, 0o600).catch(() => {}); // no-op on Windows
  return state;
}
