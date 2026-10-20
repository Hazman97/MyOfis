import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadTo } from "../src/client.ts";

let server: ReturnType<typeof Bun.serve>;
let dir: string;
const BIG = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ao-dl-"));
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/ok") return new Response(BIG, { headers: { "content-type": "video/mp4" } });
      // sends a little, then goes silent forever (a dead connection)
      if (path === "/stall")
        return new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(1024));
            },
          }),
          { headers: { "content-type": "video/mp4" } },
        );
      return new Response("no", { status: 404 });
    },
  });
});
afterAll(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

test("a download streams to the file in full", async () => {
  const dest = join(dir, "ok.mp4");
  expect(await downloadTo(`http://127.0.0.1:${server.port}/ok`, dest, {})).toBe(BIG.length);
  expect(new Uint8Array(readFileSync(dest))).toEqual(BIG);
});

test("a download that stops sending data is aborted, and leaves no file behind", async () => {
  const dest = join(dir, "stall.mp4");
  const t0 = Date.now();
  await expect(downloadTo(`http://127.0.0.1:${server.port}/stall`, dest, {}, 300)).rejects.toThrow("no data for");
  expect(Date.now() - t0).toBeLessThan(5000);
  expect(existsSync(dest) || existsSync(`${dest}.part`)).toBe(false);
  await expect(downloadTo(`http://127.0.0.1:${server.port}/missing`, join(dir, "x.mp4"), {}, 300)).rejects.toThrow("HTTP 404");
});
