import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { RunnerClient } from "../../runner/src/client.ts";
import { createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

let env: TestEnv;
const clients: RunnerClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.stop();
  await env?.close();
});

test("two runner processes with one token: the older one steps aside instead of fighting", async () => {
  env = await createTestEnv();
  const { body: code } = await env.api<{ code: string }>("/api/runners/pairing-code", { method: "POST" });
  const { body } = await env.api<{ token: string }>("/api/runners/pair", { body: { code: code.code, name: "pc" }, auth: null });
  const logs: string[][] = [[], []];
  const make = (i: number) => {
    const c = new RunnerClient({ hubUrl: env.hub.url, token: body.token, name: "pc", workspacesDir: join(env.dir, `ws${i}`), log: (m) => logs[i]!.push(m) });
    clients.push(c);
    return c;
  };
  await make(0).start();
  await waitFor(() => Object.values(env.hub.hub.store.state.runners).some((r) => r.online), 5000, "first online");
  await make(1).start();
  await waitFor(() => logs[0]!.some((l) => l.includes("this one stops")), 5000, "older runner steps aside");
  // no ping-pong: after a while the newer one is still the connected one, and nobody keeps retrying
  await Bun.sleep(1500);
  expect(logs[0]!.filter((l) => l.includes("retrying")).length).toBe(0);
  expect(logs[1]!.filter((l) => l.includes("disconnected")).length).toBe(0);
  expect(Object.values(env.hub.hub.store.state.runners).filter((r) => r.online)).toHaveLength(1);
});
