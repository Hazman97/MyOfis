import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshFetch } from "@agent-office/shared";
import { requestBaseUrl } from "../src/installer.ts";
import { createTestEnv, type TestEnv } from "./helpers.ts";

let env: TestEnv;
afterEach(async () => {
  await env?.close();
});

const get = async (path: string) => {
  const res = await freshFetch(`${env.hub.url}${path}`);
  return { status: res.status, text: await res.text() };
};

describe("one-line runner install", () => {
  test("scripts and files need a live pairing code; the bundled runner pairs itself", async () => {
    env = await createTestEnv();
    const { body } = await env.api<{ code: string }>("/api/runners/pairing-code", { method: "POST" });

    const sh = await get(`/install.sh?code=${body.code}`);
    expect(sh.status).toBe(200);
    expect(sh.text).toContain(`HUB='${env.hub.url}'`);
    expect(sh.text).toContain(`CODE='${body.code}'`);
    expect(sh.text).not.toContain("\r\n");
    const ps1 = await get(`/install.ps1?code=${body.code}`);
    expect(ps1.text).toContain(`$Code = '${body.code}'`);
    expect(ps1.text).toContain("\r\n");

    expect((await get("/install.sh?code=NOPE-NOPE")).status).toBe(404);
    expect((await get("/install/runner.js")).status).toBe(404);

    // the bundle runs on its own: pair with --pair-only, like the installer does
    const js = await get(`/install/runner.js?code=${body.code}`);
    expect(js.status).toBe(200);
    expect((await get(`/install/worker.mjs?code=${body.code}`)).text).toContain("playwright");
    const dir = join(env.dir, "remote-pc");
    mkdirSync(join(dir, "app"), { recursive: true });
    writeFileSync(join(dir, "app", "runner.js"), js.text);
    const run = async (extra: Record<string, string>) => {
      const p = Bun.spawn([process.execPath, "app/runner.js", "--pair-only"], {
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
        env: { PATH: process.env.PATH ?? "", HUB_URL: env.hub.url, RUNNER_NAME: "pc-bilik", RUNNER_STATE_PATH: "./data/runner-state.json", ...extra },
      });
      await p.exited;
      return (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
    };
    const first = await run({ PAIRING_CODE: body.code });
    expect(first).toContain("paired as rnr_");
    expect(existsSync(join(dir, "data", "runner-state.json"))).toBe(true);
    // re-running the installer (an update) keeps the pairing instead of needing a new code
    expect(await run({})).toContain("already paired");

    // the code is used now: the installer URLs stop working
    expect((await get(`/install.sh?code=${body.code}`)).status).toBe(404);
    expect((await env.api<{ runners: { name: string }[] }>("/api/runners")).body.runners.map((r) => r.name)).toContain("pc-bilik");
  }, 60_000);

  test("base URL comes from the request and refuses odd hosts", () => {
    expect(requestBaseUrl("http://127.0.0.1:8788/install.sh", { host: "192.168.1.50:8788" })).toBe("http://192.168.1.50:8788");
    expect(requestBaseUrl("http://127.0.0.1:8788/install.sh", { host: "office.example.com", proto: "https" })).toBe("https://office.example.com");
    expect(requestBaseUrl("http://x/install.sh", { host: "evil.com';rm -rf ~;'" })).toBeNull();
  });
});
