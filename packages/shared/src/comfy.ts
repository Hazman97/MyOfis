import { z } from "zod";

export const ImageGenSettingsSchema = z.object({
  paused: z.boolean().default(false),
  max_per_day: z.number().int().min(1).max(500).default(60),
});
export type ImageGenSettings = z.infer<typeof ImageGenSettingsSchema>;
export const ImageGenSettingsInput = ImageGenSettingsSchema.partial();

export const ImageGenSizeId = z.enum(["post_4x5", "square", "story", "wide"]);
export type ImageGenSizeId = z.infer<typeof ImageGenSizeId>;

export interface ImageGenSizeSpec {
  latentW: number;
  latentH: number;
  outW: number;
  outH: number;
  label: string;
}

/** Latents near ~1 MP (multiples of 16) then resized/cropped to exact 040 output sizes. */
export const IMAGE_GEN_SIZES: Record<ImageGenSizeId, ImageGenSizeSpec> = {
  post_4x5: { latentW: 896, latentH: 1120, outW: 1080, outH: 1350, label: "Post 4:5 (1080×1350)" },
  square: { latentW: 1024, latentH: 1024, outW: 1080, outH: 1080, label: "Square (1080×1080)" },
  story: { latentW: 720, latentH: 1280, outW: 1080, outH: 1920, label: "Story (1080×1920)" },
  wide: { latentW: 1280, latentH: 720, outW: 1920, outH: 1080, label: "Wide 16:9 (1920×1080)" },
};

export type ComfyWorkflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

export interface FillWorkflowParams {
  prompt: string;
  width: number;
  height: number;
  seed: number;
  steps?: number;
  prefix?: string;
}

/**
 * Fill the verified Z-Image Turbo ComfyUI API workflow without changing any node ids.
 * Width and height must be positive multiples of 16. Pure.
 */
export function fillWorkflow(base: ComfyWorkflow, params: FillWorkflowParams): ComfyWorkflow {
  if (!Number.isInteger(params.width) || params.width < 64 || params.width % 16 !== 0) {
    throw new Error(`width must be a multiple of 16 (got ${params.width})`);
  }
  if (!Number.isInteger(params.height) || params.height < 64 || params.height % 16 !== 0) {
    throw new Error(`height must be a multiple of 16 (got ${params.height})`);
  }
  const cleanPrompt = params.prompt.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ").trim();
  const seed = Math.max(0, Math.floor(Math.abs(params.seed)));
  const steps = params.steps !== undefined ? Math.max(1, Math.min(50, Math.floor(params.steps))) : 8;
  const prefix = (params.prefix ?? "myofis").replace(/[^\w\-]+/g, "_").slice(0, 60) || "myofis";

  const cloned: ComfyWorkflow = JSON.parse(JSON.stringify(base));
  if (!cloned["5"] || !cloned["7"] || !cloned["8"] || !cloned["10"]) {
    throw new Error("workflow is missing required Z-Image Turbo nodes (5, 7, 8, 10)");
  }
  cloned["5"].inputs.text = cleanPrompt;
  cloned["7"].inputs.width = params.width;
  cloned["7"].inputs.height = params.height;
  cloned["8"].inputs.seed = seed;
  cloned["8"].inputs.steps = steps;
  cloned["10"].inputs.filename_prefix = prefix;
  return cloned;
}

export interface GpuStats {
  memoryUsedMb: number;
  utilizationPct: number;
}

export interface GpuComputeApp {
  pid: number;
  name: string;
  usedMb: number;
}

/** Parse `nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv,noheader,nounits`. Pure. */
export function parseGpuStats(csv: string): GpuStats | null {
  const line = csv.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (!line) return null;
  const parts = line.split(",").map((s) => Number(s.trim()));
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
  return { memoryUsedMb: parts[0]!, utilizationPct: parts[1]! };
}

/** Parse `nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits`. Pure. */
export function parseComputeApps(csv: string): GpuComputeApp[] {
  const out: GpuComputeApp[] = [];
  for (const raw of csv.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(",").map((s) => s.trim());
    if (parts.length < 3) continue;
    const pid = Number(parts[0]);
    const usedMb = Number(parts[parts.length - 1]);
    const name = parts.slice(1, -1).join(", ");
    if (Number.isFinite(pid) && Number.isFinite(usedMb)) {
      out.push({ pid, name, usedMb });
    }
  }
  return out;
}

export interface GpuGuardDecision {
  action: "run" | "wait";
  reason?: string;
}

/**
 * Decide whether ComfyUI may use the GPU right now or must wait for a game / foreign GPU app.
 * Pure.
 */
export function evaluateGpuGuard(input: {
  stats: GpuStats | null;
  apps: GpuComputeApp[];
  ownPids?: ReadonlySet<number>;
  maxForeignVramMb?: number;
  maxForeignUtilPct?: number;
}): GpuGuardDecision {
  const maxVram = input.maxForeignVramMb ?? 2500;
  const maxUtil = input.maxForeignUtilPct ?? 60;
  const own = input.ownPids ?? new Set<number>();

  const foreignApps = input.apps.filter((a) => !own.has(a.pid));
  const ownVram = input.apps.filter((a) => own.has(a.pid)).reduce((s, a) => s + a.usedMb, 0);
  const foreignComputeVram = foreignApps.reduce((s, a) => s + a.usedMb, 0);
  // DirectX/Vulkan games often don't appear in compute-apps; estimate foreign VRAM from total - own.
  // On Windows WDDM, nvidia-smi reports [N/A] (0 MB) per-process memory even while our own ComfyUI
  // holds ~8-10 GB of model weights in VRAM, so only subtract total - own when own is not running
  // or when per-process ownVram is actually reported (> 0).
  const canUseTotalVram = own.size === 0 || ownVram > 0;
  const totalForeignVram =
    input.stats && canUseTotalVram
      ? Math.max(foreignComputeVram, Math.max(0, input.stats.memoryUsedMb - ownVram))
      : foreignComputeVram;

  if (totalForeignVram > maxVram) {
    return { action: "wait", reason: `VRAM asing ${Math.round(totalForeignVram)} MB melebihi had ${maxVram} MB` };
  }
  if (input.stats && input.stats.utilizationPct > maxUtil) {
    return { action: "wait", reason: `Penggunaan GPU ${Math.round(input.stats.utilizationPct)}% melebihi ${maxUtil}%` };
  }
  return { action: "run" };
}
