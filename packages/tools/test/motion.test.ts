import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TOOL_REGISTRY,
  buildHyperframesArgs,
  hyperframesBinary,
  motionEnv,
  parseProbe,
  runTool,
} from "../src/index.ts";
import { makeCtx } from "./helpers.ts";

describe("motion_render tool (Task 024)", () => {
  test("buildHyperframesArgs builds direct argv array without shell interpolation", () => {
    const argv = buildHyperframesArgs("/usr/local/bin/hyperframes", "/tmp/ws/media/motion-1/index.html", "/tmp/ws/media/motion-1/out.mp4", {
      fps: 30,
      width: 1080,
      height: 1920,
      quality: "standard",
    });
    expect(argv).toEqual([
      "/usr/local/bin/hyperframes",
      "render",
      "--composition",
      "/tmp/ws/media/motion-1/index.html",
      "--output",
      "/tmp/ws/media/motion-1/out.mp4",
      "--fps",
      "30",
      "--width",
      "1080",
      "--height",
      "1920",
      "--quality",
      "standard",
    ]);
  });

  test("motionEnv scrubs secrets and blocks headless Chrome network access", () => {
    process.env.SECRET_TEST_KEY = "should-not-leak";
    const env = motionEnv();
    expect(env.SECRET_TEST_KEY).toBeUndefined();
    expect(env.CHROME_EXTRA_ARGS).toContain("--host-resolver-rules=MAP * ~NOTFOUND");
    expect(env.CHROME_EXTRA_ARGS).toContain("--disable-background-networking");
    expect(env.HTTP_PROXY).toBe("http://127.0.0.1:1");
    expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:1");
    delete process.env.SECRET_TEST_KEY;
  });

  test("writes index.html into <workspace>/media/motion-1/ before invoking hyperframes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ao-motion-unit-"));
    try {
      const { ctx } = makeCtx(dir);
      const prev = process.env.HYPERFRAMES_CLI;
      process.env.HYPERFRAMES_CLI = "";
      try {
        const res = await runTool(
          TOOL_REGISTRY.motion_render!,
          {
            template: "hook",
            params: { lines: ["3 Rahsia Bisnes 🚀", "Nombor 2 Paling Penting!"], duration: 2 },
            name: "intro_hook",
          },
          ctx,
        );
        // If hyperframes is not installed on PATH, it writes index.html then fails cleanly with ToolDenied
        const htmlPath = join(dir, "media", "motion-1", "index.html");
        expect(existsSync(htmlPath)).toBe(true);
        const html = readFileSync(htmlPath, "utf8");
        expect(html).toContain("3 Rahsia Bisnes 🚀");
        expect(html).toContain(`data-composition-id="main"`);
        if (!hyperframesBinary()) {
          expect(res.ok).toBe(false);
        }
      } finally {
        if (prev !== undefined) process.env.HYPERFRAMES_CLI = prev;
        else delete process.env.HYPERFRAMES_CLI;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const hfBin = hyperframesBinary();
const ffprobe = Bun.which("ffprobe");

describe.skipIf(!hfBin || !ffprobe)("motion_render with real hyperframes CLI", () => {
  test("renders hook template to MP4 and uploads it as a video attachment", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ao-motion-real-"));
    try {
      const { ctx } = makeCtx(dir);
      let uploadedPath = "";
      ctx.uploadVideo = async (path) => {
        uploadedPath = path;
        return { id: "upl_motion_1", size: readFileSync(path).length };
      };
      const res = await runTool(
        TOOL_REGISTRY.motion_render!,
        {
          template: "hook",
          params: { lines: ["Jom Cuba!", "Motion Text 🔥"], duration: 1.5 },
          name: "hook_real",
        },
        ctx,
      );
      expect(res.ok).toBe(true);
      expect(uploadedPath).toBeTruthy();
      const out = Bun.spawnSync([ffprobe!, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", uploadedPath]);
      const info = parseProbe(JSON.parse(out.stdout.toString()));
      expect(info.width).toBe(1080);
      expect(info.height).toBe(1920);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

