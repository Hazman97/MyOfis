import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { folderSize } from "../src/diskUsage.ts";
import { createTestEnv, type TestEnv } from "./helpers.ts";

let env: TestEnv | null = null;
afterEach(async () => {
  await env?.close();
  env = null;
});

test("folderSize adds every file below a folder and stops at the limit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ao-du-"));
  try {
    mkdirSync(join(dir, "a", "b"), { recursive: true });
    writeFileSync(join(dir, "x.bin"), new Uint8Array(1000));
    writeFileSync(join(dir, "a", "b", "y.bin"), new Uint8Array(24));
    expect(await folderSize(dir)).toEqual({ bytes: 1024, files: 2, partial: false });
    expect((await folderSize(dir, 1)).partial).toBe(true);
    expect(await folderSize(join(dir, "nope"))).toEqual({ bytes: 0, files: 0, partial: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Settings → Storage lists the office's places with sizes; only listed places can be opened", async () => {
  env = await createTestEnv();
  mkdirSync(join(env.dir, "files"), { recursive: true });
  writeFileSync(join(env.dir, "files", "a.bin"), new Uint8Array(2048));
  const r = (await env.api("/api/storage?wait=1")).body as { items: { key: string; path: string; exists: boolean; bytes: number | null }[]; measured_at: string };
  expect(r.measured_at).toBeTruthy();
  const keys = r.items.map((i) => i.key);
  expect(keys).toEqual(expect.arrayContaining(["database", "files", "backups", "projects", "skills", "workspaces", "openchatcut-media"]));
  const files = r.items.find((i) => i.key === "files")!;
  expect(files.exists).toBe(true);
  expect(files.bytes).toBeGreaterThanOrEqual(2048);
  // a path in the request is never opened: only keys, and unknown ones are 404
  expect((await env.api("/api/storage/open", { body: { key: "C:\Windows" } })).status).toBe(404);
});
