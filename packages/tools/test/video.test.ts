import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VIDEO_PRESETS } from "@agent-office/shared";
import { EditPlan, TOOL_REGISTRY, buildEditArgs, captionsAss, parseProbe, runTool } from "../src/index.ts";
import { makeCtx } from "./helpers.ts";

const probe = { duration: 10, width: 1920, height: 1080, fps: 30, has_audio: true, video_codec: "h264", size_bytes: 1 };

describe("video plan → ffmpeg", () => {
  test("parseProbe applies rotation and finds audio", () => {
    const p = parseProbe({
      format: { duration: "12.345", size: "1000" },
      streams: [
        { codec_type: "video", codec_name: "hevc", width: 1920, height: 1080, avg_frame_rate: "60000/1001", side_data_list: [{ rotation: -90 }] },
        { codec_type: "audio" },
      ],
    });
    expect(p).toMatchObject({ duration: 12.35, width: 1080, height: 1920, fps: 59.94, has_audio: true, video_codec: "hevc" });
  });

  test("args: trims each clip, reframes to the preset, joins, GPU or CPU encoder", () => {
    const plan = EditPlan.parse({ clips: [{ video: 1, start: 2, end: 6 }, { video: 2, speed: 0.5 }], fit: "blur", captions: [{ text: "Smash!", start: 1, end: 3 }] });
    const noAudio = { ...probe, has_audio: false, duration: 3 };
    const args = buildEditArgs(plan, [{ file: "in-1.mp4", probe }, { file: "in-2.mp4", probe: noAudio }], "nvenc", "out.mp4", "edit.ass");
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(args.slice(3, 9)).toEqual(["-ss", "2", "-t", "4", "-i", "in-1.mp4"]);
    expect(graph).toContain("scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur");
    expect(graph).toContain("anullsrc=r=48000:cl=stereo,atrim=duration=6[a1]"); // 3 s at half speed, no sound
    expect(graph).toContain("concat=n=2:v=1:a=1");
    expect(graph).toContain("[vc]ass=edit.ass[vo]");
    expect(graph).toContain("loudnorm=I=-14");
    expect(args).toContain("h264_nvenc");
    expect(buildEditArgs(plan, [{ file: "a", probe }, { file: "b", probe: noAudio }], "x264", "o.mp4", null)).toContain("libx264");
    expect(() => buildEditArgs(EditPlan.parse({ clips: [{ video: 1, start: 20 }] }), [{ file: "a", probe }], "x264", "o", null)).toThrow(/not before its end/);
  });

  test("captions: ASS with the preset's size, no override injection", () => {
    const ass = captionsAss([{ text: "Hi {\\b0}there\nline 2", start: 0, end: 61.5, position: "top" }], VIDEO_PRESETS.tiktok_fhd);
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:01:01.50,Default,,0,0,0,,{\\an8}Hi /b0there\\Nline 2");
  });
});

const ffmpeg = Bun.which("ffmpeg");
const ffprobe = Bun.which("ffprobe");

describe.skipIf(!ffmpeg || !ffprobe)("video tools with real ffmpeg", () => {
  let dir: string;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "ao-video-"));
    // a 3 s wide clip with sound, and a 2 s portrait clip without
    const run = (args: string[]) => Bun.spawn([ffmpeg!, "-hide_banner", "-loglevel", "error", "-y", ...args], { cwd: dir }).exited;
    expect(await run(["-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-c:a", "aac", "-shortest", "wide.mp4"])).toBe(0);
    expect(await run(["-f", "lavfi", "-i", "testsrc2=size=360x640:rate=25:duration=2", "-c:v", "libx264", "tall.mp4"])).toBe(0);
  }, 60_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("probe, then render a TikTok FHD edit and hand it to the hub", async () => {
    const ws = join(dir, "ws");
    const { ctx, events } = makeCtx(ws);
    ctx.attachments = [
      { id: "upl_wide", name: "wide.mp4", content_type: "video/mp4" },
      { id: "upl_photo", name: "p.jpg", content_type: "image/jpeg" },
      { id: "upl_tall", name: "tall.mp4", content_type: "video/mp4" },
    ];
    ctx.downloadAttachment = async (id, dest) => copyFileSync(join(dir, id === "upl_wide" ? "wide.mp4" : "tall.mp4"), dest);
    let sent = "";
    ctx.uploadVideo = async (path) => {
      sent = path;
      return { id: "upl_render", size: readFileSync(path).length };
    };

    const p = await runTool(TOOL_REGISTRY.video_probe!, { video: 1 }, ctx);
    expect(p.output).toMatchObject({ duration: 3, width: 640, height: 360, has_audio: true });
    const photo = await runTool(TOOL_REGISTRY.video_probe!, { video: 2 }, ctx);
    expect(photo.ok).toBe(false);

    const r = await runTool(TOOL_REGISTRY.video_edit!, { clips: [{ video: 1, start: 1 }, { video: 3 }], fit: "blur", captions: [{ text: "SmashPoint", start: 0, end: 2 }], name: "test" }, ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toMatchObject({ video_id: "upl_render", seconds: 4 });
    expect(ctx.renders).toEqual([{ id: "upl_render", name: "test-tiktok_fhd.mp4", content_type: "video/mp4" }]);

    const out = Bun.spawnSync([ffprobe!, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", sent]);
    const info = parseProbe(JSON.parse(out.stdout.toString()));
    expect(info).toMatchObject({ width: 1080, height: 1920, fps: 30, has_audio: true, video_codec: "h264" });
    expect(Math.abs(info.duration - 4)).toBeLessThan(0.2);
    expect(events.some((e) => e.type === "agent.tool_call")).toBe(true);
    if (process.env.SHOW_ENCODER) console.log((r.output as { encoder: string }).encoder, sent);
  }, 180_000);
});
