import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  IMAGE_GEN_SIZES,
  ImageGenSizeId,
  evaluateGpuGuard,
  fillWorkflow,
  freshFetch,
  parseComputeApps,
  parseGpuStats,
  type BrandKit,
  type ComfyWorkflow,
  type GpuComputeApp,
  type GpuStats,
} from "@agent-office/shared";
import { withGpuLock } from "./gpuLock.ts";
import { scrubbedEnv } from "./safety.ts";
import { ffmpegBin } from "./video.ts";
import { ToolDenied, defineTool, type ToolContext } from "./types.ts";

const IS_WIN = process.platform === "win32";
const DEFAULT_COMFY_DIR = "C:\\ComfyUI\\ComfyUI_windows_portable";
const WORKFLOW_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "comfy", "z-image-turbo.json");

export function comfyPaths(dir = process.env.COMFYUI_DIR || DEFAULT_COMFY_DIR): { dir: string; python: string; mainPy: string } {
  return {
    dir,
    python: join(dir, "python_embeded", "python.exe"),
    mainPy: join(dir, "ComfyUI", "main.py"),
  };
}

/** True when ComfyUI portable is installed at COMFYUI_DIR (python_embeded\python.exe + ComfyUI\main.py). */
export function comfyInstalled(dir?: string): boolean {
  const p = comfyPaths(dir);
  return existsSync(p.python) && existsSync(p.mainPy);
}

