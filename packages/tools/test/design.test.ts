import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_BRAND_KIT } from "@agent-office/shared";
import { TOOL_REGISTRY, embedBrandFontsCss, runTool } from "../src/index.ts";
import { makeCtx } from "./helpers.ts";

describe("Task 040 Step 3: design_render tool (fake worker)", () => {
  test("embedBrandFontsCss embeds bundled OFL woff2 fonts as base64 data URLs with zero http URLs", () => {
    const css = embedBrandFontsCss(DEFAULT_BRAND_KIT);
    expect(css).toContain("data:font/woff2;base64,");
    expect(css).toContain('font-family: "Poppins"');
    expect(css).toContain('font-family: "Inter"');
    expect(css).not.toMatch(/https?:\/\//i);
  });

  test("design_render invokes worker with exact viewport, uploads PNGs in carousel order, and returns warnings", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ao-design-fake-"));
    const prevWorker = process.env.AGENT_OFFICE_BROWSER_WORKER;
    try {
      const logPath = join(tmp, "worker-calls.jsonl");
      const fakeWorker = join(tmp, "fake-worker.mjs");
      // Minimal valid 1x1 PNG bytes
      const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
      writeFileSync(
        fakeWorker,
        `import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
const req = JSON.parse(process.argv[2]);
appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(req) + "\\n");
mkdirSync(dirname(req.out), { recursive: true });
writeFileSync(req.out, Buffer.from(${JSON.stringify(pngB64)}, "base64"));
process.stdout.write(JSON.stringify({ ok: true, out: req.out, width: req.width, height: req.height }) + "\\n");
`,
      );
      process.env.AGENT_OFFICE_BROWSER_WORKER = fakeWorker;

      const { ctx } = makeCtx(tmp);
      const uploaded: { name: string; contentType?: string }[] = [];
      let seq = 0;
      ctx.uploadVideo = async (_path, name, _render, contentType) => {
        uploaded.push({ name, contentType });
        return { id: `upl_design_${++seq}`, size: 68 };
      };

      const res = await runTool(
        TOOL_REGISTRY.design_render!,
        {
          template: "tip_carousel",
          size: "post_4x5",
          fields: {
            title: "3 Tip Video",
            slides: [
              { heading: "Satu", body: "Guna cahaya natural." },
              { heading: "Dua", body: "Audio mesti jelas." },
            ],
            cta: "Simpan!",
          },
        },
        ctx,
      );
      expect(res.ok).toBe(true);
      const out = res.output as { upload_id: string; upload_ids: string[]; width: number; height: number; warnings: string[] };
      expect(out.width).toBe(1080);
      expect(out.height).toBe(1350);
      expect(out.upload_ids).toEqual(["upl_design_1", "upl_design_2", "upl_design_3", "upl_design_4"]);
      expect(out.upload_id).toBe("upl_design_1");
      expect(out.warnings).toEqual([]);
      expect(uploaded.map((u) => u.name)).toEqual(["tip_carousel-1.png", "tip_carousel-2.png", "tip_carousel-3.png", "tip_carousel-4.png"]);
      expect(uploaded.every((u) => u.contentType === "image/png")).toBe(true);

      const calls = readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(calls.length).toBe(4);
      expect(calls[0]).toMatchObject({ width: 1080, height: 1350 });
      const html0 = readFileSync(calls[0].html_path, "utf8");
      expect(html0).toContain("data:font/woff2;base64,");
      expect(html0).not.toMatch(/https?:\/\//i);
    } finally {
      if (prevWorker === undefined) delete process.env.AGENT_OFFICE_BROWSER_WORKER;
      else process.env.AGENT_OFFICE_BROWSER_WORKER = prevWorker;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
