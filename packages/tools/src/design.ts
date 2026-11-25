import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  BRAND_FONTS,
  BrandKit,
  DEFAULT_BRAND_KIT,
  DesignSizeId,
  DesignTemplateId,
  renderDesignPages,
  type BrandFont,
} from "@agent-office/shared";
import { execArgv } from "./shell.ts";
import { ToolDenied, defineTool, type ToolContext } from "./types.ts";

const DEFAULT_WORKER = join(dirname(fileURLToPath(import.meta.url)), "..", "browser", "worker.mjs");
const DEFAULT_FONTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "assets", "fonts");

const fontCssCache = new Map<string, string>();

/** Build inline @font-face CSS with base64-embedded WOFF2 fonts from assets/fonts/. Pure/offline. */
export function embedBrandFontsCss(brand: BrandKit, fontsDir = process.env.AGENT_OFFICE_FONTS_DIR || DEFAULT_FONTS_DIR): string {
  const families = [...new Set<BrandFont>([brand.fonts.heading, brand.fonts.body])];
  const key = `${fontsDir}|${families.join(",")}`;
  const cached = fontCssCache.get(key);
  if (cached !== undefined) return cached;

  const blocks: string[] = [];
  for (const id of families) {
    const spec = BRAND_FONTS[id];
    if (!spec) continue;
    for (const weight of spec.weights) {
      const file = join(fontsDir, id, `${weight}.woff2`);
      if (!existsSync(file)) continue;
      const b64 = readFileSync(file).toString("base64");
      blocks.push(
        `@font-face { font-family: "${spec.cssFamily}"; font-style: normal; font-weight: ${weight}; font-display: block; src: url(data:font/woff2;base64,${b64}) format("woff2"); }`,
      );
    }
  }
  const css = blocks.join("\n");
  fontCssCache.set(key, css);
  return css;
}

/** Render a local HTML file to a PNG using the Node + Playwright browser worker (deviceScaleFactor 1). */
export async function renderHtmlToPng(opts: {
  htmlPath: string;
  width: number;
  height: number;
  outPath: string;
  cwd: string;
  signal: AbortSignal;
  workerPath?: string;
}): Promise<{ ok: boolean; out: string; width: number; height: number; error?: string }> {
  const worker = opts.workerPath || process.env.AGENT_OFFICE_BROWSER_WORKER || DEFAULT_WORKER;
  const node = process.env.AGENT_OFFICE_NODE || "node";
  const req = { html_path: opts.htmlPath, width: opts.width, height: opts.height, out: opts.outPath };
  const r = await execArgv([node, worker, JSON.stringify(req)], {
    cwd: opts.cwd,
    signal: opts.signal,
    timeoutMs: 60_000,
    env: { ...(process.env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH } : {}) },
  }).catch((err: Error) => {
    throw new ToolDenied(`could not start the design render worker (Node 22+ must be installed on the runner): ${err.message}`);
  });
  let parsed: { ok?: boolean; out?: string; width?: number; height?: number; error?: string };
  try {
    parsed = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "{}");
  } catch {
    throw new Error(`design render worker gave no result (exit ${r.code}): ${r.stderr.slice(-400)}`);
  }
  if (!parsed.ok) throw new Error(`design render failed: ${parsed.error ?? r.stderr.slice(-300)}`);
  return { ok: true, out: parsed.out ?? opts.outPath, width: parsed.width ?? opts.width, height: parsed.height ?? opts.height };
}

function resolveProjectBrand(ctx: ToolContext, projectRef: string | undefined, override?: BrandKit): { brand: BrandKit; projectName: string } {
  const pc = ctx.projectContext;
  const p = pc?.projects.length
    ? projectRef
      ? pc.projects.find((x) => x.slug === projectRef || x.id === projectRef)
      : pc.projects.find((x) => x.id === ctx.projectId) ?? pc.projects[0]
    : undefined;
  return {
    brand: override ?? p?.brief?.brand ?? DEFAULT_BRAND_KIT,
    projectName: p?.name ?? "",
  };
}

const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

