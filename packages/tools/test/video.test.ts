import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VIDEO_PRESETS, finishedSeconds, subtitleCues, tiktokHdPlan } from "@agent-office/shared";
import {
  EditPlan,
  TOOL_REGISTRY,
  chooseClipFit,
  chooseClips,
  type ClipEntry,
  buildEditArgs,
  captionsAss,
  evaluateReview,
  isTiktokHdPrepared,
  parseBlackdetect,
  parseCropdetect,
  parseLoudness,
  parseProbe,
  parseSignalstats,
  parseSilences,
  parseVisionShotLine,
  parseWhisperJson,
  remuxArgs,
  runTool,
  shotsFromScenes,
} from "../src/index.ts";
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
    expect(args).toContain("-b:v");
    expect(args).toContain("12M");
    expect(args).toContain("-maxrate");
    expect(args).toContain("16M");
    expect(args).toContain("-bufsize");
    expect(args).toContain("32M");
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

  test("motion: Ken Burns zoom, a crossfade between clips and an animated caption render for real", async () => {
    const ws = join(dir, "ws-motion");
    const { ctx } = makeCtx(ws);
    ctx.attachments = [
      { id: "upl_wide", name: "wide.mp4", content_type: "video/mp4" },
      { id: "upl_tall", name: "tall.mp4", content_type: "video/mp4" },
    ];
    ctx.downloadAttachment = async (id, dest) => copyFileSync(join(dir, id === "upl_wide" ? "wide.mp4" : "tall.mp4"), dest);
    let sent = "";
    ctx.uploadVideo = async (path) => {
      sent = path;
      return { id: "upl_motion", size: readFileSync(path).length };
    };
    const plan = {
      clips: [{ video: 1, zoom: "in" }, { video: 2, zoom: "out" }],
      transition: { type: "slide", seconds: 0.5 },
      captions: [{ text: "Untuk kau yang penat", start: 0, end: 4, position: "middle", animation: "pop" }],
      name: "motion",
    };
    const r = await runTool(TOOL_REGISTRY.video_edit!, plan, ctx);
    expect(r.ok).toBe(true);
    // 3 s + 2 s, overlapping by 0.5 s at the cut
    expect(r.output).toMatchObject({ seconds: 4.5 });
    const info = parseProbe(JSON.parse(Bun.spawnSync([ffprobe!, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", sent]).stdout.toString()));
    expect(info).toMatchObject({ width: 1080, height: 1920, has_audio: true });
    expect(Math.abs(info.duration - 4.5)).toBeLessThan(0.25);
    expect(readFileSync(join(ws, "media", "motion.ass"), "utf8")).toContain("{\\an5\\fad(80,250)\\fscx70\\fscy70\\t(0,160,\\fscx100\\fscy100)}Untuk kau yang penat");
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

describe("TikTok HD", () => {
  const ready = { width: 1080, height: 1920, fps: 30, duration: 20, video_codec: "h264", size_bytes: 40 * 1024 ** 2, pix_fmt: "yuv420p", audio_codec: "aac", vfr: false, rotation: 0, mbps: 12 };

  test("a file that already fits TikTok is only remuxed; anything off is re-encoded with the reasons", () => {
    expect(tiktokHdPlan(ready)).toEqual({ mode: "remux", reasons: [], fps: 30, fit: "crop" });
    expect(tiktokHdPlan({ ...ready, fps: 59.94 })).toMatchObject({ mode: "remux", fps: 60 });
    const phone = tiktokHdPlan({ ...ready, width: 2160, height: 3840, fps: 25, pix_fmt: "yuv420p10le", vfr: true, video_codec: "hevc" });
    expect(phone.mode).toBe("reencode");
    expect(phone.reasons.join(" | ")).toMatch(/2160×3840.*25 fps.*variable frame rate.*yuv420p10le/);
    expect(tiktokHdPlan({ ...ready, width: 1920, height: 1080 })).toMatchObject({ mode: "reencode", fit: "blur" });
    expect(tiktokHdPlan({ ...ready, audio_codec: "opus" }).reasons).toEqual(["sound opus, TikTok wants AAC"]);
    expect(tiktokHdPlan({ ...ready, size_bytes: 400 * 1024 ** 2 }).mode).toBe("reencode");
    // the owner's choice wins
    expect(tiktokHdPlan({ ...ready, fps: 25 }, "remux").mode).toBe("remux");
    expect(tiktokHdPlan(ready, "reencode")).toMatchObject({ mode: "reencode", reasons: ["re-encode asked for"] });
    expect(() => tiktokHdPlan({ ...ready, duration: 700 })).toThrow(/at most 600/);
  });

  test("remux copies the streams into a fast-start MP4", () => {
    const args = remuxArgs("in-1.mov", "out.mp4");
    expect(args).toEqual(expect.arrayContaining(["-c", "copy", "-movflags", "+faststart", "0:a:0?"]));
    expect(args.at(-1)).toBe("out.mp4");
  });

  test("reuse rule: a file already named -tiktok-hd or -tiktok-hd-tiktok_fhd is recognized as prepared", () => {
    expect(isTiktokHdPrepared("BBQ_4K-tiktok-hd.mp4")).toBe(true);
    expect(isTiktokHdPrepared("BBQ_4K-tiktok-hd-tiktok_fhd.mp4")).toBe(true);
    expect(isTiktokHdPrepared("BBQ_4K-tiktok-hd-tiktok_fhd-tiktok-hd.mp4")).toBe(true);
    expect(isTiktokHdPrepared("BBQ 4K.mp4")).toBe(false);
    expect(isTiktokHdPrepared("my-video.mp4")).toBe(false);
    expect(isTiktokHdPrepared("test-tiktok_fhd.mp4")).toBe(false);
  });
});

describe.skipIf(!ffmpeg || !ffprobe)("TikTok HD with real ffmpeg", () => {
  let dir: string;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "ao-tthd-"));
    const run = (args: string[]) => Bun.spawn([ffmpeg!, "-hide_banner", "-loglevel", "error", "-y", ...args], { cwd: dir }).exited;
    // ready for TikTok (1080×1920 30 fps H.264 + AAC), and a 25 fps wide clip that is not
    expect(await run(["-f", "lavfi", "-i", "testsrc=size=1080x1920:rate=30:duration=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "ready.mov"])).toBe(0);
    expect(await run(["-f", "lavfi", "-i", "testsrc=size=640x360:rate=25:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "wide25.mp4"])).toBe(0);
  }, 60_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const ctxFor = (src: string, type: string, ws: string) => {
    const { ctx } = makeCtx(join(dir, ws));
    ctx.attachments = [{ id: "upl_src", name: src, content_type: type }];
    ctx.downloadAttachment = async (_id, dest) => copyFileSync(join(dir, src), dest);
    const sent: string[] = [];
    ctx.uploadVideo = async (path) => {
      sent.push(path);
      return { id: `upl_out${sent.length}`, size: readFileSync(path).length };
    };
    return { ctx, sent };
  };
  const info = (path: string) => parseProbe(JSON.parse(Bun.spawnSync([ffprobe!, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path]).stdout.toString()));

  test("auto: a ready MOV is remuxed to MP4 untouched; a 25 fps wide clip is re-encoded to 1080×1920 30 fps", async () => {
    const a = ctxFor("ready.mov", "video/quicktime", "ws-a");
    const r = await runTool(TOOL_REGISTRY.video_tiktok_hd!, { video: 1 }, a.ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toMatchObject({ video_id: "upl_out1", mode: "remux", reasons: [] });
    expect(a.sent[0]).toMatch(/ready-tiktok-hd\.mp4$/);
    expect(info(a.sent[0]!)).toMatchObject({ width: 1080, height: 1920, fps: 30, video_codec: "h264", audio_codec: "aac" });

    const b = ctxFor("wide25.mp4", "video/mp4", "ws-b");
    const r2 = await runTool(TOOL_REGISTRY.video_tiktok_hd!, { video: 1 }, b.ctx);
    expect(r2.ok).toBe(true);
    expect(r2.output).toMatchObject({ mode: "reencode", after: { size: "1080×1920", fps: 30 } });
    expect((r2.output as { reasons: string[] }).reasons.join(" ")).toMatch(/640×360.*25 fps/);
    expect(info(b.sent[0]!)).toMatchObject({ width: 1080, height: 1920, fps: 30 });
  }, 180_000);

  test("auto: an already-prepared attachment is reused as-is without re-encoding or uploading again", async () => {
    const a = ctxFor("ready.mov", "video/quicktime", "ws-reuse");
    a.ctx.attachments[0]!.name = "ready-tiktok-hd-tiktok_fhd.mp4";
    const r = await runTool(TOOL_REGISTRY.video_tiktok_hd!, { video: 1, mode: "auto" }, a.ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toMatchObject({ video_id: "upl_src", mode: "remux", reasons: [] });
    expect(a.sent.length).toBe(0);
    expect(a.ctx.renders.length).toBe(0);
  });
});

describe("Task 024 & Task 026: overlays, per-boundary transitions, letterbox crop, emoji, shot index & review", () => {
  test("EditPlan.overlays adds overlay inputs and colorkey/overlay filter chain in buildEditArgs", () => {
    const plan = EditPlan.parse({
      clips: [{ video: 1, start: 0, end: 5 }],
      overlays: [{ video: 2, start: 0.5, end: 2.5, chromakey: "#00FF00", opacity: 0.9 }],
    });
    const ovProbe = { ...probe, duration: 2 };
    const args = buildEditArgs(
      plan,
      [{ file: "in-1.mp4", probe }],
      "x264",
      "out.mp4",
      "caps.ass",
      null,
      [{ file: "motion-hook.mp4", probe: ovProbe }],
    );
    expect(args).toContain("motion-hook.mp4");
    const fc = args[args.indexOf("-filter_complex") + 1]!;
    expect(fc).toContain("colorkey=0x00FF00:0.25:0.15");
    expect(fc).toContain("colorchannelmixer=aa=0.9");
    expect(fc).toContain("overlay=x=(W-w)/2:y=(H-h)/2:enable='between(t,0.5,2.5)':eof_action=pass[vov0]");
    expect(fc).toContain("[vov0]ass=caps.ass[vo]");
  });

  test("per-boundary transition list computes finishedSeconds, subtitleCues, and xfade per cut", () => {
    const plan = EditPlan.parse({
      clips: [
        { video: 1, start: 0, end: 4 },
        { video: 1, start: 4, end: 8 },
        { video: 1, start: 8, end: 12 },
      ],
      transition: [
        { type: "fade", seconds: 0.5 },
        { type: "slide", seconds: 1.0 },
      ],
      subtitles: { style: "pop", uppercase: true, position: "bottom" },
    });
    const lengths = [4, 4, 4];
    expect(finishedSeconds(plan, lengths)).toBe(10.5); // 12 - (0.5 + 1.0)
    const args = buildEditArgs(plan, [{ file: "a.mp4", probe }, { file: "a.mp4", probe }, { file: "a.mp4", probe }], "x264", "out.mp4", null);
    const fc = args[args.indexOf("-filter_complex") + 1]!;
    expect(fc).toContain("xfade=transition=fade:duration=0.5:offset=3.5[x1]");
    expect(fc).toContain("xfade=transition=slideleft:duration=1:offset=6.5[vc]");

    const transcript = {
      language: "ms",
      duration: 12,
      model: "whisper",
      words: [
        { w: "Satu", s: 0.5, e: 1.0 },
        { w: "Dua", s: 5.0, e: 5.5 }, // in clip 2 (starts at 4s, shifted by -0.5s overlap -> 4.5s)
        { w: "Tiga", s: 9.0, e: 9.5 }, // in clip 3 (starts at 8s, shifted by -1.5s total overlap -> 7.5s)
      ],
    };
    const cues = subtitleCues(plan, { 1: transcript }, { 1: 12 });
    expect(cues).toHaveLength(3);
    expect(cues[0]!.start).toBe(0.5);
    expect(cues[1]!.start).toBe(4.5);
    expect(cues[2]!.start).toBe(7.5);
  });

  test("letterbox crop and per-clip fit override apply before 9:16 reframing", () => {
    const plan = EditPlan.parse({
      clips: [
        { video: 1, start: 0, end: 3, fit: "blur" },
        { video: 1, start: 3, end: 6, crop: "1280:536:0:92", fit: "crop" },
      ],
      fit: "crop",
    });
    const args = buildEditArgs(
      plan,
      [
        { file: "sintel.mp4", probe, crop: "1280:544:0:88" },
        { file: "sintel.mp4", probe, crop: "1280:544:0:88" },
      ],
      "x264",
      "out.mp4",
      null,
    );
    const fc = args[args.indexOf("-filter_complex") + 1]!;
    // Clip 1 uses ClipInput.crop + per-clip fit="blur"
    expect(fc).toContain("[0:v]setpts=(PTS-STARTPTS)/1,crop=1280:544:0:88,split[f0a][f0b]");
    // Clip 2 overrides crop with Clip.crop + fit="crop"
    expect(fc).toContain("[1:v]setpts=(PTS-STARTPTS)/1,crop=1280:536:0:92,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[f1]");
  });

  test("pure helpers: shotsFromScenes, parseCropdetect, parseSignalstats, parseVisionShotLine, chooseClipFit, evaluateReview", () => {
    const shots = shotsFromScenes([2.5, 2.7, 8.0], 10);
    expect(shots).toEqual([
      { start: 0, end: 2.7 },
      { start: 2.7, end: 8 },
      { start: 8, end: 10 },
    ]);

    const cropLog = [
      "[Parsed_cropdetect_0] x1:0 x2:1279 y1:88 y2:631 w:1280 h:544 x:0 y:88 pts:100 t:1.0 crop=1280:544:0:88",
      "[Parsed_cropdetect_0] x1:0 x2:1279 y1:88 y2:631 w:1280 h:544 x:0 y:88 pts:200 t:2.0 crop=1280:544:0:88",
    ].join("\n");
    expect(parseCropdetect(cropLog, 1280, 720)).toEqual({ crop: "1280:544:0:88", letterboxed: true });
    expect(parseCropdetect("crop=1280:720:0:0", 1280, 720)).toEqual({ crop: null, letterboxed: false });

    expect(parseSignalstats("lavfi.signalstats.YAVG=24.5\nlavfi.blur=8.2")).toEqual({
      lumaMean: 24.5,
      dark: true,
      blurry: true,
    });
    expect(parseSignalstats("lavfi.signalstats.YAVG=110.0\nlavfi.blur=1.2")).toEqual({
      lumaMean: 110,
      dark: false,
      blurry: false,
    });

    const vis = parseVisionShotLine("Line 1: Wide title card reading THE GIANT PANDA | text:yes | faces:no | dark:no | blurry:no");
    expect(vis).toEqual({
      description: "Wide title card reading THE GIANT PANDA",
      text_on_screen: true,
      faces: false,
      dark: false,
      blurry: false,
    });
    expect(chooseClipFit(vis, "crop", true, true)).toBe("blur");
    expect(chooseClipFit({ text_on_screen: false, faces: false }, "crop", true, true)).toBe("crop");

    const blacks = parseBlackdetect("black_start:0 black_end:0.8 black_duration:0.8");
    expect(blacks).toEqual([{ start: 0, end: 0.8, duration: 0.8 }]);
    expect(parseLoudness("[Parsed_ebur128_0] I: -14.2 LUFS")).toEqual({ integratedLufs: -14.2 });

    const revBad = evaluateReview({
      duration: 39.5,
      targetMin: 25,
      targetMax: 30,
      blackSegments: blacks,
      lumaMean: 30,
      letterboxed: true,
      visionText: "cut_text:yes | bars:yes | hook_ok:no",
      expectHook: true,
    });
    expect(revBad.passed).toBe(false);
    expect(revBad.score).toBeLessThan(0.7);
    expect(revBad.problems.length).toBeGreaterThanOrEqual(4);

    const revGood = evaluateReview({
      duration: 28.0,
      targetMin: 25,
      targetMax: 30,
      blackSegments: [],
      lumaMean: 115,
      letterboxed: false,
      visionText: "cut_text:no | bars:no | tofu:no | hook_ok:yes | notes:Clean vertical edit",
      expectHook: true,
    });
    expect(revGood.passed).toBe(true);
    expect(revGood.score).toBe(1);
    expect(revGood.problems).toEqual([]);
  });

  test("captionsAss wraps emoji 🔥 in a monochrome outline font override so libass never renders tofu", () => {
    const ass = captionsAss([{ text: "Panaskan suasana 🔥 sekarang!", start: 0, end: 2, position: "middle" }], VIDEO_PRESETS.tiktok_fhd);
    expect(ass).toMatch(/\{\\fn(Segoe UI Symbol|Noto Emoji)\\b0\}🔥\{\\fnArial\\b1\}/);
  });

  test("repeat guard refuses the 3rd identical failed tool call with a clear error message", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ao-repeat-guard-"));
    try {
      const { ctx } = makeCtx(tmp);
      // video 9 does not exist -> fails
      const r1 = await runTool(TOOL_REGISTRY.video_probe!, { video: 9 }, ctx);
      expect(r1.ok).toBe(false);
      const r2 = await runTool(TOOL_REGISTRY.video_probe!, { video: 9 }, ctx);
      expect(r2.ok).toBe(false);
      const r3 = await runTool(TOOL_REGISTRY.video_probe!, { video: 9 }, ctx);
      expect(r3.ok).toBe(false);
      expect((r3.output as { refused_repeat?: boolean; error?: string }).refused_repeat).toBe(true);
      expect((r3.output as { error?: string }).error).toMatch(/already failed 2 times with the exact same input/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
