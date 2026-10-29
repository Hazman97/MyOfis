import { z } from "zod";
import type { TranscriptWord } from "./transcript.ts";

/**
 * Motion text / kinetic typography compositions rendered with HyperFrames (HTML/CSS/JS timeline → MP4).
 * Pure template builder: all user strings are HTML-escaped, no external network resources or web fonts
 * are referenced, and long Malay words / emoji wrap cleanly inside 1080 px viewports.
 */

export const MotionPresetId = z.enum(["tiktok_fhd", "square", "youtube_1080p"]);
export type MotionPresetId = z.infer<typeof MotionPresetId>;

export interface MotionPreset {
  label: string;
  width: number;
  height: number;
}

export const MOTION_PRESETS: Record<MotionPresetId, MotionPreset> = {
  tiktok_fhd: { label: "TikTok FHD 1080×1920 (9:16)", width: 1080, height: 1920 },
  square: { label: "Square 1080×1080 (1:1)", width: 1080, height: 1080 },
  youtube_1080p: { label: "YouTube 1920×1080 (16:9)", width: 1920, height: 1080 },
};

export const MotionPaletteId = z.enum([
  "cyber_yellow",
  "crimson_pop",
  "emerald_neon",
  "royal_blue",
  "clean_dark",
  "clean_light",
  "sunset_orange",
]);
export type MotionPaletteId = z.infer<typeof MotionPaletteId>;

export interface MotionPalette {
  bg: string;
  fg: string;
  accent: string;
  secondary: string;
  cardBg: string;
  muted: string;
}

export const MOTION_PALETTES: Record<MotionPaletteId, MotionPalette> = {
  cyber_yellow: {
    bg: "#0B0D13",
    fg: "#FFFFFF",
    accent: "#FFE600",
    secondary: "#00F0FF",
    cardBg: "rgba(20, 24, 36, 0.88)",
    muted: "#A0AEC0",
  },
  crimson_pop: {
    bg: "#12080C",
    fg: "#FFFFFF",
    accent: "#FF2E63",
    secondary: "#FF9F1C",
    cardBg: "rgba(32, 12, 20, 0.88)",
    muted: "#F4ACB7",
  },
  emerald_neon: {
    bg: "#071410",
    fg: "#FFFFFF",
    accent: "#10B981",
    secondary: "#A7F3D0",
    cardBg: "rgba(10, 32, 24, 0.88)",
    muted: "#94A3B8",
  },
  royal_blue: {
    bg: "#080F26",
    fg: "#FFFFFF",
    accent: "#38BDF8",
    secondary: "#818CF8",
    cardBg: "rgba(15, 23, 42, 0.88)",
    muted: "#94A3B8",
  },
  clean_dark: {
    bg: "#111827",
    fg: "#F9FAFB",
    accent: "#F59E0B",
    secondary: "#60A5FA",
    cardBg: "rgba(31, 41, 55, 0.90)",
    muted: "#9CA3AF",
  },
  clean_light: {
    bg: "#F8FAFC",
    fg: "#0F172A",
    accent: "#2563EB",
    secondary: "#EA580C",
    cardBg: "rgba(255, 255, 255, 0.92)",
    muted: "#475569",
  },
  sunset_orange: {
    bg: "#180B08",
    fg: "#FFFFFF",
    accent: "#FF6B35",
    secondary: "#FFD166",
    cardBg: "rgba(38, 18, 12, 0.88)",
    muted: "#CBD5E1",
  },
};

export const MotionFontId = z.enum(["noto_sans", "inter", "display_bold", "mono"]);
export type MotionFontId = z.infer<typeof MotionFontId>;

export const MOTION_FONTS: Record<MotionFontId, string> = {
  noto_sans: '"Noto Sans", "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji", sans-serif',
  inter: 'Inter, "Noto Sans", "Segoe UI", Roboto, system-ui, "Noto Color Emoji", "Segoe UI Emoji", sans-serif',
  display_bold: '"Noto Sans Display", "Noto Sans", Impact, "Arial Black", "Segoe UI", "Noto Color Emoji", "Segoe UI Emoji", sans-serif',
  mono: '"JetBrains Mono", "Noto Sans Mono", Consolas, monospace, "Noto Color Emoji", "Segoe UI Emoji"',
};

export const MotionTemplateId = z.enum([
  "hook",
  "kinetic_captions",
  "title_card",
  "list",
  "countdown",
  "lower_third",
  "outro_cta",
]);
export type MotionTemplateId = z.infer<typeof MotionTemplateId>;

export const MotionCommonParams = z.object({
  size: MotionPresetId.default("tiktok_fhd"),
  palette: MotionPaletteId.default("cyber_yellow"),
  font: MotionFontId.default("noto_sans"),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]).default(30),
  transparent: z.boolean().default(false),
  background_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  background_media: z
    .object({
      kind: z.enum(["video", "image"]),
      src: z.string().min(1).max(300),
    })
    .optional(),
});