function killTreeSync(pid: number): void {
  try {
    if (IS_WIN) {
      Bun.spawnSync(["taskkill", "/PID", String(pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" });
    } else {
      process.kill(-pid, "SIGTERM");
    }
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

async function defaultGpuProbe(): Promise<{ stats: GpuStats | null; apps: GpuComputeApp[] }> {
  const smi = Bun.which("nvidia-smi");
  if (!smi) return { stats: null, apps: [] };
  try {
    const run = async (args: string[]) => {
      const p = Bun.spawn([smi, ...args], { stdout: "pipe", stderr: "ignore" });
      const out = await new Response(p.stdout).text();
      await p.exited;
      return out;
    };
    const [statsCsv, appsCsv] = await Promise.all([
      run(["--query-gpu=memory.used,utilization.gpu", "--format=csv,noheader,nounits"]),
      run(["--query-compute-apps=pid,process_name,used_memory", "--format=csv,noheader,nounits"]),
    ]);
    return { stats: parseGpuStats(statsCsv), apps: parseComputeApps(appsCsv) };
  } catch {
    return { stats: null, apps: [] };
  }
}

async function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error("aborted");
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface ComfyProcessHandle {
  pid: number;
  exited: Promise<number>;
}

export interface ComfyManagerOptions {
  baseUrl?: string;
  port?: number;
  comfyDir?: string;
  idleMs?: number;
  startTimeoutMs?: number;
  guardPollMs?: number;
  guardMaxWaitMs?: number;
  maxForeignVramMb?: number;
  spawnProcess?: (opts: { port: number; comfyDir: string }) => ComfyProcessHandle;
  killProcess?: (pid: number) => void;
  probeGpu?: () => Promise<{ stats: GpuStats | null; apps: GpuComputeApp[] }>;
}

/**
 * On-demand ComfyUI process lifecycle manager:
 * - Starts only on the first image request, waits for /system_stats (timeout 120 s).
 * - Checks nvidia-smi game guard before every request (waits if a game uses the GPU).
 * - Calls POST /free and stops the process tree after 5 idle minutes or on runner exit.
 */
export class ComfyManager {
  readonly #port: number;
  readonly #baseUrl: string;
  readonly #comfyDir?: string;
  readonly #idleMs: number;
  readonly #startTimeoutMs: number;
  readonly #guardPollMs: number;
  readonly #guardMaxWaitMs: number;
  readonly #maxForeignVramMb: number;
  readonly #spawnProcess: (opts: { port: number; comfyDir: string }) => ComfyProcessHandle;
  readonly #killProcess: (pid: number) => void;
  readonly #probeGpu: () => Promise<{ stats: GpuStats | null; apps: GpuComputeApp[] }>;

  #proc: ComfyProcessHandle | null = null;
  #idleTimer: ReturnType<typeof setTimeout> | null = null;
  #starting: Promise<void> | null = null;
  #busyCount = 0;

  constructor(opts: ComfyManagerOptions = {}) {
    this.#port = opts.port ?? Number(process.env.COMFYUI_PORT || 8188);
    this.#baseUrl = (opts.baseUrl ?? `http://127.0.0.1:${this.#port}`).replace(/\/+$/, "");
    this.#comfyDir = opts.comfyDir;
    this.#idleMs = opts.idleMs ?? 5 * 60_000;
    this.#startTimeoutMs = opts.startTimeoutMs ?? 120_000;
    this.#guardPollMs = opts.guardPollMs ?? 30_000;
    this.#guardMaxWaitMs = opts.guardMaxWaitMs ?? 30 * 60_000;
    this.#maxForeignVramMb = opts.maxForeignVramMb ?? Number(process.env.COMFY_MAX_FOREIGN_VRAM_MB || 2500);
    this.#killProcess = opts.killProcess ?? killTreeSync;
    this.#probeGpu = opts.probeGpu ?? defaultGpuProbe;
    this.#spawnProcess =
      opts.spawnProcess ??
      (({ port, comfyDir }) => {
        const p = comfyPaths(comfyDir);
        if (!existsSync(p.python) || !existsSync(p.mainPy)) {
          throw new ToolDenied(`ComfyUI tidak dijumpai di ${p.dir}`);
        }
        const child = Bun.spawn(
          [p.python, "-s", p.mainPy, "--listen", "127.0.0.1", "--port", String(port), "--disable-auto-launch"],
          {
            cwd: p.dir,
            env: scrubbedEnv(),
            stdout: "ignore",
            stderr: "ignore",
          },
        );
        return { pid: child.pid, exited: child.exited };
      });
  }

  get isRunning(): boolean {
    return this.#proc !== null;
  }

  get pid(): number | null {
    return this.#proc?.pid ?? null;
  }

  #clearIdleTimer(): void {
    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = null;
    }
  }

  #armIdleTimer(): void {
    this.#clearIdleTimer();
    if (!this.#proc || this.#busyCount > 0) return;
    this.#idleTimer = setTimeout(() => {
      if (this.#busyCount === 0) void this.stop();
    }, this.#idleMs);
    this.#idleTimer.unref?.();
  }

  async #isAlive(): Promise<boolean> {
    try {
      const res = await freshFetch(`${this.#baseUrl}/system_stats`, { timeoutMs: 3000 });
      return res.ok;
    } catch {
      return false;
    }
  }

  async waitForGpu(signal?: AbortSignal, onWaiting?: (msg: string) => void): Promise<void> {
    const deadline = Date.now() + this.#guardMaxWaitMs;
    let notified = false;
    for (;;) {
      const ownPids = this.#proc ? new Set([this.#proc.pid]) : new Set<number>();
      const { stats, apps } = await this.#probeGpu();
      const decision = evaluateGpuGuard({ stats, apps, ownPids, maxForeignVramMb: this.#maxForeignVramMb });
      if (decision.action === "run") return;
      if (Date.now() >= deadline) {
        throw new ToolDenied(`GPU masih digunakan selepas ${Math.round(this.#guardMaxWaitMs / 60_000)} minit (${decision.reason ?? "sibuk"}) — cuba lagi selepas selesai bermain.`);
      }
      if (!notified) {
        notified = true;
        onWaiting?.("GPU sedang digunakan (game?), menunggu…");
      }
      await sleepAbortable(Math.min(this.#guardPollMs, Math.max(10, deadline - Date.now())), signal);
    }
  }

  async ensureRunning(signal?: AbortSignal): Promise<void> {
    this.#clearIdleTimer();
    if (this.#proc && (await this.#isAlive())) return;
    if (this.#starting) return this.#starting;

    this.#starting = (async () => {
      const dir = this.#comfyDir ?? process.env.COMFYUI_DIR ?? DEFAULT_COMFY_DIR;
      const handle = this.#spawnProcess({ port: this.#port, comfyDir: dir });
      this.#proc = handle;
      let dead = false;
      void handle.exited.then(() => {
        dead = true;
        if (this.#proc?.pid === handle.pid) this.#proc = null;
      });
      const deadline = Date.now() + this.#startTimeoutMs;
      while (Date.now() < deadline) {
        if (signal?.aborted) {
          await this.stop();
          throw new Error("aborted while starting ComfyUI");
        }
        if (dead) throw new ToolDenied("ComfyUI terhenti semasa dimulakan");
        if (await this.#isAlive()) return;
        await sleepAbortable(300, signal);
      }
      await this.stop();
      throw new ToolDenied("ComfyUI gagal bertindak balas dalam 120 saat");
    })().finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  async stop(): Promise<void> {
    this.#clearIdleTimer();
    const handle = this.#proc;
    this.#proc = null;
    if (!handle) return;
    try {
      await freshFetch(`${this.#baseUrl}/free`, {
        method: "POST",
        timeoutMs: 5000,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ unload_models: true, free_memory: true }),
      });
    } catch {
      /* ignore if already closed */
    }
    this.#killProcess(handle.pid);
    await Promise.race([handle.exited.catch(() => 0), sleepAbortable(5000).catch(() => {})]);
  }

  /** Run one filled workflow on ComfyUI and return the generated PNG bytes. */
  async generate(
    workflow: ComfyWorkflow,
    opts: { signal?: AbortSignal; onWaiting?: (msg: string) => void } = {},
  ): Promise<Uint8Array> {
    this.#busyCount++;
    this.#clearIdleTimer();
    try {
      await this.waitForGpu(opts.signal, opts.onWaiting);
      await this.ensureRunning(opts.signal);

      const clientId = `myofis_${Date.now().toString(36)}`;
      const postRes = await freshFetch(`${this.#baseUrl}/prompt`, {
        method: "POST",
        timeoutMs: 30_000,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: workflow, client_id: clientId }),
      });
      if (!postRes.ok) throw new Error(`ComfyUI /prompt failed (HTTP ${postRes.status})`);
      const { prompt_id } = (await postRes.json()) as { prompt_id?: string };
      if (!prompt_id) throw new Error("ComfyUI did not return prompt_id");

      // Poll /history/<id> until outputs appear
      const deadline = Date.now() + 10 * 60_000;
      let imgInfo: { filename: string; subfolder?: string; type?: string } | null = null;
      while (Date.now() < deadline) {
        if (opts.signal?.aborted) throw new Error("aborted");
        const hRes = await freshFetch(`${this.#baseUrl}/history/${encodeURIComponent(prompt_id)}`, { timeoutMs: 15_000 });
        if (hRes.ok) {
          const hist = (await hRes.json()) as Record<string, { outputs?: Record<string, { images?: { filename: string; subfolder?: string; type?: string }[] }>; status?: { status_str?: string } }>;
          const entry = hist[prompt_id];
          if (entry?.status?.status_str === "error") throw new Error("ComfyUI generation failed");
          const outputs = entry?.outputs ?? {};
          for (const nodeOut of Object.values(outputs)) {
            if (nodeOut.images?.length) {
              imgInfo = nodeOut.images[0]!;
              break;
            }
          }
          if (imgInfo) break;
        }
        await sleepAbortable(500, opts.signal);
      }
      if (!imgInfo) throw new Error("ComfyUI timed out waiting for image output");

      const qs = new URLSearchParams({
        filename: imgInfo.filename,
        subfolder: imgInfo.subfolder ?? "",
        type: imgInfo.type ?? "output",
      });
      const viewRes = await freshFetch(`${this.#baseUrl}/view?${qs.toString()}`, { timeoutMs: 30_000 });
      if (!viewRes.ok) throw new Error(`ComfyUI /view failed (HTTP ${viewRes.status})`);
      return new Uint8Array(await viewRes.arrayBuffer());
    } finally {
      this.#busyCount = Math.max(0, this.#busyCount - 1);
      this.#armIdleTimer();
    }
  }
}

export const comfyManager = new ComfyManager();

/** Stop the singleton ComfyUI instance (called when the runner exits). */
export async function stopComfy(): Promise<void> {
  await comfyManager.stop();
}

function loadBaseWorkflow(): ComfyWorkflow {
  return JSON.parse(readFileSync(WORKFLOW_PATH, "utf8")) as ComfyWorkflow;
}

async function resizePngExact(inPath: string, outPath: string, width: number, height: number): Promise<string> {
  const bin = ffmpegBin();
  if (!bin) return inPath;
  const proc = Bun.spawn(
    [
      bin,
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inPath,
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}`,
      "-frames:v",
      "1",
      outPath,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const code = await proc.exited;
  return code === 0 && existsSync(outPath) ? outPath : inPath;
}

function enrichPromptWithBrand(prompt: string, brand: BrandKit | undefined, styleHint?: string): string {
  const parts = [prompt.trim()];
  if (styleHint?.trim()) parts.push(styleHint.trim());
  if (brand) {
    parts.push(`${brand.style} aesthetic, cohesive colour palette featuring ${brand.colors.primary} and ${brand.colors.accent}, clean background, no text, no watermark`);
  } else {
    parts.push("no text, no watermark");
  }
  return parts.join(", ");
}

export const imageGenerateTool = defineTool({
  name: "image_generate",
  description:
    "Generate 1–4 AI photos or backgrounds on the owner's local GPU (ComfyUI + Z-Image Turbo, on demand). " +
    "Draws pictures only (no text — put text on top with design_render). Waits automatically if a game is using the GPU.",
  category: "write",
  input: z.object({
    prompt: z.string().trim().min(3).max(1000).describe("English visual description of the photo or background (no text in the image)"),
    size: ImageGenSizeId.default("post_4x5"),
    count: z.number().int().min(1).max(4).default(1),
    seed: z.number().int().min(0).max(2_147_483_647).optional(),
    style_hint: z.string().trim().max(200).optional(),
    project: z.string().max(64).optional(),
  }),
  risk: () => "safe",
  describe: (i) => `generate ${i.count} AI image(s) (${i.size})`,
  async execute(i, ctx) {
    // Check hub pause switch & daily cap
    const gate = (await ctx.videoData("image_gen_check", { count: i.count }).catch((err: Error) => {
      throw new ToolDenied(err.message);
    })) as { ok?: boolean; error?: string } | undefined;
    if (gate && gate.ok === false) {
      throw new ToolDenied(gate.error || "Gambar AI dijeda oleh pemilik");
    }

    const pc = ctx.projectContext;
    const proj = pc?.projects.length
      ? i.project
        ? pc.projects.find((x) => x.slug === i.project || x.id === i.project)
        : pc.projects.find((x) => x.id === ctx.projectId) ?? pc.projects[0]
      : undefined;
    const fullPrompt = enrichPromptWithBrand(i.prompt, proj?.brief?.brand, i.style_hint);
    const spec = IMAGE_GEN_SIZES[i.size];
    const baseSeed = i.seed ?? Math.floor(Math.random() * 1_000_000_000);
    const baseWf = loadBaseWorkflow();

    const outDir = join(ctx.workspace, "ai-images");
    mkdirSync(outDir, { recursive: true });

    const images: { upload_id: string; seed: number }[] = [];
    await withGpuLock("image_generate", async () => {
      for (let idx = 0; idx < i.count; idx++) {
        const seed = baseSeed + idx;
        const wf = fillWorkflow(baseWf, {
          prompt: fullPrompt,
          width: spec.latentW,
          height: spec.latentH,
          seed,
          steps: 8,
          prefix: `myofis_${i.size}_${seed}`,
        });
        const pngBytes = await comfyManager.generate(wf, {
          signal: ctx.signal,
          onWaiting: (summary) => ctx.emit({ type: "agent.thinking", payload: { summary } }),
        });
        const rawPath = join(outDir, `raw-${seed}.png`);
        const exactPath = join(outDir, `img-${i.size}-${seed}.png`);
        writeFileSync(rawPath, pngBytes);
        const finalPath = await resizePngExact(rawPath, exactPath, spec.outW, spec.outH);
        const fileName = `ai-${i.size}-${seed}.png`;
        const up = await ctx.uploadVideo(finalPath, fileName, undefined, "image/png");
        ctx.renders.push({ id: up.id, name: fileName, content_type: "image/png" });
        images.push({ upload_id: up.id, seed });
      }
    });

    return {
      ok: true,
      summary: `generated ${images.length} AI image(s) (${spec.outW}×${spec.outH})`,
      output: { images, width: spec.outW, height: spec.outH },
    };
  },
});