async function attachmentToDataUrl(ctx: ToolContext, id: string, contentType: string, dest: string): Promise<string | null> {
  if (!IMAGE_MIME.has(contentType)) return null;
  try {
    await ctx.downloadAttachment(id, dest);
    const b64 = readFileSync(dest).toString("base64");
    return `data:${contentType};base64,${b64}`;
  } catch {
    return null;
  }
}

export const designRenderTool = defineTool({
  name: "design_render",
  description:
    "Render a Brand Kit social graphic (quote, tip_carousel, list_top, before_after, promo, announcement, testimonial, story_frame, highlight_cover) to PNG offline using bundled fonts, and upload the PNG(s) for save_draft. " +
    "Returns upload_id (or upload_ids in order for carousels) and any text overflow warnings.",
  category: "write",
  input: z.object({
    template: DesignTemplateId,
    size: DesignSizeId.default("post_4x5"),
    fields: z.record(z.string(), z.unknown()).default({}),
    photos: z
      .array(z.union([z.number().int().min(1).max(10), z.string().min(1).max(64)]))
      .max(4)
      .optional()
      .describe("1-based attachment numbers or upload ids rendered by this run (e.g. image_generate)"),
    project: z.string().max(64).optional().describe("Project slug to read the Brand Kit from (defaults to the job's project)"),
    brand: BrandKit.optional().describe("Optional Brand Kit override"),
  }),
  risk: () => "safe",
  describe: (i) => `render ${i.template} (${i.size})`,
  async execute(i, ctx) {
    const { brand, projectName } = resolveProjectBrand(ctx, i.project, i.brand);
    const workDir = join(ctx.workspace, "design");
    mkdirSync(workDir, { recursive: true });

    let logoDataUrl: string | null = null;
    if (brand.logo_upload_id) {
      logoDataUrl = await attachmentToDataUrl(ctx, brand.logo_upload_id, "image/png", join(workDir, "logo.img"));
    }

    const photoDataUrls: (string | null)[] = [];
    for (const [idx, ref] of (i.photos ?? []).entries()) {
      if (typeof ref === "number") {
        const a = ctx.attachments[ref - 1];
        if (!a) throw new ToolDenied(`there is no photo attachment ${ref}; only ${ctx.attachments.length} file(s) attached`);
        photoDataUrls.push(await attachmentToDataUrl(ctx, a.id, a.content_type, join(workDir, `photo-${idx}.img`)));
      } else {
        const found = [...ctx.renders, ...ctx.attachments].find((f) => f.id === ref);
        const ct = found?.content_type ?? "image/png";
        photoDataUrls.push(await attachmentToDataUrl(ctx, ref, ct, join(workDir, `photo-${idx}.img`)));
      }
    }

    const fontCss = embedBrandFontsCss(brand);
    const rendered = renderDesignPages(i.template, brand, i.fields, i.size, { fontCss, logoDataUrl, photoDataUrls, projectName });

    const uploadIds: string[] = [];
    const stamp = Date.now().toString(36);
    for (let idx = 0; idx < rendered.pages.length; idx++) {
      const htmlPath = join(workDir, `${i.template}-${stamp}-${idx + 1}.html`);
      const outPath = join(workDir, `${i.template}-${stamp}-${idx + 1}.png`);
      writeFileSync(htmlPath, rendered.pages[idx]!, "utf8");
      await renderHtmlToPng({
        htmlPath,
        width: rendered.width,
        height: rendered.height,
        outPath,
        cwd: ctx.workspace,
        signal: ctx.signal,
      });
      const fileName = rendered.pages.length > 1 ? `${i.template}-${idx + 1}.png` : `${i.template}.png`;
      const up = await ctx.uploadVideo(outPath, fileName, undefined, "image/png");
      ctx.renders.push({ id: up.id, name: fileName, content_type: "image/png" });
      uploadIds.push(up.id);
    }

    return {
      ok: true,
      summary:
        uploadIds.length > 1
          ? `rendered ${i.template} (${uploadIds.length} slides, ${rendered.width}×${rendered.height})`
          : `rendered ${i.template} (${rendered.width}×${rendered.height})`,
      output: {
        upload_id: uploadIds[0]!,
        upload_ids: uploadIds,
        width: rendered.width,
        height: rendered.height,
        warnings: rendered.warnings,
      },
    };
  },
});
