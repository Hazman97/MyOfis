import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { explainerRenderTool } from "../src/explainer.ts";
import { saveDraftTool } from "../src/content.ts";
import { makeCtx } from "./helpers.ts";

describe("explainer_render tool (Task 029)", () => {
  test("tool properties are correct", () => {
    expect(explainerRenderTool.name).toBe("explainer_render");
    expect(explainerRenderTool.category).toBe("write");
  });

  test("rejects invalid script without scenes", async () => {
    const ws = mkdtempSync(join(tmpdir(), "exp-test-"));
    const { ctx } = makeCtx(ws);

    await expect(
      explainerRenderTool.execute(
        {
          topic: "Ujian",
          hook: "Adakah anda bersedia untuk ujian?",
          scenes: [],
          outro: "Kongsikan video ini sekarang bersama rakan anda.",
          sources: ["https://example.com"],
          fact_sheet: [],
        } as any,
        ctx,
      ),
    ).rejects.toThrow("1 to 8 scenes");
  });

  test("rejects script when word count is too short for target duration (<20s)", async () => {
    const ws = mkdtempSync(join(tmpdir(), "exp-test-"));
    const { ctx } = makeCtx(ws);

    await expect(
      explainerRenderTool.execute(
        {
          topic: "WiFi 8 vs 7",
          language: "ms",
          hook: "Pendek sangat.",
          scenes: [
            {
              id: "s1",
              narration: "Satu dua.",
              on_screen: "Ringkas",
              visual: {
                template: "big_stat",
                label: "Kelajuan",
                number: "23 Gbps",
                unit: "Gbps",
              },
            },
          ],
          outro: "Tamat.",
          sources: ["https://example.com/wifi8"],
          fact_sheet: [],
          pasted: false,
        },
        ctx,
      ),
    ).rejects.toThrow("Estimated total duration");
  });

  test("renders 3-scene video and saves draft with fact sheet metadata", async () => {
    const ws = mkdtempSync(join(tmpdir(), "exp-test-"));
    const { ctx, drafts } = makeCtx(ws);
    ctx.projectContext = {
      projects: [{ id: "prj_1", slug: "demo", name: "Demo", brief: null, past_drafts: [] }],
      active_project_id: "prj_1",
    } as any;

    // Mock TTS returns a valid 1.5s silent MP3 file
    ctx.tts = async (_text: string) => {
      const mediaDir = join(ws, "media");
      mkdirSync(mediaDir, { recursive: true });
      const mp3Path = join(mediaDir, `tts-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mp3`);
      
      const proc = Bun.spawn({
        cmd: ["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "1.5", "-c:a", "libmp3lame", mp3Path],
        stdout: "ignore",
        stderr: "ignore",
      });
      await proc.exited;
      return mp3Path;
    };

    // Mock videoData transcript for subtitle alignment
    ctx.videoData = async () => ({
      transcript: {
        words: [
          { w: "Ramai", s: 0.0, e: 0.4 },
          { w: "tertanya-tanya", s: 0.4, e: 0.9 },
          { w: "tentang", s: 0.9, e: 1.2 },
          { w: "WiFi", s: 1.2, e: 1.4 },
        ],
      },
    });

    const res = await explainerRenderTool.execute(
      {
        topic: "WiFi 8 vs WiFi 7: Apa Yang Anda Perlu Tahu",
        language: "ms",
        hook: "Ramai yang tertanya-tanya adakah WiFi 8 jauh lebih laju berbanding WiFi 7 yang baru sahaja kita guna hari ini?",
        scenes: [
          {
            id: "s1",
            narration: "WiFi 8 sebenarnya tidak fokus pada kelajuan puncak semata-mata, sebaliknya memfokuskan kecekapan sambungan pengguna ramai.",
            on_screen: "Fokus Kecekapan",
            visual: {
              template: "big_stat",
              label: "Kelajuan Puncak WiFi 8",
              number: "23 Gbps",
              unit: "Gbps",
            },
          },
          {
            id: "s2",
            narration: "Sebaliknya WiFi 7 mencatatkan kelajuan puncak sehingga 46 Gbps dengan menggunakan saiz saluran 320 MHz yang amat lebar.",
            on_screen: "Jalur Lebar 320 MHz",
            visual: {
              template: "compare_table",
              title: "Perbandingan Ciri Utama",
              headers: ["Ciri", "WiFi 7", "WiFi 8"],
              rows: [
                { feature: "Kelajuan Puncak", values: ["46 Gbps", "23 Gbps"] },
                { feature: "Jalur Saluran", values: ["320 MHz", "320 MHz"] },
                { feature: "Modulasi", values: ["4096-QAM", "4096-QAM"] },
              ],
            },
          },
          {
            id: "s3",
            narration: "Kesimpulannya WiFi 8 direka untuk kestabilan di kawasan sesak seperti stadium, pejabat, dan pusat beli-belah.",
            on_screen: "Kestabilan Kawasan Sesak",
            visual: {
              template: "diagram",
              title: "Senibina Koordinasi Pintar",
              nodes: [
                { id: "router", label: "Penghala WiFi 8", icon: "router" },
                { id: "device1", label: "Komputer Riba", icon: "laptop" },
                { id: "device2", label: "Telefon Pintar", icon: "phone" },
              ],
              arrows: [
                { from: "router", to: "device1", label: "Koordinasi AP" },
                { from: "router", to: "device2", label: "Rangkaian Lancar" },
              ],
            },
          },
        ],
        outro: "Kongsikan video ini kepada rakan anda yang suka teknologi dan tinggalkan pandangan anda di ruangan komen di bawah!",
        sources: [
          "https://ieee802.org/11/Reports/tgbn_update.htm",
          "https://www.wi-fi.org/discover-wi-fi/wi-fi-certified-7",
        ],
        fact_sheet: [
          {
            claim: "Generasi WiFi 7 dan WiFi 8",
            value: "WiFi 7, WiFi 8",
            source_url: "https://ieee802.org/11/Reports/tgbn_update.htm",
            verified: true,
          },
          {
            claim: "Kelajuan puncak WiFi 8 adalah 23 Gbps",
            value: "23 Gbps",
            source_url: "https://ieee802.org/11/Reports/tgbn_update.htm",
            verified: true,
          },
          {
            claim: "Kelajuan puncak WiFi 7 adalah 46 Gbps",
            value: "46 Gbps",
            source_url: "https://www.wi-fi.org/discover-wi-fi/wi-fi-certified-7",
            verified: true,
          },
          {
            claim: "Jalur lebar saluran kedua-duanya 320 MHz",
            value: "320 MHz",
            source_url: "https://ieee802.org/11/Reports/tgbn_update.htm",
            verified: true,
          },
          {
            claim: "Kedua-duanya menyokong modulasi 4096-QAM",
            value: "4096-QAM",
            source_url: "https://ieee802.org/11/Reports/tgbn_update.htm",
            verified: true,
          },
        ],
        pasted: false,
      },
      ctx,
    );

    expect(res).toBeDefined();
    expect(res.ok).toBe(true);
    const out = res.output as any;
    expect(out.duration).toBeGreaterThan(2);
    expect(out.scene_count).toBe(3);
    // explainer_render does NOT save drafts directly; it pushes to ctx.renders for save_draft
    expect(drafts.length).toBe(0);
    expect(ctx.renders.length).toBe(1);
    expect(ctx.renders[0]!.fact_sheet?.length).toBe(5);

    // Agent calls save_draft(video: "last") -> saves 1 draft with fact_sheet preserved in meta
    const saved = await saveDraftTool.execute(
      {
        platform: "tiktok",
        kind: "video",
        title: "WiFi 8 vs WiFi 7: Apa Yang Anda Perlu Tahu",
        body: "WiFi 8 fokus pada kestabilan, bukan sekadar kelajuan.",
        self_check: {
          facts_match_brief: true,
          only_released_features: true,
          no_overclaims: true,
          tone_and_language_match: true,
          notes: "Disahkan.",
        },
        video: "last",
      },
      ctx,
    );
    expect(saved.ok).toBe(true);
    expect(drafts.length).toBe(1);
    expect(drafts[0]!.title).toBe("WiFi 8 vs WiFi 7: Apa Yang Anda Perlu Tahu");
    const meta = drafts[0]!.meta as any;
    expect(meta?.fact_sheet).toBeDefined();
    expect((meta?.fact_sheet as any[]).length).toBe(5);
  }, 45000);

  test("blocks render when script has unverified numbers not in fact_sheet", async () => {
    const ws = mkdtempSync(join(tmpdir(), "exp-block-"));
    const { ctx } = makeCtx(ws);
    await expect(
      explainerRenderTool.execute(
        {
          topic: "WiFi 8 vs WiFi 7",
          language: "ms",
          hook: "Ramai yang tertanya-tanya adakah generasi baharu ini jauh lebih laju berbanding teknologi sedia ada yang baru sahaja kita guna hari ini di rumah dan pejabat?",
          scenes: [
            {
              id: "s1",
              narration: "Kelajuan baharu dikatakan mencapai sehingga 999 Gbps tanpa sebarang bukti rasmi atau rujukan teknikal dalam lembaran fakta yang disahkan oleh badan piawaian.",
              on_screen: "999 Gbps",
              visual: { template: "big_stat", label: "Kelajuan", number: "999 Gbps" },
            },
          ],
          outro: "Sila semak fakta sebelum berkongsi video teknologi kepada orang ramai di media sosial supaya maklumat kekal tepat.",
          sources: ["https://ieee802.org"],
          fact_sheet: [{ claim: "WiFi 8", value: "23 Gbps", source_url: "https://ieee802.org", verified: true }],
          pasted: false,
        },
        ctx,
      ),
    ).rejects.toThrow("Unverified numbers");
  });

  test("fake TTS HTTP server + fake whisper produce 1080x1920 MP4 with audio stream and expected duration", async () => {
    const ws = mkdtempSync(join(tmpdir(), "exp-http-tts-"));
    const { ctx } = makeCtx(ws);

    // Pre-generate a real 1.5s MP3 sample served by an in-process HTTP TTS server
    const sampleMp3 = join(ws, "sample-1.5s.mp3");
    const gen = Bun.spawn({
      cmd: ["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "1.5", "-c:a", "libmp3lame", sampleMp3],
      stdout: "ignore",
      stderr: "ignore",
    });
    expect(await gen.exited).toBe(0);
    const mp3Bytes = await Bun.file(sampleMp3).arrayBuffer();

    let ttsCalls = 0;
    const fakeTtsServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/v1/audio/speech" && req.method === "POST") {
          ttsCalls++;
          return new Response(mp3Bytes, { headers: { "content-type": "audio/mpeg" } });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    try {
      ctx.tts = async (text: string) => {
        const res = await fetch(`http://127.0.0.1:${fakeTtsServer.port}/v1/audio/speech`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input: text }),
        });
        expect(res.ok).toBe(true);
        const mediaDir = join(ws, "media");
        mkdirSync(mediaDir, { recursive: true });
        const out = join(mediaDir, `tts-${ttsCalls}-${Date.now()}.mp3`);
        writeFileSync(out, new Uint8Array(await res.arrayBuffer()));
        return out;
      };

      // Fake whisper transcript provider
      ctx.videoData = async () => ({
        transcript: {
          words: [
            { w: "Ujian", s: 0.0, e: 0.4 },
            { w: "audio", s: 0.4, e: 0.8 },
            { w: "video", s: 0.8, e: 1.3 },
          ],
        },
      });

      const res = await explainerRenderTool.execute(
        {
          topic: "WiFi 8 vs WiFi 7",
          language: "ms",
          hook: "Adakah anda sudah bersedia melihat perbezaan antara generasi WiFi 7 dengan WiFi 8 yang bakal tiba untuk semua pengguna rumah?",
          scenes: [
            {
              id: "s1",
              narration: "WiFi 8 memfokuskan kestabilan sambungan berbanding kelajuan puncak 23 Gbps semata-mata supaya rangkaian kekal lancar di kawasan sesak.",
              on_screen: "23 Gbps Stabil",
              visual: { template: "big_stat", label: "Kelajuan", number: "23 Gbps", unit: "Gbps" },
            },
            {
              id: "s2",
              narration: "Kedua-dua piawaian menggunakan jalur 6 GHz dengan lebar saluran 320 MHz yang luas untuk menampung banyak peranti serentak.",
              on_screen: "6 GHz / 320 MHz",
              visual: {
                template: "compare_table",
                title: "WiFi 7 vs WiFi 8",
                headers: ["WiFi 7", "WiFi 8"],
                rows: [
                  { feature: "Jalur", values: ["6 GHz", "6 GHz"] },
                  { feature: "Saluran", values: ["320 MHz", "320 MHz"] },
                  { feature: "Fokus", values: ["Kelajuan", "Kestabilan"] },
                ],
              },
            },
          ],
          outro: "Kongsikan video penerangan ini kepada rakan anda dan ikuti kami untuk lebih banyak kupasan teknologi terkini setiap minggu.",
          sources: ["https://ieee802.org"],
          fact_sheet: [
            { claim: "Peak speed", value: "23 Gbps", source_url: "https://ieee802.org", verified: true },
            { claim: "Band", value: "6 GHz", source_url: "https://ieee802.org", verified: true },
            { claim: "Channel", value: "320 MHz", source_url: "https://ieee802.org", verified: true },
            { claim: "Gen", value: "WiFi 7, WiFi 8", source_url: "https://ieee802.org", verified: true },
          ],
          pasted: false,
        },
        ctx,
      );

      const out = res as any;
      expect(ttsCalls).toBe(2); // 2 scenes
      expect(out.ok).toBe(true);
      expect(typeof out.output?.video_path).toBe("string");

      const ffprobe = Bun.spawn({
        cmd: ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", out.output.video_path],
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await ffprobe.exited).toBe(0);
      const probed = JSON.parse(await new Response(ffprobe.stdout).text()) as {
        streams: Array<{ codec_type: string; width?: number; height?: number }>;
        format: { duration?: string };
      };
      const vStream = probed.streams.find((s) => s.codec_type === "video");
      const aStream = probed.streams.find((s) => s.codec_type === "audio");
      const duration = Number(probed.format.duration);
      expect(vStream?.width).toBe(1080);
      expect(vStream?.height).toBe(1920);
      expect(aStream).toBeDefined();
      // 2 segments * (1.5s audio + 0.3s tail) - 1 overlap * 0.3s = 3.6 - 0.3 = 3.3s
      const expectedDuration = 2 * (1.5 + 0.3) - 1 * 0.3;
      expect(Math.abs(duration - expectedDuration)).toBeLessThan(0.8);
    } finally {
      fakeTtsServer.stop(true);
    }
  }, 45000);
});
