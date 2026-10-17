import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pair } from "../src/pairing.ts";
import { RunnerClient } from "../src/client.ts";

const dir = mkdtempSync(join(tmpdir(), "ao-runner-hdr-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("pairing and the hub connection carry the Cloudflare Access service token", async () => {
  const seen: Record<string, string | null>[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req, srv) {
      seen.push({ path: new URL(req.url).pathname, id: req.headers.get("cf-access-client-id"), secret: req.headers.get("cf-access-client-secret") });
      if (new URL(req.url).pathname === "/ws/runner") return srv.upgrade(req) ? undefined : new Response("no", { status: 400 });
      return Response.json({ runner_id: "rnr_1", token: "tok" });
    },
    websocket: { message() {} },
  });
  const headers = { "CF-Access-Client-Id": "id.access", "CF-Access-Client-Secret": "s3cret" };
  await pair({ hubUrl: `http://127.0.0.1:${server.port}`, code: "AAAA-BBBB", name: "laptop", statePath: join(dir, "state.json"), headers });
  const client = new RunnerClient({ hubUrl: `http://127.0.0.1:${server.port}`, token: "tok", name: "laptop", workspacesDir: dir, extraHeaders: headers, log: () => {} });
  void client.start();
  for (let i = 0; i < 100 && seen.length < 2; i++) await Bun.sleep(20);
  client.stop();
  server.stop(true);
  expect(seen.map((s) => s.path)).toEqual(["/api/runners/pair", "/ws/runner"]);
  expect(seen.every((s) => s.id === "id.access" && s.secret === "s3cret")).toBe(true);
});