export const HookTemplateParams = MotionCommonParams.extend({
  lines: z.array(z.string().trim().min(1).max(120)).min(1).max(3).optional(),
  text: z.string().trim().min(1).max(240).optional(),
  badge: z.string().trim().max(60).optional(),
  subtext: z.string().trim().max(140).optional(),
  duration: z.number().min(0.5).max(30).default(3),
}).refine((v) => (v.lines && v.lines.length > 0) || !!v.text, {
  message: "hook requires either `lines` (1–3 strings) or `text`",
});
export type HookTemplateParams = z.infer<typeof HookTemplateParams>;

export const KineticWordSchema = z.object({
  w: z.string().trim().min(1).max(80),
  s: z.number().min(0),
  e: z.number().min(0),
});

export const KineticCaptionsTemplateParams = MotionCommonParams.extend({
  words: z.array(KineticWordSchema).min(1).max(1000).optional(),
  text: z.string().trim().min(1).max(1000).optional(),
  words_per_group: z.number().int().min(1).max(6).default(3),
  position: z.enum(["bottom", "middle", "top"]).default("middle"),
  uppercase: z.boolean().default(true),
  duration: z.number().min(0.5).max(180).optional(),
}).refine((v) => (v.words && v.words.length > 0) || !!v.text, {
  message: "kinetic_captions requires either `words` (with start/end times) or `text`",
});
export type KineticCaptionsTemplateParams = z.infer<typeof KineticCaptionsTemplateParams>;

export const TitleCardTemplateParams = MotionCommonParams.extend({
  title: z.string().trim().min(1).max(140).optional(),
  text: z.string().trim().min(1).max(140).optional(),
  subtitle: z.string().trim().max(200).optional(),
  kicker: z.string().trim().max(80).optional(),
  duration: z.number().min(0.5).max(30).default(3.5),
}).refine((v) => !!v.title || !!v.text, {
  message: "title_card requires `title` (or `text`)",
});
export type TitleCardTemplateParams = z.infer<typeof TitleCardTemplateParams>;

export const ListTemplateParams = MotionCommonParams.extend({
  title: z.string().trim().max(120).optional(),
  items: z.array(z.string().trim().min(1).max(160)).min(3).max(7),
  numbered: z.boolean().default(true),
  duration: z.number().min(1).max(60).default(6),
});
export type ListTemplateParams = z.infer<typeof ListTemplateParams>;

export const CountdownTemplateParams = MotionCommonParams.extend({
  from: z.number().int().min(3).max(10).default(3),
  label: z.string().trim().max(120).optional(),
  final_text: z.string().trim().max(120).default("JOM! 🔥"),
  duration: z.number().min(1).max(30).optional(),
});
export type CountdownTemplateParams = z.infer<typeof CountdownTemplateParams>;

export const LowerThirdTemplateParams = MotionCommonParams.extend({
  name: z.string().trim().min(1).max(100).optional(),
  text: z.string().trim().min(1).max(100).optional(),
  role: z.string().trim().max(120).optional(),
  align: z.enum(["left", "right"]).default("left"),
  duration: z.number().min(1).max(30).default(4),
}).refine((v) => !!v.name || !!v.text, {
  message: "lower_third requires `name` (or `text`)",
});
export type LowerThirdTemplateParams = z.infer<typeof LowerThirdTemplateParams>;

export const OutroCtaTemplateParams = MotionCommonParams.extend({
  headline: z.string().trim().min(1).max(140).optional(),
  text: z.string().trim().min(1).max(140).optional(),
  handle: z.string().trim().max(80).optional(),
  action: z.string().trim().max(80).default("Follow & Share 🔔"),
  duration: z.number().min(1).max(30).default(4),
}).refine((v) => !!v.headline || !!v.text, {
  message: "outro_cta requires `headline` (or `text`)",
});
export type OutroCtaTemplateParams = z.infer<typeof OutroCtaTemplateParams>;

/** Escape any user string before embedding in HTML text or attribute contexts. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Split a single hook text into 1–3 balanced lines so long Malay phrases never overflow horizontally. */
export function splitHookLines(text: string): string[] {
  const explicit = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (explicit.length >= 2) return explicit.slice(0, 3);
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 3) return [words.join(" ")];
  if (words.length <= 6) {
    const mid = Math.ceil(words.length / 2);
    return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
  }
  const third = Math.ceil(words.length / 3);
  return [
    words.slice(0, third).join(" "),
    words.slice(third, third * 2).join(" "),
    words.slice(third * 2).join(" "),
  ];
}

export interface KineticGroup {
  start: number;
  end: number;
  words: { w: string; s: number; e: number }[];
}

