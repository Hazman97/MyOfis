import { describe, expect, test } from "bun:test";
import {
  MOTION_PRESETS,
  MotionTemplateId,
  buildComposition,
  buildKineticGroups,
  escapeHtml,
  requiredPrograms,
  splitHookLines,
  wordsFromPlainText,
} from "../src/index.ts";

describe("motion composition builder (Task 024)", () => {
  test("escapeHtml escapes all dangerous HTML characters", () => {
    const raw = `<script>alert("xss" & 'owned')</script>`;
    const escaped = escapeHtml(raw);
    expect(escaped).toBe("&lt;script&gt;alert(&quot;xss&quot; &amp; &#39;owned&#39;)&lt;/script&gt;");
    expect(escaped).not.toContain("<script>");
  });

  test("all 7 templates build valid HyperFrames compositions and escape user strings", () => {
    const xss = `<img src=x onerror=alert(1)> & "quote"`;
    const cases: { template: MotionTemplateId; params: Record<string, unknown> }[] = [
      {
        template: "hook",
        params: {
          lines: [`3 Rahsia Bisnes 🔥`, xss],
          badge: `TERKINI <script>`,
          subtext: `Jangan tinggal langkah #3`,
          duration: 2.5,
        },
      },
      {
        template: "kinetic_captions",
        params: {
          words: [
            { w: "Kenapa", s: 0, e: 0.4 },
            { w: "ramai", s: 0.4, e: 0.8 },
            { w: xss, s: 0.8, e: 1.4 },
          ],
          position: "bottom",
        },
      },
      {
        template: "title_card",
        params: {
          kicker: "BAB 1",
          title: `Strategi Jualan ${xss}`,
          subtitle: "Panduan lengkap untuk usahawan Malaysia 🇲🇾",
        },
      },
      {
        template: "list",
        params: {
          title: "5 Langkah Mudah",
          items: ["Tetapkan sasaran", "Kenal pelanggan", xss, "Uji iklan", "Gandakan hasil"],
          numbered: true,
        },
      },
      {
        template: "countdown",
        params: {
          from: 3,
          label: `Bersedia dalam... ${xss}`,
          final_text: "MULA SEKARANG! 🚀",
        },
      },
      {
        template: "lower_third",
        params: {
          name: `Hazman (${xss})`,
          role: "Pengasas · CanopyAI",
          align: "left",
        },
      },
      {
        template: "outro_cta",
        params: {
          headline: `Suka video ni? ${xss}`,
          handle: "@myofis.my",
          action: "Follow & Kongsi 🔔",
        },
      },
    ];

    for (const c of cases) {
      const built = buildComposition(c.template, c.params);
      expect(built.template).toBe(c.template);
      expect(built.width).toBe(1080);
      expect(built.height).toBe(1920);
      expect(built.fps).toBe(30);
      expect(built.html).toContain(`data-composition-id="main"`);
      expect(built.html).toContain(`window.__timelines["main"] = timeline`);
      expect(built.html).toContain(`default-src 'none'`);
      expect(built.html.toLowerCase()).not.toContain("<img src=x onerror=alert(1)>");
      expect(built.html.toLowerCase()).toContain("&lt;img src=x onerror=alert(1)&gt;");
      // Long Malay words & emoji overflow protection
      expect(built.html).toContain("overflow-wrap: anywhere");
      expect(built.html).toContain("word-break: break-word");
      // No external web fonts
      expect(built.html).not.toContain("fonts.googleapis.com");
      expect(built.html).not.toContain("https://");
    }
  });

  test("supports tiktok_fhd, square, and youtube_1080p preset sizes", () => {
    for (const [id, preset] of Object.entries(MOTION_PRESETS)) {
      const built = buildComposition("hook", { text: "Jom Tengok!", size: id });
      expect(built.width).toBe(preset.width);
      expect(built.height).toBe(preset.height);
      expect(built.html).toContain(`data-width="${preset.width}"`);
      expect(built.html).toContain(`data-height="${preset.height}"`);
    }
  });

  test("splitHookLines balances Malay phrases and long words into at most 3 lines", () => {
    expect(splitHookLines("3 Rahsia Bisnes")).toEqual(["3 Rahsia Bisnes"]);
    expect(splitHookLines("Jangan Buat Kesilapan Ini Sekarang")).toHaveLength(2);
    const three = splitHookLines("Satu Dua Tiga Empat Lima Enam Tujuh Lapan Sembilan");
    expect(three).toHaveLength(3);
  });

  test("buildKineticGroups groups timed words and preserves per-word active windows", () => {
    const words = [
      { w: "Ini", s: 0.0, e: 0.3 },
      { w: "rahsia", s: 0.3, e: 0.7 },
      { w: "bisnes.", s: 0.7, e: 1.2 },
      { w: "Jom", s: 1.8, e: 2.1 },
      { w: "mula!", s: 2.1, e: 2.6 },
    ];
    const groups = buildKineticGroups(words, 3, true);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.words.map((w) => w.w)).toEqual(["INI", "RAHSIA", "BISNES."]);
    expect(groups[0]!.start).toBe(0);
    expect(groups[0]!.end).toBe(1.2);
    expect(groups[1]!.words.map((w) => w.w)).toEqual(["JOM", "MULA!"]);
    expect(groups[1]!.start).toBe(1.8);

    const synth = wordsFromPlainText("Satu dua tiga empat", 2.0);
    expect(synth).toHaveLength(4);
    expect(synth[0]!.s).toBe(0);
    expect(synth[3]!.e).toBe(2);
  });

  test("requiredPrograms maps motion_render to ffmpeg + hyperframes", () => {
    expect(requiredPrograms({ tools: ["motion_render"] })).toEqual(["ffmpeg", "hyperframes"]);
  });
});
