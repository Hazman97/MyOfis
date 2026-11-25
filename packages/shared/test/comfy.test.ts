import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  IMAGE_GEN_SIZES,
  evaluateGpuGuard,
  fillWorkflow,
  parseComputeApps,
  parseGpuStats,
  type ComfyWorkflow,
} from "../src/comfy.ts";

const baseWorkflow = JSON.parse(
  readFileSync(join(import.meta.dir, "../../tools/comfy/z-image-turbo.json"), "utf8"),
) as ComfyWorkflow;

describe("Task 041 Step 1: fillWorkflow & VRAM Game Guard", () => {
  test("fillWorkflow preserves node ids, sets prompt/size/seed/steps/prefix, and rejects non-multiple-of-16 sizes", () => {
    const filled = fillWorkflow(baseWorkflow, {
      prompt: "cozy coffee shop\u0000 morning light",
      width: IMAGE_GEN_SIZES.post_4x5.latentW,
      height: IMAGE_GEN_SIZES.post_4x5.latentH,
      seed: 424242,
      steps: 8,
      prefix: "myofis-test!",
    });
    expect(Object.keys(filled)).toEqual(Object.keys(baseWorkflow));
    expect(filled["5"]!.inputs.text).toBe("cozy coffee shop  morning light");
    expect(filled["7"]!.inputs.width).toBe(896);
    expect(filled["7"]!.inputs.height).toBe(1120);
    expect(filled["8"]!.inputs.seed).toBe(424242);
    expect(filled["8"]!.inputs.steps).toBe(8);
    expect(filled["10"]!.inputs.filename_prefix).toBe("myofis-test_");
    // Original object is not mutated
    expect(baseWorkflow["5"]!.inputs.text).toBe("");

    expect(() => fillWorkflow(baseWorkflow, { prompt: "x", width: 1000, height: 1024, seed: 1 })).toThrow(/multiple of 16/);
    expect(() => fillWorkflow(baseWorkflow, { prompt: "x", width: 1024, height: 1001, seed: 1 })).toThrow(/multiple of 16/);
  });

  test("evaluateGpuGuard table: idle runs, game VRAM > 2500MB waits, high util > 60% waits, own ComfyUI VRAM runs", () => {
    // 1) Idle desktop (1100 MB, 5%) -> run
    expect(evaluateGpuGuard({ stats: parseGpuStats("1100, 5"), apps: [] }).action).toBe("run");

    // 2) DirectX/Vulkan game (not in compute-apps) using 5800 MB -> wait
    const dxGame = evaluateGpuGuard({ stats: parseGpuStats("5800, 85"), apps: [] });
    expect(dxGame.action).toBe("wait");
    expect(dxGame.reason).toContain("5800 MB");

    // 3) Low VRAM (1800 MB) but 75% foreign GPU utilization -> wait
    const highUtil = evaluateGpuGuard({ stats: parseGpuStats("1800, 75"), apps: [] });
    expect(highUtil.action).toBe("wait");
    expect(highUtil.reason).toContain("75%");

    // 4) Foreign compute app using 3000 MB -> wait
    const foreignCompute = evaluateGpuGuard({
      stats: parseGpuStats("3200, 10"),
      apps: parseComputeApps("9999, game.exe, 3000"),
      ownPids: new Set([1234]),
    });
    expect(foreignCompute.action).toBe("wait");

    // 5) Own ComfyUI process already holding 9500 MB VRAM (desktop + ComfyUI = 10500 MB -> 1000 MB foreign) -> run!
    const ownComfy = evaluateGpuGuard({
      stats: parseGpuStats("10500, 2"),
      apps: parseComputeApps("1234, python.exe, 9500"),
      ownPids: new Set([1234]),
    });
    expect(ownComfy.action).toBe("run");

    // 6) Windows WDDM: own ComfyUI reports [N/A] (0 MB) per-process while holding 9440 MB total VRAM -> run when idle
    const wddmOwnIdle = evaluateGpuGuard({
      stats: parseGpuStats("9440, 2"),
      apps: parseComputeApps("1234, python.exe, [N/A]"),
      ownPids: new Set([1234]),
    });
    expect(wddmOwnIdle.action).toBe("run");

    // 7) Windows WDDM: if a game starts while ComfyUI is idle, high GPU utilization still waits
    const wddmGameActive = evaluateGpuGuard({
      stats: parseGpuStats("9440, 88"),
      apps: parseComputeApps("1234, python.exe, [N/A]"),
      ownPids: new Set([1234]),
    });
    expect(wddmGameActive.action).toBe("wait");
  });
});
