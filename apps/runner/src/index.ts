import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { RunnerClient } from "./client.ts";
import { loadState, pair } from "./pairing.ts";

const Env = z.object({
  HUB_URL: z.string().url().default("http://127.0.0.1:8787"),
  RUNNER_NAME: z.string().min(1).default(hostname()),
  RUNNER_TOKEN: z.string().default(""),
  PAIRING_CODE: z.string().default(""),
  RUNNER_STATE_PATH: z.string().default("./data/runner-state.json"),
  WORKSPACES_DIR: z.string().default("./workspaces"),
  RUNNER_MAX_CONCURRENT: z.coerce.number().int().positive().default(1),
});

async function main() {
  const env = Env.parse(process.env);
  const statePath = resolve(env.RUNNER_STATE_PATH);

  let token = env.RUNNER_TOKEN;
  if (!token) {
    const saved = await loadState(statePath);
    if (saved && saved.hub_url === env.HUB_URL) token = saved.token;
  }
  if (!token) {
    if (!env.PAIRING_CODE) {
      console.error(
        "[runner] not paired yet. Open the web UI -> Runners -> 'New pairing code', then start with PAIRING_CODE=XXXX-XXXX.",
      );
      process.exit(1);
    }
    const state = await pair({ hubUrl: env.HUB_URL, code: env.PAIRING_CODE, name: env.RUNNER_NAME, statePath });
    console.log(`[runner] paired as ${state.runner_id}; token saved to ${statePath}`);
    token = state.token;
  }

  const client = new RunnerClient({
    hubUrl: env.HUB_URL,
    token,
    name: env.RUNNER_NAME,
    workspacesDir: resolve(env.WORKSPACES_DIR),
    dataDir: resolve(dirname(statePath)),
    maxConcurrentRuns: env.RUNNER_MAX_CONCURRENT,
  });
  console.log(`[runner] "${env.RUNNER_NAME}" connecting to ${env.HUB_URL}`);
  void client.start();

  const shutdown = () => {
    client.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(`[runner] ${(err as Error).message}`);
  process.exit(1);
});
