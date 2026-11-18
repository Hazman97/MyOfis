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
  pasted: z.boolean().optional().default(false).describe("Set true only when the owner pasted an unverified script directly"),
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

/** Extract numbers (with optional technical unit) from prose or labels. Pure. */
export function extractTextNumbers(text?: string | null): string[] {
  if (!text || typeof text !== "string") return [];
  const found = text.match(/\b\d+(?:\.\d+)?(?:\s*(?:%|ghz|mhz|khz|gbps|mbps|kbps|ms|s|x|nm|mm|gb|mb|tb|kb)\b)?/gi);
  return found ? found.map((t) => t.trim()) : [];
}

/** Normalise a numeric/unit token (e.g. "6 GHz" / "6GHz" / "6.0" -> "6ghz" / "6"). Pure. */
export function normalizeFactToken(tok: string): string {
  return tok
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/\.0+(?=[a-z%]*$)/, "");
}

function factTokenVariants(tok: string): string[] {
  const norm = normalizeFactToken(tok);
  const numMatch = norm.match(/^\d+(?:\.\d+)?/);
  return numMatch && numMatch[0] !== norm ? [norm, numMatch[0]] : [norm];
}

/** Extract distinct numbers and technical spec tokens from a visual configuration. Pure. */
export function extractVisualNumbers(visual: ExplainerVisual): string[] {
  const nums = new Set<string>();

  const scan = (str?: string | null) => {
    for (const tok of extractTextNumbers(str)) nums.add(tok);
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
 * Verify that every numeric claim in visual, on_screen, and narration matches a `value`
 * in `fact_sheet` that has a `source_url`. Pasted owner scripts are allowed with `unverified: true`. Pure.
 */
export function validateNumbersInFactSheet(script: ExplainerScript): {
  ok: boolean;
  unverifiedNumbers: string[];
  unverified: boolean;
} {
  if (script.pasted) {
    return { ok: true, unverifiedNumbers: [], unverified: true };
  }

  const sheet = script.fact_sheet ?? [];
  const validItems = sheet.filter((item) => !!item.source_url && item.source_url.trim().length > 0);
  if (validItems.length === 0) {
    return {
      ok: false,
      unverifiedNumbers: ["fact_sheet is empty (cite official sources with source_url, or set pasted: true)"],
      unverified: false,
    };
  }

  const allowedExact = new Set<string>();
  const allowedNumeric = new Set<string>();
  for (const item of validItems) {
    for (const tok of extractTextNumbers(item.value)) {
      const variants = factTokenVariants(tok);
      allowedExact.add(variants[0]!);
      if (variants[1]) allowedNumeric.add(variants[1]);
      else allowedNumeric.add(variants[0]!);
    }
  }

  const unverified: string[] = [];

  for (const scene of script.scenes) {
    const sceneTokens = new Set<string>([
      ...extractVisualNumbers(scene.visual),
      ...extractTextNumbers(scene.on_screen),
      ...extractTextNumbers(scene.narration),
    ]);
    for (const tok of sceneTokens) {
      const [norm, numOnly] = factTokenVariants(tok);
      const matched = numOnly
        ? allowedExact.has(norm!) || allowedNumeric.has(norm!)
        : allowedExact.has(norm!) || allowedNumeric.has(norm!);
      if (!matched) {
        unverified.push(`${tok} in Scene "${scene.id}"`);
      }
    }
  }

  return {
    ok: unverified.length === 0,
    unverifiedNumbers: unverified,
    unverified: false,
  };
}

// ---------------------------------------------------------------- Pure 1080×1920 Layout & Safe Areas


