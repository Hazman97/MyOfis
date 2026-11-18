import { describe, expect, test } from "bun:test";
import {
  ExplainerScript,
  FactSheetItem,
  SpectrumVisual,
  CompareTableVisual,
  BarChartVisual,
  BigStatVisual,
  TimelineVisual,
  DiagramVisual,
  countWords,
  validateExplainerScript,
  extractVisualNumbers,
  validateNumbersInFactSheet,
  buildComposition,
} from "../src/index.ts";

describe("Task 029 Pure Logic: ExplainerScript, FactSheet, Layout & HTML Composition", () => {
  const sampleFactSheet: FactSheetItem[] = [
    {
      claim: "WiFi 8 (802.11bn) dan WiFi 7",
      value: "WiFi 7, WiFi 8, 802.11bn",
      source_url: "https://ieee802.org/11/Reports/tgbn_update.htm",
      verified: true,
    },
    {
      claim: "Kelajuan maksimum WiFi 7",
      value: "46 Gbps",
      source_url: "https://www.wi-fi.org/discover-wi-fi/wi-fi-certified-7",
      verified: true,
    },
    {
      claim: "Lebar saluran maksimum WiFi 7",
      value: "320 MHz",
      source_url: "https://www.wi-fi.org/discover-wi-fi/wi-fi-certified-7",
      verified: true,
    },
    {
      claim: "Jalur frekuensi",
      value: "2.4 GHz, 5 GHz, 6 GHz",
      source_url: "https://www.wi-fi.org",
      verified: true,
    },
    {
      claim: "Tahun pelancaran jangkaan WiFi 8",
      value: "2028",
      source_url: "https://ieee802.org",
      verified: true,
    },
  ];

  test("1. countWords accurately counts words in Malay and English", () => {
    expect(countWords("WiFi 8 dah sampai? Ni beza dia!")).toBe(7);
    expect(countWords("Ramai tak tahu, WiFi 7 baru keluar tapi jurutera dah rancang WiFi 8.")).toBe(13);
    expect(countWords("")).toBe(0);
  });

  test("2. validateExplainerScript enforces <= 40 words per scene and duration bounds", () => {
    const validScript: ExplainerScript = {
      topic: "WiFi 8 vs WiFi 7",
      language: "ms",
      hook: "WiFi 8 dah sampai? Ni beza sebenar yang ramai terlepas!",
      scenes: [
        {
          id: "intro_freq",
          narration: "WiFi 7 guna tiga jalur iaitu 2.4, 5 dan 6 GHz dengan lebar 320 MHz.",
          on_screen: "3 Jalur: 2.4 / 5 / 6 GHz",
          visual: {
            template: "spectrum",
            title: "Spektrum Frekuensi",
            unit: "GHz",
            bands: [
              {
                name: "Jalur 6 GHz",
                freq: "6 GHz",
                channels: [{ label: "CH 1", width: "320 MHz", highlight: true }],
                highlight: true,
              },
            ],
          },
        },
        {
          id: "speed_comp",
          narration: "Kelajuan maksimum mencecah 46 Gbps, tapi WiFi 8 fokus pada kestabilan.",
          on_screen: "46 Gbps Max Speed",
          visual: {
            template: "big_stat",
            number: "46 Gbps",
            label: "Kelajuan Maksimum",
          },
        },
      ],
      outro: "Korang rasa berbaloi ke tunggu WiFi 8? Komen kat bawah!",
      sources: ["IEEE 802.11bn Working Group", "Wi-Fi Alliance"],
      fact_sheet: sampleFactSheet,
      pasted: false,
    };

    const res = validateExplainerScript(validScript);
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);

    // Too many words in a scene narration
    const longNarration = "perkataan ".repeat(42);
    const invalidScript = {
      ...validScript,
      scenes: [{ ...validScript.scenes[0]!, narration: longNarration }],
    };
    const resLong = validateExplainerScript(invalidScript);
    expect(resLong.valid).toBe(false);
    expect(resLong.errors.some((e) => e.includes("exceeds 40 words"))).toBe(true);
  });

  test("3. extractVisualNumbers and validateNumbersInFactSheet detects unverified numbers", () => {
    const validScript: ExplainerScript = {
      topic: "WiFi 8 vs WiFi 7",
      language: "ms",
      hook: "WiFi 8 dah sampai?",
      scenes: [
        {
          id: "s1",
          narration: "WiFi 7 laju sehingga 46 Gbps.",
          on_screen: "46 Gbps",
          visual: {
            template: "big_stat",
            number: "46 Gbps",
            label: "Kelajuan",
          },
        },
      ],
      outro: "Jom sembang!",
      sources: ["https://wi-fi.org"],
      fact_sheet: sampleFactSheet,
      pasted: false,
    };

    const validCheck = validateNumbersInFactSheet(validScript);
    expect(validCheck.ok).toBe(true);
    expect(validCheck.unverifiedNumbers).toEqual([]);

    // Add unverified number in visual
    const unverifiedScript: ExplainerScript = {
      ...validScript,
      scenes: [
        {
          id: "s_invented",
          narration: "Kelajuan rahsia 999 Gbps.",
          on_screen: "999 Gbps",
          visual: {
            template: "big_stat",
            number: "999 Gbps",
            label: "Angka Rekaan",
          },
        },
      ],
    };

    const unverifiedCheck = validateNumbersInFactSheet(unverifiedScript);
    expect(unverifiedCheck.ok).toBe(false);
    expect(unverifiedCheck.unverifiedNumbers.length).toBeGreaterThan(0);
    expect(unverifiedCheck.unverifiedNumbers[0]).toContain("999");

    // Normalisation: "6 GHz", "6GHz", and "6.0" all match "6 GHz" in fact_sheet
    const normScript = ExplainerScript.parse({
      ...validScript,
      scenes: [
        {
          id: "s_norm",
          narration: "Jalur 6.0 dan 6GHz dibuka.",
          on_screen: "6 GHz",
          visual: { template: "big_stat", number: "6GHz", label: "Spektrum" },
        },
      ],
    });
    expect(validateNumbersInFactSheet(normScript)).toEqual({ ok: true, unverifiedNumbers: [], unverified: false });

    // Number in narration/on_screen not in fact_sheet fails even if present in sources URL
    const urlOnlyScript = ExplainerScript.parse({
      ...validScript,
      sources: ["https://example.com/report-777"],
      scenes: [
        {
          id: "s_narration_bad",
          narration: "Kadar naik 777 peratus.",
          on_screen: "777%",
          visual: { template: "big_stat", number: "46 Gbps", label: "Laju" },
        },
      ],
    });
    const urlCheck = validateNumbersInFactSheet(urlOnlyScript);
    expect(urlCheck.ok).toBe(false);
    expect(urlCheck.unverifiedNumbers.join(" ")).toContain("777");

    // Empty fact_sheet fails unless pasted: true
    expect(validateNumbersInFactSheet(ExplainerScript.parse({ ...validScript, fact_sheet: [] })).ok).toBe(false);
    expect(validateNumbersInFactSheet(ExplainerScript.parse({ ...validScript, fact_sheet: [], pasted: true }))).toEqual({
      ok: true,
      unverifiedNumbers: [],
      unverified: true,
    });
  });

  test("9. buildComposition generates valid offline HTML for all 6 infographic templates", () => {
    // 1. Spectrum
    const compSpectrum = buildComposition("spectrum", {
      template: "spectrum",
      title: "Jalur Spektrum WiFi",
      unit: "GHz",
      duration: 5,
      bands: [
        {
          name: "2.4 GHz",
          freq: "2.4 GHz",
          channels: [{ label: "CH 1-11", width: "20 MHz", highlight: false }],
        },
        {
          name: "6 GHz",
          freq: "6 GHz",
          highlight: true,
          channels: [{ label: "Ultra Wide", width: "320 MHz", highlight: true }],
        },
      ],
    });
    expect(compSpectrum.html).toContain('data-composition-id="main"');
    expect(compSpectrum.html).toContain("window.__timelines");
    expect(compSpectrum.html).toContain("Jalur Spektrum WiFi");
    expect(compSpectrum.html).toContain("320 MHz");

    // 2. Compare Table
    const compTable = buildComposition("compare_table", {
      template: "compare_table",
      title: "WiFi 6 vs 7 vs 8",
      duration: 6,
      headers: ["Ciri", "WiFi 7", "WiFi 8"],
      rows: [
        { feature: "Kelajuan", values: ["46 Gbps", "46 Gbps+"], winner_index: 1 },
        { feature: "Saluran", values: ["320 MHz", "320 MHz"] },
        { feature: "Fokus", values: ["Speed", "Reliability"], winner_index: 1 },
      ],
    });
    expect(compTable.html).toContain("compare-table");
    expect(compTable.html).toContain("WiFi 6 vs 7 vs 8");

    // 3. Bar Chart
    const compChart = buildComposition("bar_chart", {
      template: "bar_chart",
      title: "Perbandingan Kelajuan Puncak",
      unit: "Gbps",
      duration: 5,
      bars: [
        { label: "WiFi 5", value: 3.5 },
        { label: "WiFi 6", value: 9.6 },
        { label: "WiFi 7", value: 46, highlight: true },
      ],
    });
    expect(compChart.html).toContain("bar-track");
    expect(compChart.html).toContain("46 Gbps");

    // 4. Big Stat
    const compStat = buildComposition("big_stat", {
      template: "big_stat",
      number: "46 Gbps",
      label: "Kelajuan Puncak Teoritikal",
      subtitle: "Hampir 5 kali ganda lebih pantas berbanding WiFi 6",
      duration: 4,
    });
    expect(compStat.html).toContain("stat-number");
    expect(compStat.html).toContain("46 Gbps");

    // 5. Timeline
    const compTimeline = buildComposition("timeline", {
      template: "timeline",
      title: "Evolusi Standard WiFi",
      duration: 6,
      points: [
        { year: "2019", title: "WiFi 6 (802.11ax)", desc: "Pengenalan OFDMA" },
        { year: "2024", title: "WiFi 7 (802.11be)", desc: "Saluran 320 MHz" },
        { year: "2028 (dijangka)", title: "WiFi 8 (802.11bn)", desc: "Ultra High Reliability", highlight: true },
      ],
    });
    expect(compTimeline.html).toContain("timeline-container");
    expect(compTimeline.html).toContain("2028 (dijangka)");

    // 6. Diagram
    const compDiagram = buildComposition("diagram", {
      template: "diagram",
      title: "Aliran Isyarat WiFi",
      duration: 5,
      nodes: [
        { id: "p", label: "Telefon", icon: "phone" },
        { id: "r", label: "Router WiFi 7", icon: "router" },
        { id: "c", label: "Internet Awan", icon: "cloud" },
      ],
      arrows: [
        { from: "p", to: "r", label: "320 MHz" },
        { from: "r", to: "c", label: "Fiber 1 Gbps" },
      ],
    });
    expect(compDiagram.html).toContain("diagram-container");
    expect(compDiagram.html).toContain("Router WiFi 7");
    expect(compDiagram.html).toContain("<svg");
  });
});

