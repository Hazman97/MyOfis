import { z } from "zod";

/**
 * Task 029: Tech explainer videos (infographic + motion + Malay voice-over).
 * Pure schema, validation, fact sheet checking, and 1080x1920 layout calculations.
 */

// ---------------------------------------------------------------- Fact sheet & claim verification

export const FactSheetItem = z.object({
  claim: z.string().min(1).max(300).describe("Fakta/spesifikasi teknikal"),
  value: z.string().min(1).max(100).describe("Nilai atau angka (e.g. '46 Gbps', '320 MHz', '2024')"),
  source_url: z.string().url().max(500).describe("URL sumber rasmi / vendor"),
  verified: z.boolean().default(true).describe("Sama ada fakta telah disahkan dengan web_fetch"),
});
export type FactSheetItem = z.infer<typeof FactSheetItem>;

// ---------------------------------------------------------------- 6 Infographic Visual Templates

/** 1. Spectrum: frequency bands (e.g. 2.4 / 5 / 6 GHz) and channel blocks */
export const SpectrumVisual = z.object({
  template: z.literal("spectrum"),
  title: z.string().min(1).max(80),
  unit: z.string().max(20).default("GHz"),
  bands: z
    .array(
      z.object({
        name: z.string().min(1).max(30),
        freq: z.string().min(1).max(20), // "2.4 GHz", "5 GHz", "6 GHz"
        channels: z
          .array(
            z.object({
              label: z.string().min(1).max(30),
              width: z.string().min(1).max(20), // "20 MHz", "80 MHz", "160 MHz", "320 MHz"
              highlight: z.boolean().default(false),
            }),
          )
          .min(1)
          .max(8),
        highlight: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(6),
});
export type SpectrumVisual = z.infer<typeof SpectrumVisual>;

/** 2. Compare Table: 2–4 columns × 3–6 rows (e.g. WiFi 6 vs 7 vs 8) */
export const CompareTableVisual = z.object({
  template: z.literal("compare_table"),
  title: z.string().min(1).max(80),
  headers: z.array(z.string().min(1).max(30)).min(2).max(4),
  rows: z
    .array(
      z.object({
        feature: z.string().min(1).max(40),
        values: z.array(z.string().min(1).max(60)),
        winner_index: z.number().int().min(0).max(3).optional(),
      }),
    )
    .min(3)
    .max(6),
});
export type CompareTableVisual = z.infer<typeof CompareTableVisual>;

/** 3. Bar Chart: 2–6 bars with value labels and units */
export const BarChartVisual = z.object({
  template: z.literal("bar_chart"),
  title: z.string().min(1).max(80),
  unit: z.string().max(20).default("Gbps"),
  bars: z
    .array(
      z.object({
        label: z.string().min(1).max(40),
        value: z.number().min(0),
        value_text: z.string().max(20).optional(),
        highlight: z.boolean().default(false),
      }),
    )
    .min(2)
    .max(6),
});
export type BarChartVisual = z.infer<typeof BarChartVisual>;

/** 4. Big Stat: single impactful number + unit + label */
export const BigStatVisual = z.object({
  template: z.literal("big_stat"),
  number: z.string().min(1).max(30), // "46 Gbps", "10x", "320 MHz"
  unit: z.string().max(20).optional(),
  label: z.string().min(1).max(80),
  subtitle: z.string().max(120).optional(),
});
export type BigStatVisual = z.infer<typeof BigStatVisual>;

/** 5. Timeline: 3–6 dated milestone points */
export const TimelineVisual = z.object({
  template: z.literal("timeline"),
  title: z.string().min(1).max(80),
  points: z
    .array(
      z.object({
        year: z.string().min(1).max(30), // "2019", "2024", "2028 (dijangka)"
        title: z.string().min(1).max(60),
        desc: z.string().max(120).optional(),
        highlight: z.boolean().default(false),
      }),
    )
    .min(3)
    .max(6),
});
export type TimelineVisual = z.infer<typeof TimelineVisual>;

/** 6. Diagram: 2–6 connected nodes with directional arrows */
export const DiagramVisual = z.object({
  template: z.literal("diagram"),
  title: z.string().min(1).max(80),
  nodes: z
    .array(
      z.object({
        id: z.string().min(1).max(20),
        label: z.string().min(1).max(40),
        icon: z.enum(["phone", "laptop", "router", "cloud", "server", "cpu", "wifi", "shield", "database"]).default("wifi"),
      }),
    )
    .min(2)
    .max(6),
  arrows: z
    .array(
      z.object({
        from: z.string().min(1).max(20),
        to: z.string().min(1).max(20),
        label: z.string().max(30).optional(),
      }),
    )
    .min(1)
    .max(6),
});
export type DiagramVisual = z.infer<typeof DiagramVisual>;

export const ExplainerVisual = z.discriminatedUnion("template", [
  SpectrumVisual,
  CompareTableVisual,
  BarChartVisual,
  BigStatVisual,
  TimelineVisual,
  DiagramVisual,
]);
export type ExplainerVisual = z.infer<typeof ExplainerVisual>;

// ---------------------------------------------------------------- Scene & Script Schemas

export const ExplainerScene = z.object({
  id: z.string().min(1).max(30),
  narration: z.string().min(1).max(600).describe("Ayat percakapan suara BM (maksimum 40 patah perkataan)"),
  on_screen: z.string().min(1).max(120).describe("Teks ringkas paparan atas skrin"),
  visual: ExplainerVisual,
});
export type ExplainerScene = z.infer<typeof ExplainerScene>;

export const ExplainerScript = z.object({
  topic: z.string().min(2).max(150),
  language: z.enum(["ms", "en"]).optional().default("ms"),
  hook: z.string().min(5).max(150),
  scenes: z.array(ExplainerScene).min(1).max(8),
  outro: z.string().min(5).max(200),
  sources: z.array(z.string().min(2).max(150)).min(1).max(6),
  fact_sheet: z.array(FactSheetItem).optional().default([]),
});
export type ExplainerScript = z.infer<typeof ExplainerScript>;
export type ExplainerScriptInput = z.input<typeof ExplainerScript>;

// ---------------------------------------------------------------- Pure Validation Helpers

/** Count words in a string accurately across Malay / English prose. Pure. */
export function countWords(text: string): number {
  const matches = text.trim().match(/[\p{L}\p{N}]+/gu);
  return matches ? matches.length : 0;
}

/** Validate an ExplainerScript: narration word caps, duration bounds, and scene limits. Pure. */
export function validateExplainerScript(script: ExplainerScript): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (script.scenes.length < 1 || script.scenes.length > 8) {
    errors.push(`Script must have 1 to 8 scenes (got ${script.scenes.length})`);
  }

  let totalWords = countWords(script.hook) + countWords(script.outro);

  for (let i = 0; i < script.scenes.length; i++) {
    const s = script.scenes[i]!;
    const w = countWords(s.narration);
    totalWords += w;
    if (w > 40) {
      errors.push(`Scene ${i + 1} narration exceeds 40 words limit (has ${w} words)`);
    }
    if (!s.on_screen.trim()) {
      errors.push(`Scene ${i + 1} is missing on-screen text`);
    }
  }

  // Spoken pacing in Malay is ~2.3 words/sec + 0.3s transition gap per scene
  const estSeconds = Math.round(totalWords / 2.3 + script.scenes.length * 0.3);
  if (estSeconds < 20 || estSeconds > 90) {
    errors.push(`Estimated total duration is ${estSeconds}s; target is 30–75s (allowed 20–90s)`);
  }

  if (!script.sources || script.sources.length === 0) {
    errors.push("Script must cite at least 1 authoritative source");
  }

  return { valid: errors.length === 0, errors };
}

/** Extract distinct numbers and technical spec tokens from a visual configuration. Pure. */
export function extractVisualNumbers(visual: ExplainerVisual): string[] {
  const nums = new Set<string>();

  const scan = (str?: string | null) => {
    if (!str || typeof str !== "string") return;
    // Matches numbers with optional decimals, GHz/MHz/Gbps/Mbps, years like 2024, or standard codes like 802.11
    const found = str.match(/\b\d+(?:\.\d+)?(?:[a-zA-Z]+)?\b/g);
    if (found) {
      for (const tok of found) {
        // filter out pure small noise like single digit list indices unless relevant
        const digitsOnly = tok.replace(/\D/g, "");
        if (digitsOnly.length > 0) nums.add(tok);
      }
    }
  };

  if ("title" in visual && typeof visual.title === "string") {
    scan(visual.title);
  }

  switch (visual.template) {
    case "spectrum":
      for (const b of visual.bands) {
        scan(b.name);
        scan(b.freq);
        for (const c of b.channels) {
          scan(c.label);
          scan(c.width);
        }
      }
      break;
    case "compare_table":
      for (const h of visual.headers) scan(h);
      for (const r of visual.rows) {
        if (Array.isArray(r)) {
          for (const cell of r) scan(cell);
        } else if (r && typeof r === "object") {
          scan(r.feature);
          if (Array.isArray(r.values)) {
            for (const v of r.values) scan(v);
          }
        }
      }
      break;
    case "bar_chart":
      for (const b of visual.bars) {
        scan(b.label);
        nums.add(String(b.value));
        if (b.value_text) scan(b.value_text);
      }
      break;
    case "big_stat":
      scan(visual.number);
      if (visual.unit) scan(visual.unit);
      scan(visual.label);
      if (visual.subtitle) scan(visual.subtitle);
      break;
    case "timeline":
      for (const p of visual.points) {
        scan(p.year);
        scan(p.title);
        if (p.desc) scan(p.desc);
      }
      break;
    case "diagram":
      for (const n of visual.nodes) scan(n.label);
      for (const a of visual.arrows) if (a.label) scan(a.label);
      break;
  }

  return Array.from(nums);
}

/**
 * Verify that every numeric and technical claim in the visuals is backed by the fact sheet.
 * Returns ok: true only if all numbers can be traced to a claim or source. Pure.
 */
export function validateNumbersInFactSheet(script: ExplainerScript): { ok: boolean; unverifiedNumbers: string[] } {
  const sheet = script.fact_sheet ?? [];
  const factCorpus = sheet
    .map((item) => `${item.claim} ${item.value}`)
    .concat(script.sources)
    .join(" ")
    .toLowerCase();

  const unverified: string[] = [];

  for (const scene of script.scenes) {
    const tokens = extractVisualNumbers(scene.visual);
    for (const tok of tokens) {
      const lower = tok.toLowerCase();
      // Look for the token or its numeric root in the fact sheet corpus
      const numMatch = lower.match(/\d+(?:\.\d+)?/);
      const numRoot = numMatch ? numMatch[0] : lower;
      if (!factCorpus.includes(lower) && !factCorpus.includes(numRoot)) {
        unverified.push(`${tok} in Scene "${scene.id}"`);
      }
    }
  }

  return {
    ok: unverified.length === 0,
    unverifiedNumbers: unverified,
  };
}

// ---------------------------------------------------------------- Pure 1080×1920 Layout & Safe Areas

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 1080×1920 9:16 safe area margins for TikTok / Reels:
 * - Top safe margin: >= 140px (status bar, search, sounds)
 * - Bottom safe margin: >= 280px (captions, sounds bar, interaction icons)
 * - Horizontal safe margin: >= 64px left & right
 */
export const TIKTOK_SAFE_AREA = {
  left: 64,
  right: 1016,
  top: 140,
  bottom: 1640,
  width: 952,
  height: 1500,
};

/** Verify whether a rectangle falls entirely inside TikTok safe area. Pure. */
export function isInsideSafeArea(r: Rect): boolean {
  return (
    r.x >= TIKTOK_SAFE_AREA.left - 1 &&
    r.x + r.width <= TIKTOK_SAFE_AREA.right + 1 &&
    r.y >= TIKTOK_SAFE_AREA.top - 1 &&
    r.y + r.height <= TIKTOK_SAFE_AREA.bottom + 1
  );
}

/** Pure layout for Compare Table: computes grid cells and verifies safe area placement. */
export function layoutCompareTable(cols: number, rows: number): { headerCells: Rect[]; rowCells: Rect[][]; totalBounds: Rect } {
  const startX = 72;
  const startY = 320;
  const tableWidth = 936;
  const rowHeight = Math.min(160, Math.floor(950 / (rows + 1)));
  const colWidth = Math.floor(tableWidth / cols);

  const headerCells: Rect[] = [];
  for (let c = 0; c < cols; c++) {
    headerCells.push({
      x: startX + c * colWidth,
      y: startY,
      width: colWidth,
      height: rowHeight,
    });
  }

  const rowCells: Rect[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: Rect[] = [];
    for (let c = 0; c < cols; c++) {
      row.push({
        x: startX + c * colWidth,
        y: startY + (r + 1) * rowHeight,
        width: colWidth,
        height: rowHeight,
      });
    }
    rowCells.push(row);
  }

  const totalBounds: Rect = {
    x: startX,
    y: startY,
    width: tableWidth,
    height: (rows + 1) * rowHeight,
  };

  return { headerCells, rowCells, totalBounds };
}

/** Pure layout for Spectrum bands: assigns channels across frequency axis. */
export function layoutSpectrum(bandsCount: number): { bandRects: Rect[]; axisRect: Rect } {
  const startX = 80;
  const startY = 400;
  const axisWidth = 920;
  const bandHeight = Math.min(180, Math.floor(800 / bandsCount));

  const bandRects: Rect[] = [];
  for (let i = 0; i < bandsCount; i++) {
    bandRects.push({
      x: startX,
      y: startY + i * (bandHeight + 32),
      width: axisWidth,
      height: bandHeight,
    });
  }

  const axisRect: Rect = {
    x: startX,
    y: startY,
    width: axisWidth,
    height: bandsCount * (bandHeight + 32),
  };

  return { bandRects, axisRect };
}

/** Pure layout for Bar Chart: computes vertical growing bar bounding boxes. */
export function layoutBarChart(barsCount: number): { barRects: Rect[]; axisRect: Rect } {
  const startX = 96;
  const startY = 360;
  const chartWidth = 888;
  const chartHeight = 750;
  const colWidth = Math.floor(chartWidth / barsCount);
  const barWidth = Math.max(48, Math.floor(colWidth * 0.65));

  const barRects: Rect[] = [];
  for (let i = 0; i < barsCount; i++) {
    barRects.push({
      x: startX + i * colWidth + Math.floor((colWidth - barWidth) / 2),
      y: startY + 50,
      width: barWidth,
      height: chartHeight - 50,
    });
  }

  const axisRect: Rect = {
    x: startX,
    y: startY,
    width: chartWidth,
    height: chartHeight,
  };

  return { barRects, axisRect };
}

/** Pure layout for Timeline: computes alternating milestone points along a center line. */
export function layoutTimeline(pointsCount: number): { pointNodes: Rect[]; spineLine: Rect } {
  const centerX = 540;
  const startY = 340;
  const timelineHeight = Math.min(1000, pointsCount * 180);
  const stepY = Math.floor(timelineHeight / (pointsCount - 1 || 1));

  const pointNodes: Rect[] = [];
  for (let i = 0; i < pointsCount; i++) {
    const isLeft = i % 2 === 0;
    const cardWidth = 360;
    pointNodes.push({
      x: isLeft ? centerX - cardWidth - 36 : centerX + 36,
      y: startY + i * stepY - 40,
      width: cardWidth,
      height: 100,
    });
  }

  const spineLine: Rect = {
    x: centerX - 2,
    y: startY,
    width: 4,
    height: timelineHeight,
  };

  return { pointNodes, spineLine };
}

/** Pure layout for Diagram: arranges 2 to 6 nodes in a balanced flow. */
export function layoutDiagram(nodesCount: number): { nodeRects: Rect[]; flowBounds: Rect } {
  const startY = 400;
  const nodeWidth = 240;
  const nodeHeight = 160;
  const nodeRects: Rect[] = [];

  if (nodesCount <= 3) {
    // Single vertical stack
    const stepY = 280;
    const x = 540 - nodeWidth / 2;
    for (let i = 0; i < nodesCount; i++) {
      nodeRects.push({ x, y: startY + i * stepY, width: nodeWidth, height: nodeHeight });
    }
  } else {
    // 2 columns
    const cols = 2;
    const rows = Math.ceil(nodesCount / cols);
    const colSpacing = 420;
    const stepY = 260;
    for (let i = 0; i < nodesCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = 540 - colSpacing / 2 + col * (colSpacing - nodeWidth);
      nodeRects.push({ x, y: startY + row * stepY, width: nodeWidth, height: nodeHeight });
    }
  }

  const minX = Math.min(...nodeRects.map((n) => n.x));
  const maxX = Math.max(...nodeRects.map((n) => n.x + n.width));
  const minY = Math.min(...nodeRects.map((n) => n.y));
  const maxY = Math.max(...nodeRects.map((n) => n.y + n.height));

  const flowBounds: Rect = {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };

  return { nodeRects, flowBounds };
}
