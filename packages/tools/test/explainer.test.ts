import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { explainerRenderTool } from "../src/explainer.ts";
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
        },
        ctx,
      ),
    ).rejects.toThrow("Estimated total duration");
  });

  test("renders 3-scene video and saves draft with fact sheet metadata", async () => {
    const ws = mkdtempSync(join(tmpdir(), "exp-test-"));
    const { ctx, drafts } = makeCtx(ws);

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
      },
      ctx,
    );

    expect(res).toBeDefined();
    expect(res.ok).toBe(true);
    const out = res.output as any;
    expect(out.duration).toBeGreaterThan(2);
    expect(out.scene_count).toBe(3);
    expect(drafts.length).toBe(1);
    expect(drafts[0]!.title).toBe("WiFi 8 vs WiFi 7: Apa Yang Anda Perlu Tahu");
    const meta = drafts[0]!.meta as any;
    expect(meta?.fact_sheet).toBeDefined();
    expect((meta?.fact_sheet as any[]).length).toBe(4);
  }, 45000);
});