/**
 * Group timed words into short multi-word groups (like subtitleCues / packTranscript) while preserving
 * exact per-word start/end times so the active spoken word is highlighted frame by frame.
 */
export function buildKineticGroups(
  words: TranscriptWord[],
  wordsPerGroup = 3,
  uppercase = true,
): KineticGroup[] {
  const clean = words
    .map((w) => ({
      w: (uppercase ? w.w.toUpperCase() : w.w).trim(),
      s: Math.max(0, Number(w.s) || 0),
      e: Math.max(Number(w.s) || 0, Number(w.e) || 0),
    }))
    .filter((w) => w.w.length > 0);
  if (!clean.length) return [];

  const groups: KineticGroup[] = [];
  let bucket: { w: string; s: number; e: number }[] = [];

  const flush = () => {
    if (!bucket.length) return;
    const start = bucket[0]!.s;
    const lastEnd = bucket[bucket.length - 1]!.e;
    groups.push({
      start: Math.round(start * 100) / 100,
      end: Math.round(Math.max(lastEnd, start + 0.25) * 100) / 100,
      words: bucket.map((item, idx) => {
        const nextStart = bucket[idx + 1]?.s;
        const wordEnd = item.e > item.s ? item.e : nextStart && nextStart > item.s ? nextStart : item.s + 0.25;
        return {
          w: item.w,
          s: Math.round(item.s * 100) / 100,
          e: Math.round(wordEnd * 100) / 100,
        };
      }),
    });
    bucket = [];
  };

  for (const w of clean) {
    const prev = bucket[bucket.length - 1];
    const pauseBefore = prev ? w.s - prev.e >= 0.45 : false;
    if (pauseBefore) flush();
    bucket.push(w);
    const endsSentence = /[.!?]$/.test(w.w);
    if (bucket.length >= wordsPerGroup || endsSentence) flush();
  }
  flush();

  for (let i = 0; i < groups.length - 1; i++) {
    if (groups[i]!.end > groups[i + 1]!.start) {
      groups[i]!.end = groups[i + 1]!.start;
    }
  }
  return groups;
}

/** Synthesize word timings when the caller provides plain text instead of a Whisper transcript. */
export function wordsFromPlainText(text: string, duration: number): TranscriptWord[] {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  const step = Math.max(0.15, duration / parts.length);
  return parts.map((w, i) => ({
    w,
    s: Math.round(i * step * 100) / 100,
    e: Math.round(Math.min(duration, (i + 1) * step) * 100) / 100,
  }));
}

export interface BuiltComposition {
  html: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  template: MotionTemplateId;
  transparent: boolean;
}

/** Validate and normalize template parameters for a given template id. */
export function parseTemplateParams(template: MotionTemplateId, raw: unknown) {
  switch (template) {
    case "hook":
      return HookTemplateParams.parse(raw);
    case "kinetic_captions":
      return KineticCaptionsTemplateParams.parse(raw);
    case "title_card":
      return TitleCardTemplateParams.parse(raw);
    case "list":
      return ListTemplateParams.parse(raw);
    case "countdown":
      return CountdownTemplateParams.parse(raw);
    case "lower_third":
      return LowerThirdTemplateParams.parse(raw);
    case "outro_cta":
      return OutroCtaTemplateParams.parse(raw);
  }
}

/**
 * Pure builder: returns a complete, self-contained HyperFrames HTML composition (`data-composition-id="main"`,
 * `window.__timelines["main"]`) with all user text HTML-escaped and strict offline Content-Security-Policy.
 */
