import { describe, expect, test } from "bun:test";
import { ComfyManager, withGpuLock } from "../src/index.ts";
import { fillWorkflow, type ComfyWorkflow } from "@agent-office/shared";

const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
const BASE_WF: ComfyWorkflow = {
  "5": { class_type: "CLIPTextEncode", inputs: { text: "" } },
  "7": { class_type: "EmptySD3LatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
  "8": { class_type: "KSampler", inputs: { seed: 0, steps: 8 } },
  "10": { class_type: "SaveImage", inputs: { filename_prefix: "myofis" } },
};

describe("Task 041 Step 2: ComfyManager lifecycle, game guard & GPU lock", () => {
  test("on-demand start -> generate -> idle stop calls /free and kills process (nothing left running)", async () => {
    let freed = false;
    let prompts = 0;
    const srv = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url);
        if (u.pathname === "/system_stats") return Response.json({ devices: [{ name: "RTX 3060" }] });
        if (u.pathname === "/prompt" && req.method === "POST") {
          prompts++;
          return Response.json({ prompt_id: `p_${prompts}` });
        }
        if (u.pathname.startsWith("/history/")) {
          const id = u.pathname.slice("/history/".length);
          return Response.json({ [id]: { outputs: { "10": { images: [{ filename: "out.png", subfolder: "", type: "output" }] } } } });
        }
        if (u.pathname === "/view") {
          return new Response(TINY_PNG, { headers: { "content-type": "image/png" } });
        }
        if (u.pathname === "/free" && req.method === "POST") {
          freed = true;
          return Response.json({ ok: true });
        }
        return new Response("not found", { status: 404 });
      },
    });

    try {
      let spawnCount = 0;
      const killedPids: number[] = [];
      let resolveExit!: (code: number) => void;
      const mgr = new ComfyManager({
        baseUrl: `http://127.0.0.1:${srv.port}`,
        port: srv.port,
        idleMs: 120,
        probeGpu: async () => ({ stats: { memoryUsedMb: 900, utilizationPct: 4 }, apps: [] }),
        spawnProcess: () => {
          spawnCount++;
          const exited = new Promise<number>((r) => {
            resolveExit = r;
          });
          return { pid: 42424, exited };
        },
        killProcess: (pid) => {
          killedPids.push(pid);
          resolveExit(0);
        },
      });

      // Not running before first request
      expect(mgr.isRunning).toBe(false);
      expect(spawnCount).toBe(0);

      const wf = fillWorkflow(BASE_WF, { prompt: "test photo", width: 896, height: 1120, seed: 123 });
      const png = await mgr.generate(wf);
      expect(png.byteLength).toBe(TINY_PNG.byteLength);
      expect(spawnCount).toBe(1);
      expect(mgr.isRunning).toBe(true);

      // Second request reuses running ComfyUI (no second spawn)
      await mgr.generate(wf);
      expect(spawnCount).toBe(1);
      expect(prompts).toBe(2);

      // After idle timeout, /free is called and process is killed
      await Bun.sleep(260);
      expect(freed).toBe(true);
      expect(killedPids).toEqual([42424]);
      expect(mgr.isRunning).toBe(false);
    } finally {
      srv.stop(true);
    }
  });

  test("busy GPU (game) emits BM waiting message and times out with clear error", async () => {
    const waitingMsgs: string[] = [];
    const mgr = new ComfyManager({
      baseUrl: "http://127.0.0.1:1",
      guardPollMs: 30,
      guardMaxWaitMs: 90,
      probeGpu: async () => ({ stats: { memoryUsedMb: 6200, utilizationPct: 88 }, apps: [] }),
      spawnProcess: () => {
        throw new Error("should not spawn while GPU is busy");
      },
    });

    await expect(
      mgr.generate(fillWorkflow(BASE_WF, { prompt: "x", width: 1024, height: 1024, seed: 1 }), {
        onWaiting: (m) => waitingMsgs.push(m),
      }),
    ).rejects.toThrow(/GPU masih digunakan/);
    expect(waitingMsgs).toContain("GPU sedang digunakan (game?), menunggu…");
    expect(mgr.isRunning).toBe(false);
  });

  test("withGpuLock serialises a whisper job and an image_generate job (no overlap)", async () => {
    const events: string[] = [];
    const p1 = withGpuLock("video_transcribe:whisper", async () => {
      events.push("whisper:start");
      await Bun.sleep(40);
      events.push("whisper:end");
    });
    const p2 = withGpuLock("image_generate", async () => {
      events.push("image:start");
      await Bun.sleep(20);
      events.push("image:end");
    });
    await Promise.all([p1, p2]);
    expect(events).toEqual(["whisper:start", "whisper:end", "image:start", "image:end"]);
  });
});
