import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VIDEO_PRESETS } from "@agent-office/shared";
import { EditPlan, TOOL_REGISTRY, chooseClips, type ClipEntry, buildEditArgs, captionsAss, parseProbe, parseSilences, parseWhisperJson, runTool } from "../src/index.ts";
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

describe("speech (whisper.cpp)", () => {
  test("whisper -ojf -ml 1 -sow output becomes words with times", () => {
    const json = {
      result: { language: "ms" },
      transcription: [
        { offsets: { from: 0, to: 230 }, text: "" },
        { offsets: { from: 230, to: 760 }, text: " Selamat" },
        { offsets: { from: 760, to: 900 }, text: " datang" },
        { offsets: { from: 900, to: 950 }, text: "," },
        { offsets: { from: 1000, to: 1300 }, text: " ke" },
        { offsets: { from: 1300, to: 1500 }, text: " Smash" },
        { offsets: { from: 1500, to: 1800 }, text: "Point" },
        { offsets: { from: 2000, to: 3000 }, text: " [BLANK_AUDIO]" },
      ],
    };
    expect(parseWhisperJson(json, 3.2, "ggml-test.bin")).toEqual({
      language: "ms",
      duration: 3.2,
      model: "ggml-test.bin",
      words: [
        { w: "Selamat", s: 0.23, e: 0.76 },
        { w: "datang,", s: 0.76, e: 0.9 },
        { w: "ke", s: 1, e: 1.3 },
        { w: "SmashPoint", s: 1.3, e: 1.8 },
      ],
    });
  });

  test("pop subtitles get their own bigger style; captions keep the default", () => {
    const ass = captionsAss(
      [
        { text: "Sabtu ni", start: 0, end: 1, position: "top" },
        { text: "HELLO EVERYONE", start: 0.2, end: 1.5, position: "bottom" },
      ],
      VIDEO_PRESETS.tiktok_fhd,
      1,
    );
    expect(ass).toContain("Style: Pop,Arial,101,");
    expect(ass).toContain("Default,,0,0,0,,{\\an8}Sabtu ni");
    expect(ass).toContain("Pop,,0,0,0,,{\\an2}HELLO EVERYONE");
  });
});

test("silencedetect log becomes quiet stretches; an open one runs to the end", () => {
  const log = [
    "[silencedetect @ 0x1] silence_start: 1.156125",
    "[silencedetect @ 0x1] silence_end: 2.095938 | silence_duration: 0.939813",
    "[silencedetect @ 0x1] silence_start: -0.01",
    "[silencedetect @ 0x1] silence_end: 0.4 | silence_duration: 0.41",
    "[silencedetect @ 0x1] silence_start: 10.79",
  ].join("\n");
  expect(parseSilences(log, 11.5)).toEqual([
    { s: 1.16, e: 2.1 },
    { s: 0, e: 0.4 },
    { s: 10.79, e: 11.5 },
  ]);
});

describe("clip library and music", () => {
  const clip = (file: string, extra: Partial<ClipEntry> = {}): ClipEntry => ({ file, size: 1, mtime: 1, seconds: 5, width: 1080, height: 1920, has_audio: false, description: "", upload_id: null, uses: 0, last_used: null, ...extra });
  test("pick: fresh first, then theme words, then least used", () => {
    const now = Date.parse("2026-10-19T12:00:00Z");
    const list = [
      clip("a.mp4", { description: "pantai waktu senja", uses: 3, last_used: "2026-10-18T10:00:00Z" }), // used yesterday
      clip("b.mp4", { description: "jalan kampung pagi", uses: 2 }),
      clip("c.mp4", { description: "pantai berombak", uses: 5 }),
      clip("d.mp4", { description: "kota malam", uses: 0 }),
    ];
    const pick = (count: number, theme = "") => chooseClips(list, count, { theme, now, random: () => 0.5 }).map((c) => c.file);
    expect(pick(1, "pantai tenang")).toEqual(["c.mp4"]); // a.mp4 matches too but was used yesterday
    expect(pick(2)).toEqual(["d.mp4", "b.mp4"]);
    expect(pick(4, "pantai")).toEqual(["c.mp4", "d.mp4", "b.mp4", "a.mp4"]);
  });

  test("music is looped, trimmed to the video, faded and mixed under the clip sound", () => {
    const plan = EditPlan.parse({ clips: [{ video: 1, end: 4 }], music: { track: "calm.m4a", volume_db: -10 } });
    const args = buildEditArgs(plan, [{ file: "in-1.mp4", probe }], "x264", "out.mp4", null, "C:/clips/music/calm.m4a");
    expect(args.join(" ")).toContain("-stream_loop -1 -i C:/clips/music/calm.m4a");
    const fc = args[args.indexOf("-filter_complex") + 1]!;
    expect(fc).toContain("[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=4,volume=-10dB,afade=t=out:st=2.5:d=1.5[mus]");
    expect(fc).toContain("[ac][mus]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[am];[am]loudnorm");
    // muted clip + music: the music is the sound, still evened
    const muted = buildEditArgs(EditPlan.parse({ ...plan, mute: true }), [{ file: "in-1.mp4", probe }], "x264", "out.mp4", null, "m.m4a");
    expect(muted[muted.indexOf("-filter_complex") + 1]).toContain("[am]loudnorm");
    // a track name cannot leave the music folder
    const backslash = String.fromCharCode(92);
    expect(EditPlan.safeParse({ clips: [{ video: 1 }], music: { track: `..${backslash}secret.txt` } }).success).toBe(false);
    expect(EditPlan.safeParse({ clips: [{ video: 1 }], music: { track: "../secret.txt" } }).success).toBe(false);
  });
});