export function buildComposition(template: MotionTemplateId, rawParams: unknown): BuiltComposition {
  const parsed = parseTemplateParams(template, rawParams);
  const preset = MOTION_PRESETS[parsed.size];
  const palette = MOTION_PALETTES[parsed.palette];
  const fontStack = MOTION_FONTS[parsed.font];
  const { width, height } = preset;
  const fps = parsed.fps;
  const transparent = parsed.transparent;
  const bgColor = transparent ? "transparent" : (parsed.background_color ?? palette.bg);
  const minDim = Math.min(width, height);

  let duration = 3;
  let bodyMarkup = "";
  let stepScript = "";

  if (template === "hook") {
    const p = parsed as HookTemplateParams;
    duration = p.duration;
    const lines = p.lines && p.lines.length ? p.lines : splitHookLines(p.text ?? "");
    const fontSize = Math.round(minDim * (lines.length === 1 ? 0.092 : lines.length === 2 ? 0.08 : 0.068));
    const badgeHtml = p.badge
      ? `<div class="hook-badge" id="hook-badge">${escapeHtml(p.badge)}</div>`
      : "";
    const linesHtml = lines
      .map(
        (line, i) =>
          `<div class="hook-line ${i === lines.length - 1 ? "hook-line-accent" : ""}" id="hook-line-${i}" data-line-index="${i}">${escapeHtml(line)}</div>`,
      )
      .join("\n");
    const subHtml = p.subtext
      ? `<div class="hook-subtext" id="hook-subtext">${escapeHtml(p.subtext)}</div>`
      : "";

    bodyMarkup = `
      <div class="stage-center">
        ${badgeHtml}
        <div class="hook-stack">
          ${linesHtml}
        </div>
        ${subHtml}
      </div>
    `;
    stepScript = `
      const lineCount = ${lines.length};
      const dur = ${duration};
      const fadeOutStart = Math.max(0.4, dur - 0.35);
      const fadeOut = t > fadeOutStart ? Math.max(0, 1 - (t - fadeOutStart) / 0.35) : 1;
      const badgeEl = document.getElementById("hook-badge");
      if (badgeEl) {
        const bp = clamp((t - 0.05) / 0.25, 0, 1);
        const bs = backOut(bp);
        badgeEl.style.opacity = String(bp * fadeOut);
        badgeEl.style.transform = "translateY(" + ((1 - bs) * 28) + "px) scale(" + (0.7 + 0.3 * bs) + ")";
      }
      for (let i = 0; i < lineCount; i++) {
        const el = document.getElementById("hook-line-" + i);
        if (!el) continue;
        const start = 0.08 + i * 0.14;
        const p = clamp((t - start) / 0.28, 0, 1);
        const s = backOut(p);
        el.style.opacity = String(p * fadeOut);
        el.style.transform = "translateY(" + ((1 - s) * 42) + "px) scale(" + (0.72 + 0.28 * s) + ")";
      }
      const subEl = document.getElementById("hook-subtext");
      if (subEl) {
        const sp = clamp((t - (0.18 + lineCount * 0.14)) / 0.28, 0, 1);
        subEl.style.opacity = String(sp * fadeOut);
        subEl.style.transform = "translateY(" + ((1 - sp) * 20) + "px)";
      }
    `;
    bodyMarkup = `<style>.hook-line { font-size: ${fontSize}px; }</style>` + bodyMarkup;
  } else if (template === "kinetic_captions") {
    const p = parsed as KineticCaptionsTemplateParams;
    const rawWords =
      p.words && p.words.length
        ? p.words
        : wordsFromPlainText(p.text ?? "", p.duration ?? 4);
    const maxWordEnd = rawWords.reduce((m, w) => Math.max(m, w.e), 0);
    duration = p.duration ?? Math.max(1, Math.round((maxWordEnd + 0.3) * 100) / 100);
    const groups = buildKineticGroups(rawWords, p.words_per_group, p.uppercase);
    const fontSize = Math.round(minDim * 0.072);
    const posClass = `pos-${p.position}`;
    const groupsHtml = groups
      .map((g, gi) => {
        const wordsHtml = g.words
          .map(
            (w, wi) =>
              `<span class="kc-word" id="kc-g${gi}-w${wi}" data-ws="${w.s}" data-we="${w.e}">${escapeHtml(w.w)}</span>`,
          )
          .join(" ");
        return `<div class="kc-group ${posClass}" id="kc-g${gi}" data-gs="${g.start}" data-ge="${g.end}">${wordsHtml}</div>`;
      })
      .join("\n");

    bodyMarkup = `
      <style>.kc-group { font-size: ${fontSize}px; }</style>
      <div class="kc-layer">
        ${groupsHtml}
      </div>
    `;
    stepScript = `
      const groups = document.querySelectorAll(".kc-group");
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        const gs = Number(g.getAttribute("data-gs") || 0);
        const ge = Number(g.getAttribute("data-ge") || 0);
        if (t >= gs && t <= ge) {
          const entryP = clamp((t - gs) / 0.14, 0, 1);
          const scale = 0.86 + 0.14 * backOut(entryP);
          g.style.opacity = "1";
          g.style.transform = "translate(-50%, -50%) scale(" + scale + ")";
          const words = g.querySelectorAll(".kc-word");
          for (let j = 0; j < words.length; j++) {
            const w = words[j];
            const ws = Number(w.getAttribute("data-ws") || 0);
            const we = Number(w.getAttribute("data-we") || 0);
            const active = t >= ws && t <= we;
            const spoken = t > we;
            if (active) {
              w.classList.add("kc-active");
              w.classList.remove("kc-spoken");
            } else {
              w.classList.remove("kc-active");
              if (spoken) w.classList.add("kc-spoken");
              else w.classList.remove("kc-spoken");
            }
          }
        } else {
          g.style.opacity = "0";
          g.style.transform = "translate(-50%, -50%) scale(0.86)";
        }
      }
    `;
  } else if (template === "title_card") {
    const p = parsed as TitleCardTemplateParams;
    duration = p.duration;
    const titleText = p.title ?? p.text ?? "";
    const titleSize = Math.round(minDim * 0.082);
    const kickerHtml = p.kicker
      ? `<div class="tc-kicker" id="tc-kicker">${escapeHtml(p.kicker)}</div>`
      : "";
    const subHtml = p.subtitle
      ? `<div class="tc-subtitle" id="tc-subtitle">${escapeHtml(p.subtitle)}</div>`
      : "";
    bodyMarkup = `
      <style>.tc-title { font-size: ${titleSize}px; }</style>
      <div class="stage-center">
        <div class="tc-card" id="tc-card">
          ${kickerHtml}
          <div class="tc-title" id="tc-title">${escapeHtml(titleText)}</div>
          <div class="tc-bar" id="tc-bar"></div>
          ${subHtml}
        </div>
      </div>
    `;
    stepScript = `
      const dur = ${duration};
      const fadeOut = t > dur - 0.35 ? clamp((dur - t) / 0.35, 0, 1) : 1;
      const card = document.getElementById("tc-card");
      if (card) {
        const p = clamp(t / 0.32, 0, 1);
        const s = backOut(p);
        card.style.opacity = String(p * fadeOut);
        card.style.transform = "translateY(" + ((1 - s) * 36) + "px) scale(" + (0.88 + 0.12 * s) + ")";
      }
      const bar = document.getElementById("tc-bar");
      if (bar) {
        const bp = clamp((t - 0.18) / 0.35, 0, 1);
        bar.style.transform = "scaleX(" + easeOutCubic(bp) + ")";
      }
      const sub = document.getElementById("tc-subtitle");
      if (sub) {
        const sp = clamp((t - 0.25) / 0.3, 0, 1);
        sub.style.opacity = String(sp * fadeOut);
        sub.style.transform = "translateY(" + ((1 - sp) * 18) + "px)";
      }
    `;
  } else if (template === "list") {
    const p = parsed as ListTemplateParams;
    duration = p.duration;
    const count = p.items.length;
    const itemSize = Math.round(minDim * (count >= 6 ? 0.044 : 0.052));
    const titleHtml = p.title
      ? `<div class="list-header" id="list-header">${escapeHtml(p.title)}</div>`
      : "";
    const itemsHtml = p.items
      .map(
        (item, i) => `
          <div class="list-item" id="list-item-${i}">
            <span class="list-badge">${p.numbered ? `${i + 1}` : "✓"}</span>
            <span class="list-text">${escapeHtml(item)}</span>
          </div>
        `,
      )
      .join("\n");
    bodyMarkup = `
      <style>.list-item { font-size: ${itemSize}px; }</style>
      <div class="stage-center">
        <div class="list-container">
          ${titleHtml}
          <div class="list-stack">
            ${itemsHtml}
          </div>
        </div>
      </div>
    `;
    stepScript = `
      const dur = ${duration};
      const count = ${count};
      const fadeOut = t > dur - 0.35 ? clamp((dur - t) / 0.35, 0, 1) : 1;
      const hdr = document.getElementById("list-header");
      if (hdr) {
        const hp = clamp(t / 0.28, 0, 1);
        hdr.style.opacity = String(hp * fadeOut);
        hdr.style.transform = "translateY(" + ((1 - easeOutCubic(hp)) * 24) + "px)";
      }
      const avail = Math.max(0.8, dur - 0.9);
      const step = avail / Math.max(1, count);
      for (let i = 0; i < count; i++) {
        const el = document.getElementById("list-item-" + i);
        if (!el) continue;
        const start = 0.2 + i * Math.min(0.65, step);
        const ip = clamp((t - start) / 0.28, 0, 1);
        const s = backOut(ip);
        el.style.opacity = String(ip * fadeOut);
        el.style.transform = "translateX(" + ((1 - s) * -48) + "px) scale(" + (0.9 + 0.1 * s) + ")";
      }
    `;
  } else if (template === "countdown") {
    const p = parsed as CountdownTemplateParams;
    const from = p.from;
    duration = p.duration ?? from + 1;
    const numSize = Math.round(minDim * 0.24);
    const labelHtml = p.label
      ? `<div class="cd-label" id="cd-label">${escapeHtml(p.label)}</div>`
      : "";
    const stepsHtml = Array.from({ length: from }, (_, idx) => {
      const val = from - idx;
      return `<div class="cd-num" id="cd-step-${idx}">${val}</div>`;
    }).join("\n");
    const finalHtml = `<div class="cd-final" id="cd-final">${escapeHtml(p.final_text)}</div>`;
    bodyMarkup = `
      <style>.cd-num { font-size: ${numSize}px; } .cd-final { font-size: ${Math.round(minDim * 0.11)}px; }</style>
      <div class="stage-center">
        ${labelHtml}
        <div class="cd-stage">
          ${stepsHtml}
          ${finalHtml}
        </div>
      </div>
    `;
    stepScript = `
      const from = ${from};
      const dur = ${duration};
      const stepDur = dur / (from + 1);
      for (let i = 0; i < from; i++) {
        const el = document.getElementById("cd-step-" + i);
        if (!el) continue;
        const s = i * stepDur;
        const e = (i + 1) * stepDur;
        if (t >= s && t < e) {
          const local = (t - s) / Math.max(0.01, stepDur);
          const pop = backOut(clamp(local / 0.35, 0, 1));
          const fade = local > 0.75 ? clamp((1 - local) / 0.25, 0, 1) : 1;
          el.style.opacity = String(clamp(local / 0.15, 0, 1) * fade);
          el.style.transform = "translate(-50%, -50%) scale(" + (0.55 + 0.45 * pop) + ")";
        } else {
          el.style.opacity = "0";
        }
      }
      const finalEl = document.getElementById("cd-final");
      if (finalEl) {
        const fs = from * stepDur;
        if (t >= fs) {
          const local = (t - fs) / Math.max(0.01, dur - fs);
          const pop = backOut(clamp(local / 0.3, 0, 1));
          finalEl.style.opacity = String(clamp(local / 0.15, 0, 1));
          finalEl.style.transform = "translate(-50%, -50%) scale(" + (0.65 + 0.35 * pop) + ")";
        } else {
          finalEl.style.opacity = "0";
        }
      }
    `;
  } else if (template === "lower_third") {
    const p = parsed as LowerThirdTemplateParams;
    duration = p.duration;
    const nameText = p.name ?? p.text ?? "";
    const roleHtml = p.role
      ? `<div class="lt-role" id="lt-role">${escapeHtml(p.role)}</div>`
      : "";
    const alignClass = p.align === "right" ? "lt-right" : "lt-left";
    bodyMarkup = `
      <div class="lt-wrapper ${alignClass}" id="lt-box">
        <div class="lt-accent-bar"></div>
        <div class="lt-content">
          <div class="lt-name">${escapeHtml(nameText)}</div>
          ${roleHtml}
        </div>
      </div>
    `;
    stepScript = `
      const dur = ${duration};
      const inP = easeOutCubic(clamp(t / 0.35, 0, 1));
      const outP = t > dur - 0.35 ? easeOutCubic(clamp((dur - t) / 0.35, 0, 1)) : 1;
      const p = Math.min(inP, outP);
      const box = document.getElementById("lt-box");
      if (box) {
        const dir = ${p.align === "right" ? "1" : "-1"};
        box.style.opacity = String(p);
        box.style.transform = "translateX(" + ((1 - p) * 80 * dir) + "px)";
      }
    `;
  } else if (template === "outro_cta") {
    const p = parsed as OutroCtaTemplateParams;
    duration = p.duration;
    const headlineText = p.headline ?? p.text ?? "";
    const handleHtml = p.handle
      ? `<div class="cta-handle" id="cta-handle">${escapeHtml(p.handle)}</div>`
      : "";
    bodyMarkup = `
      <div class="stage-center">
        <div class="cta-card" id="cta-card">
          <div class="cta-headline">${escapeHtml(headlineText)}</div>
          ${handleHtml}
          <div class="cta-button" id="cta-button">${escapeHtml(p.action)}</div>
        </div>
      </div>
    `;
    stepScript = `
      const dur = ${duration};
      const inP = backOut(clamp(t / 0.35, 0, 1));
      const card = document.getElementById("cta-card");
      if (card) {
        card.style.opacity = String(clamp(t / 0.2, 0, 1));
        card.style.transform = "scale(" + (0.82 + 0.18 * inP) + ")";
      }
      const btn = document.getElementById("cta-button");
      if (btn) {
        const bp = backOut(clamp((t - 0.22) / 0.3, 0, 1));
        const pulse = t > 0.55 ? 1 + 0.04 * Math.sin((t - 0.55) * 8) : 0.7 + 0.3 * bp;
        btn.style.opacity = String(clamp((t - 0.22) / 0.2, 0, 1));
        btn.style.transform = "scale(" + pulse + ")";
      }
    `;
  }

  const bgMediaHtml = parsed.background_media
    ? parsed.background_media.kind === "video"
      ? `<video class="bg-media" id="bg-video" src="${escapeHtml(parsed.background_media.src)}" muted playsinline preload="auto"></video>`
      : `<img class="bg-media" id="bg-image" src="${escapeHtml(parsed.background_media.src)}" alt="" />`
    : "";

  const html = `<!DOCTYPE html>
<html lang="ms">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: file: blob:; media-src data: file: blob:; font-src data: local:;" />
  <meta name="viewport" content="width=${width}, height=${height}, initial-scale=1" />
  <title>MyOfis Motion — ${template}</title>
  <style>
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    html, body {
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
      background: ${bgColor};
      color: ${palette.fg};
      font-family: ${fontStack};
      -webkit-font-smoothing: antialiased;
    }
    #main-composition {
      position: relative;
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
      background: ${bgColor};
    }
    .bg-media {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      z-index: 0;
    }
    .stage-center {
      position: relative;
      z-index: 2;
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: ${Math.round(height * 0.08)}px ${Math.round(width * 0.08)}px;
      text-align: center;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    /* Hook */
    .hook-badge {
      display: inline-block;
      background: ${palette.accent};
      color: #0B0D13;
      font-weight: 900;
      font-size: ${Math.round(minDim * 0.036)}px;
      padding: 10px 28px;
      border-radius: 999px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 28px;
      box-shadow: 0 10px 28px rgba(0,0,0,0.45);
    }
    .hook-stack {
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-width: ${Math.round(width * 0.86)}px;
    }
    .hook-line {
      font-weight: 900;
      line-height: 1.12;
      color: ${palette.fg};
      text-shadow: 0 6px 0 #000000, 0 12px 28px rgba(0,0,0,0.75);
      -webkit-text-stroke: 3px #000000;
      paint-order: stroke fill;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .hook-line-accent {
      color: ${palette.accent};
    }
    .hook-subtext {
      margin-top: 28px;
      font-size: ${Math.round(minDim * 0.04)}px;
      font-weight: 700;
      color: ${palette.fg};
      background: ${palette.cardBg};
      padding: 14px 28px;
      border-radius: 18px;
      max-width: ${Math.round(width * 0.84)}px;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    /* Kinetic captions */
    .kc-layer {
      position: relative;
      z-index: 2;
      width: 100%;
      height: 100%;
    }
    .kc-group {
      position: absolute;
      left: 50%;
      width: ${Math.round(width * 0.86)}px;
      text-align: center;
      font-weight: 900;
      line-height: 1.22;
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 14px 18px;
      opacity: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .kc-group.pos-middle { top: 50%; }
    .kc-group.pos-bottom { top: 76%; }
    .kc-group.pos-top { top: 22%; }
    .kc-word {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 14px;
      color: ${palette.fg};
      text-shadow: 0 5px 0 #000000, 0 8px 22px rgba(0,0,0,0.8);
      -webkit-text-stroke: 2.5px #000000;
      paint-order: stroke fill;
      transition: none;
      max-width: 100%;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .kc-word.kc-active {
      background: ${palette.accent};
      color: #0B0D13;
      -webkit-text-stroke: 0px transparent;
      text-shadow: none;
      transform: scale(1.12);
      box-shadow: 0 10px 26px rgba(0,0,0,0.5);
    }
    .kc-word.kc-spoken {
      color: ${palette.secondary};
    }
    /* Title card */
    .tc-card {
      background: ${palette.cardBg};
      border: 3px solid ${palette.accent};
      border-radius: 36px;
      padding: 56px 48px;
      max-width: ${Math.round(width * 0.86)}px;
      width: 100%;
      box-shadow: 0 24px 60px rgba(0,0,0,0.55);
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .tc-kicker {
      font-size: ${Math.round(minDim * 0.034)}px;
      font-weight: 800;
      color: ${palette.accent};
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 18px;
    }
    .tc-title {
      font-weight: 900;
      line-height: 1.15;
      color: ${palette.fg};
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .tc-bar {
      width: 140px;
      height: 8px;
      background: ${palette.accent};
      border-radius: 999px;
      margin: 28px auto;
      transform-origin: center;
    }
    .tc-subtitle {
      font-size: ${Math.round(minDim * 0.042)}px;
      font-weight: 600;
      color: ${palette.muted};
      line-height: 1.35;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    /* List */
    .list-container {
      width: 100%;
      max-width: ${Math.round(width * 0.86)}px;
      display: flex;
      flex-direction: column;
      gap: 28px;
    }
    .list-header {
      font-size: ${Math.round(minDim * 0.068)}px;
      font-weight: 900;
      color: ${palette.accent};
      text-shadow: 0 4px 16px rgba(0,0,0,0.65);
      margin-bottom: 12px;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .list-stack {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .list-item {
      display: flex;
      align-items: center;
      gap: 24px;
      background: ${palette.cardBg};
      border-left: 8px solid ${palette.accent};
      padding: 22px 28px;
      border-radius: 22px;
      text-align: left;
      font-weight: 800;
      box-shadow: 0 12px 32px rgba(0,0,0,0.45);
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .list-badge {
      flex-shrink: 0;
      width: 58px;
      height: 58px;
      border-radius: 16px;
      background: ${palette.accent};
      color: #0B0D13;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-weight: 900;
    }
    .list-text {
      flex: 1;
      min-width: 0;
      line-height: 1.25;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    /* Countdown */
    .cd-label {
      font-size: ${Math.round(minDim * 0.056)}px;
      font-weight: 800;
      color: ${palette.muted};
      margin-bottom: 40px;
      max-width: ${Math.round(width * 0.84)}px;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .cd-stage {
      position: relative;
      width: ${Math.round(minDim * 0.5)}px;
      height: ${Math.round(minDim * 0.5)}px;
    }
    .cd-num, .cd-final {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-weight: 900;
      color: ${palette.accent};
      text-shadow: 0 8px 0 #000000, 0 16px 40px rgba(0,0,0,0.8);
      -webkit-text-stroke: 4px #000000;
      paint-order: stroke fill;
      white-space: nowrap;
      opacity: 0;
    }
    /* Lower third */
    .lt-wrapper {
      position: absolute;
      z-index: 2;
      bottom: ${Math.round(height * 0.16)}px;
      display: flex;
      align-items: stretch;
      background: ${palette.cardBg};
      border-radius: 20px;
      overflow: hidden;
      max-width: ${Math.round(width * 0.82)}px;
      box-shadow: 0 16px 40px rgba(0,0,0,0.55);
    }
    .lt-left { left: ${Math.round(width * 0.07)}px; }
    .lt-right { right: ${Math.round(width * 0.07)}px; flex-direction: row-reverse; text-align: right; }
    .lt-accent-bar {
      width: 14px;
      background: ${palette.accent};
      flex-shrink: 0;
    }
    .lt-content {
      padding: 22px 32px;
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .lt-name {
      font-size: ${Math.round(minDim * 0.05)}px;
      font-weight: 900;
      color: ${palette.fg};
      line-height: 1.15;
    }
    .lt-role {
      font-size: ${Math.round(minDim * 0.036)}px;
      font-weight: 700;
      color: ${palette.accent};
      margin-top: 6px;
    }
    /* Outro CTA */
    .cta-card {
      background: ${palette.cardBg};
      border: 3px solid ${palette.accent};
      border-radius: 40px;
      padding: 60px 48px;
      max-width: ${Math.round(width * 0.86)}px;
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 28px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.65);
    }
    .cta-headline {
      font-size: ${Math.round(minDim * 0.072)}px;
      font-weight: 900;
      line-height: 1.18;
      color: ${palette.fg};
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .cta-handle {
      font-size: ${Math.round(minDim * 0.046)}px;
      font-weight: 800;
      color: ${palette.secondary};
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .cta-button {
      background: ${palette.accent};
      color: #0B0D13;
      font-size: ${Math.round(minDim * 0.048)}px;
      font-weight: 900;
      padding: 20px 44px;
      border-radius: 999px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.5);
      overflow-wrap: anywhere;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <div
    id="main-composition"
    data-composition-id="main"
    data-start="0"
    data-duration="${duration}"
    data-width="${width}"
    data-height="${height}"
    data-fps="${fps}"
    data-track-index="0"
  >
    ${bgMediaHtml}
    ${bodyMarkup}
  </div>
  <script>
    (function() {
      const DURATION = ${duration};
      function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
      function easeOutCubic(x) { return 1 - Math.pow(1 - clamp(x, 0, 1), 3); }
      function backOut(x) {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        const p = clamp(x, 0, 1) - 1;
        return 1 + c3 * Math.pow(p, 3) + c1 * Math.pow(p, 2);
      }

      let currentTime = 0;
      let paused = false;

      function renderAt(t) {
        currentTime = clamp(Number(t) || 0, 0, DURATION);
        const bgVideo = document.getElementById("bg-video");
        if (bgVideo && Math.abs((bgVideo.currentTime || 0) - currentTime) > 0.04) {
          try { bgVideo.currentTime = currentTime; } catch (_) {}
        }
        ${stepScript}
      }

      const timeline = {
        duration: function() { return DURATION; },
        totalDuration: function() { return DURATION; },
        time: function(t) {
          if (typeof t === "number") { renderAt(t); return timeline; }
          return currentTime;
        },
        totalTime: function(t) {
          if (typeof t === "number") { renderAt(t); return timeline; }
          return currentTime;
        },
        seek: function(t) { renderAt(t); return timeline; },
        progress: function(p) {
          if (typeof p === "number") { renderAt(p * DURATION); return timeline; }
          return DURATION > 0 ? currentTime / DURATION : 0;
        },
        totalProgress: function(p) {
          if (typeof p === "number") { renderAt(p * DURATION); return timeline; }
          return DURATION > 0 ? currentTime / DURATION : 0;
        },
        pause: function() { paused = true; return timeline; },
        play: function() { paused = false; return timeline; },
        kill: function() { paused = true; }
      };

      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = timeline;
      renderAt(0);
    })();
  </script>
</body>
</html>`;

  return {
    html,
    width,
    height,
    fps,
    duration,
    template,
    transparent,
  };
}

