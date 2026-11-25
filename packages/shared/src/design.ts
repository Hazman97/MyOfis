import { z } from "zod";
import { BRAND_FONTS, BrandKit, DEFAULT_BRAND_KIT, contrastRatio } from "./marketing.ts";
import { escapeHtml } from "./motion.ts";

export const DesignTemplateId = z.enum([
  "quote",
  "tip_carousel",
  "list_top",
  "before_after",
  "promo",
  "announcement",
  "testimonial",
  "story_frame",
  "highlight_cover",
]);
export type DesignTemplateId = z.infer<typeof DesignTemplateId>;

export const DesignSizeId = z.enum(["post_4x5", "square", "story"]);
export type DesignSizeId = z.infer<typeof DesignSizeId>;

export const DESIGN_SIZES: Record<DesignSizeId, { width: number; height: number; label: string }> = {
  post_4x5: { width: 1080, height: 1350, label: "Post 4:5 (1080×1350)" },
  square: { width: 1080, height: 1080, label: "Square (1080×1080)" },
  story: { width: 1080, height: 1920, label: "Story (1080×1920)" },
};

/** 40 clean 24×24 stroke SVG icon paths (Lucide ISC style, see assets/icons/LICENSE). */
export const DESIGN_ICONS: Record<string, string> = {
  shop: '<path d="M3 9l1.5-5h15L21 9"/><path d="M3 9v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9"/><path d="M9 21v-6h6v6"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  play: '<polygon points="6 4 20 12 6 20 6 4"/>',
  quote: '<path d="M10 11H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6a4 4 0 0 1-4 4"/><path d="M20 11h-4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6a4 4 0 0 1-4 4"/>',
  price: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  location: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  gift: '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
  faq: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  review: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  sparkles: '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3z"/>',
  fire: '<path d="M12 2c2 3 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.2-4.5 2.5-6 .5 1.8 1.5 2.5 2.5 2.5 0-2.5-.8-4.5 0-6.5z"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22 6 12 13 2 6"/>',
  map: '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>',
  bag: '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  trophy: '<path d="M6 9H4a2 2 0 0 1-2-2V5h4"/><path d="M18 9h2a2 2 0 0 0 2-2V5h-4"/><path d="M6 4h12v7a6 6 0 0 1-12 0V4z"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="8" y1="21" x2="16" y2="21"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  coffee: '<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>',
  utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>',
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  car: '<path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/><circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
  plane: '<path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  award: '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
  message: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
};

export const DESIGN_ICON_NAMES = Object.keys(DESIGN_ICONS);

/** Allow only safe inline data:image/* URLs (blocks http:, https:, javascript:, etc.). */
function safeDataUrl(u?: string | null): string | null {
  if (!u || typeof u !== "string") return null;
  return /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(u) ? u : null;
}

/** Pick white or dark ink on a hex background using WCAG contrastRatio (≥ 4.5:1). */
function readableInk(bgHex: string, darkFallback = "#0F172A"): string {
  const w = contrastRatio("#FFFFFF", bgHex);
  const d = contrastRatio(darkFallback, bgHex);
  return w >= d ? "#FFFFFF" : darkFallback;
}

/** Pick a dark brand overlay base (secondary or #0F172A) that guarantees ≥ 4.5:1 contrast with white text. */
function photoOverlayBase(c: BrandKit["colors"]): string {
  if (contrastRatio("#FFFFFF", c.secondary) >= 4.5) return c.secondary;
  if (contrastRatio("#FFFFFF", c.primary) >= 4.5) return c.primary;
  return "#0F172A";
}

/** Estimate wrapped lines and choose the largest font size between maxPx and minPx that fits the real free area. Pure. */
export function fitFontSize(
  text: string,
  maxPx: number,
  minPx: number,
  boxWidthPx: number,
  boxHeightPx: number,
  lineHeight = 1.24,
): { fontSize: number; overflow: boolean } {
  const clean = text.trim();
  if (!clean) return { fontSize: maxPx, overflow: false };
  const paragraphs = clean.split(/\r?\n/);
  const fits = (px: number) => {
    const charsPerLine = Math.max(4, Math.floor(boxWidthPx / (px * 0.55)));
    let lines = 0;
    for (const para of paragraphs) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) {
        lines += 1;
        continue;
      }
      let cur = 0;
      lines += 1;
      for (const w of words) {
        if (cur === 0) {
          cur = w.length;
          if (cur > charsPerLine) {
            lines += Math.ceil(cur / charsPerLine) - 1;
            cur = cur % charsPerLine || charsPerLine;
          }
        } else if (cur + 1 + w.length <= charsPerLine) {
          cur += 1 + w.length;
        } else {
          lines += 1;
          cur = w.length;
          if (cur > charsPerLine) {
            lines += Math.ceil(cur / charsPerLine) - 1;
            cur = cur % charsPerLine || charsPerLine;
          }
        }
      }
    }
    return lines * px * lineHeight <= boxHeightPx;
  };

  for (let px = maxPx; px >= minPx; px -= 2) {
    if (fits(px)) return { fontSize: px, overflow: false };
  }
  return { fontSize: minPx, overflow: !fits(minPx) };
}

export interface DesignRenderOptions {
  /** Embedded @font-face CSS (data:font/woff2;base64,...) supplied by the runner/caller. */
  fontCss?: string;
  /** Optional brand logo as data:image/... URL. */
  logoDataUrl?: string | null;
  /** Optional photo attachments as data:image/... URLs. */
  photoDataUrls?: (string | null | undefined)[];
  /** Project display name — shown in the brand footer when Brand Kit has no handle and no logo. */
  projectName?: string | null;
}

export interface DesignRenderResult {
  /** One HTML document per page (length 1 for single-image templates, 2..10 for tip_carousel). */
  pages: string[];
  width: number;
  height: number;
  warnings: string[];
}

function iconSvg(name: string, size: number, color: string, strokeWidth = 1.9): string {
  const path = DESIGN_ICONS[name] ?? DESIGN_ICONS.star!;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

function styleTokens(brand: BrandKit) {
  const r = brand.style === "playful" ? 36 : brand.style === "soft" ? 28 : brand.style === "bold" ? 14 : 22;
  const border = brand.style === "bold" ? `4px solid ${brand.colors.primary}` : `2px solid ${brand.colors.primary}30`;
  const headingFont = BRAND_FONTS[brand.fonts.heading]?.cssFamily ?? "Poppins";
  const bodyFont = BRAND_FONTS[brand.fonts.body]?.cssFamily ?? "Inter";
  return { r, border, headingFont, bodyFont };
}

/** Decorative offline brand background shapes (circles, rings, dot pattern, optional giant quote mark). */
function brandDecor(c: BrandKit["colors"], variant: "light" | "dark", watermark?: "quote" | "rings"): string {
  const dotColor = variant === "dark" ? "#FFFFFF14" : `${c.primary}1A`;
  const circleA = variant === "dark" ? `${c.accent}24` : `${c.primary}18`;
  const circleB = variant === "dark" ? "#FFFFFF12" : `${c.accent}1C`;
  const ringStroke = variant === "dark" ? "#FFFFFF1C" : `${c.primary}20`;
  const wm =
    watermark === "quote"
      ? `<svg width="420" height="420" viewBox="0 0 24 24" fill="none" stroke="${variant === "dark" ? "#FFFFFF" : c.primary}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" style="position:absolute;right:-40px;bottom:80px;opacity:${variant === "dark" ? "0.09" : "0.08"};pointer-events:none;">${DESIGN_ICONS.quote}</svg>`
      : `<div style="position:absolute;right:-140px;bottom:-140px;width:520px;height:520px;border-radius:9999px;border:3px solid ${ringStroke};pointer-events:none;"></div>`;
  return `
    <div style="position:absolute;inset:0;background-image:radial-gradient(${dotColor} 2.5px, transparent 2.5px);background-size:36px 36px;pointer-events:none;"></div>
    <div style="position:absolute;top:-160px;right:-140px;width:540px;height:540px;border-radius:9999px;background:radial-gradient(circle, ${circleA} 0%, transparent 70%);pointer-events:none;"></div>
    <div style="position:absolute;bottom:-180px;left:-160px;width:580px;height:580px;border-radius:9999px;background:radial-gradient(circle, ${circleB} 0%, transparent 70%);pointer-events:none;"></div>
    ${wm}`;
}

function wrapDoc(
  width: number,
  height: number,
  brand: BrandKit,
  bodyHtml: string,
  extraCss: string,
  fontCss = "",
): string {
  const { headingFont, bodyFont } = styleTokens(brand);
  return `<!doctype html>
<html lang="ms">
<head>
<meta charset="utf-8" />
<style>
${fontCss}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  width: ${width}px;
  height: ${height}px;
  overflow: hidden;
  background: ${brand.colors.background};
  color: ${brand.colors.text};
  font-family: "${bodyFont}", system-ui, -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.h { font-family: "${headingFont}", system-ui, -apple-system, sans-serif; }
.canvas {
  position: relative;
  width: ${width}px;
  height: ${height}px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.z1 { position: relative; z-index: 1; }
${extraCss}
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

/** Always shows a brand footer: logo, handle, or projectName fallback (never disappears). */
function brandFooter(brand: BrandKit, logo: string | null, projectName: string, light = false): string {
  const fg = light ? "#FFFFFF" : brand.colors.text;
  const line = light ? "#FFFFFF2A" : `${brand.colors.primary}28`;
  const label = (brand.handle || projectName || "MyOfis").trim();
  return `<div class="z1" style="display:flex;align-items:center;justify-content:space-between;gap:20px;padding-top:26px;border-top:2px solid ${line};">
    <div style="display:flex;align-items:center;gap:14px;">
      ${logo ? `<img src="${logo}" alt="" style="height:52px;max-width:200px;object-fit:contain;" />` : `<span style="width:16px;height:16px;border-radius:9999px;background:${brand.colors.accent};display:inline-block;flex-shrink:0;"></span>`}
      ${!logo ? `<span class="h" style="font-size:28px;font-weight:700;color:${fg};opacity:0.92;">${escapeHtml(label)}</span>` : ""}
    </div>
    ${logo && label ? `<span style="font-size:28px;font-weight:600;opacity:0.86;color:${fg};">${escapeHtml(label)}</span>` : `<span style="width:72px;height:8px;border-radius:9999px;background:${brand.colors.accent};display:inline-block;"></span>`}
  </div>`;
}

/**
 * Pure, offline HTML generator for Brand Kit social graphics.
 * Escapes all user text, emits zero scripts and zero remote URLs.
 */
export function renderDesignPages(
  template: DesignTemplateId,
  brandInput: BrandKit | null | undefined,
  fields: Record<string, unknown>,
  size: DesignSizeId = "post_4x5",
  opts: DesignRenderOptions = {},
): DesignRenderResult {
  const brand = brandInput ? BrandKit.parse(brandInput) : DEFAULT_BRAND_KIT;
  const effectiveSize: DesignSizeId = template === "story_frame" || template === "highlight_cover" ? "story" : size;
  const { width, height } = DESIGN_SIZES[effectiveSize];
  const { r, border } = styleTokens(brand);
  const logo = safeDataUrl(opts.logoDataUrl);
  const photos = (opts.photoDataUrls ?? []).map((p) => safeDataUrl(p));
  const fontCss = opts.fontCss ?? "";
  const projectName = (opts.projectName ?? "").trim();
  const warnings: string[] = [];

  const str = (k: string, fallback = "") => (typeof fields[k] === "string" ? (fields[k] as string) : fallback).trim();
  const c = brand.colors;
  const accentInk = readableInk(c.accent, c.secondary);
  const primaryInk = readableInk(c.primary, c.secondary);
  const overlayBase = photoOverlayBase(c);
  const lightCanvasBg = `linear-gradient(155deg, ${c.background} 0%, ${c.primary}18 58%, ${c.accent}18 100%)`;
  const darkCanvasBg = `linear-gradient(145deg, ${c.primary} 0%, ${c.secondary} 100%)`;

  if (template === "highlight_cover") {
    const iconName = str("icon", "star");
    const label = str("label", "");
    const lFit = fitFontSize(label.toUpperCase(), 54, 34, 480, 110, 1.12);
    // Circle-safe area centered at (540, 960), diameter 640px
    const html = wrapDoc(
      width,
      height,
      brand,
      `<div class="canvas" style="background:${darkCanvasBg};align-items:center;justify-content:center;">
        ${brandDecor(c, "dark", "rings")}
        <div class="z1" style="width:760px;height:760px;border-radius:9999px;border:3px solid #FFFFFF22;display:flex;align-items:center;justify-content:center;">
          <div style="width:640px;height:640px;border-radius:9999px;background:#FFFFFF16;border:12px solid ${c.accent};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;box-shadow:0 24px 64px rgba(0,0,0,0.28);">
            ${iconSvg(iconName, 250, "#FFFFFF", 1.7)}
            ${label ? `<div class="h" style="font-size:${lFit.fontSize}px;font-weight:700;color:#FFFFFF;letter-spacing:0.05em;text-transform:uppercase;text-align:center;max-width:480px;line-height:1.12;">${escapeHtml(label)}</div>` : ""}
          </div>
        </div>
      </div>`,
      "",
      fontCss,
    );
    return { pages: [html], width, height, warnings };
  }

  if (template === "story_frame") {
    const headline = str("headline", str("title", "Tajuk Story"));
    const body = str("body", "");
    const cta = str("cta", "");
    const bgPhoto = photos[0];
    const hFit = fitFontSize(headline, 132, 54, width - 160, body ? 520 : 760, 1.1);
    if (hFit.overflow) warnings.push("headline overflows story_frame safe area");
    const bFit = fitFontSize(body, 52, 34, width - 160, 440, 1.32);
    if (bFit.overflow) warnings.push("body overflows story_frame safe area");
    // Keep all text strictly outside top 250 px and bottom 340 px of 1920 px
    const bgStyle = bgPhoto
      ? `background-image:linear-gradient(180deg,${overlayBase}CC,${overlayBase}E8),url('${bgPhoto}');background-size:cover;background-position:center;`
      : `background:${darkCanvasBg};`;
    const brandTag = brand.handle || projectName;
    const html = wrapDoc(
      width,
      height,
      brand,
      `<div class="canvas" style="${bgStyle}padding:260px 80px 350px 80px;justify-content:space-between;color:#FFFFFF;">
        ${!bgPhoto ? brandDecor(c, "dark", "rings") : ""}
        <div class="z1" style="display:flex;align-items:center;justify-content:space-between;gap:20px;">
          ${logo ? `<img src="${logo}" alt="" style="height:60px;max-width:220px;object-fit:contain;" />` : `<span style="width:96px;height:12px;border-radius:99px;background:${c.accent};display:inline-block;"></span>`}
          ${brandTag ? `<span class="h" style="font-size:30px;font-weight:700;opacity:0.94;">${escapeHtml(brandTag)}</span>` : ""}
        </div>
        <div class="z1" style="display:flex;flex-direction:column;gap:38px;">
          <h1 class="h" style="font-size:${hFit.fontSize}px;line-height:1.1;font-weight:700;word-break:break-word;">${escapeHtml(headline)}</h1>
          ${body ? `<p style="font-size:${bFit.fontSize}px;line-height:1.32;opacity:0.94;word-break:break-word;">${escapeHtml(body)}</p>` : ""}
        </div>
        <div class="z1">
          ${cta ? `<div class="h" style="display:inline-block;background:${c.accent};color:${accentInk};font-size:40px;font-weight:700;padding:26px 52px;border-radius:${r}px;box-shadow:0 16px 36px rgba(0,0,0,0.24);">${escapeHtml(cta)}</div>` : `<div style="width:120px;height:10px;border-radius:99px;background:${c.accent};"></div>`}
        </div>
      </div>`,
      "",
      fontCss,
    );
    return { pages: [html], width, height, warnings };
  }

  if (template === "quote") {
    const quote = str("quote", str("body", ""));
    const author = str("author", str("name", ""));
    const bgPhoto = photos[0];
    const isDark = !!bgPhoto;
    const qFit = fitFontSize(quote, 104, 42, width - 176, height - 470, 1.2);
    if (qFit.overflow) warnings.push("quote text is too long and may overflow");
    const canvasBg = bgPhoto
      ? `background-image:linear-gradient(160deg,${overlayBase}D4,${overlayBase}EB),url('${bgPhoto}');background-size:cover;background-position:center;color:#FFFFFF;`
      : `background:${lightCanvasBg};color:${c.text};`;
    const html = wrapDoc(
      width,
      height,
      brand,
      `<div class="canvas" style="padding:84px;${canvasBg}justify-content:space-between;">
        ${!bgPhoto ? brandDecor(c, "light", "quote") : ""}
        <div class="z1" style="display:flex;align-items:center;justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:20px;">
            <span style="width:88px;height:12px;border-radius:99px;background:${c.accent};display:inline-block;"></span>
            ${iconSvg("quote", 76, isDark ? c.accent : c.primary, 1.9)}
          </div>
          <span style="font-size:26px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${isDark ? "#FFFFFFB8" : c.primary};">QUOTE</span>
        </div>
        <div class="z1" style="display:flex;flex-direction:column;gap:40px;padding:24px 0;">
          <div class="h" style="font-size:${qFit.fontSize}px;line-height:1.2;font-weight:700;color:${isDark ? "#FFFFFF" : c.text};word-break:break-word;">“${escapeHtml(quote)}”</div>
          ${author ? `<div style="display:flex;align-items:center;gap:18px;"><span style="width:44px;height:6px;border-radius:99px;background:${c.accent};display:inline-block;flex-shrink:0;"></span><span class="h" style="font-size:38px;font-weight:700;color:${isDark ? c.accent : c.primary};">${escapeHtml(author)}</span></div>` : ""}
        </div>
        ${brandFooter(brand, logo, projectName, isDark)}
      </div>`,
      "",
      fontCss,
    );
    return { pages: [html], width, height, warnings };
  }

  if (template === "tip_carousel") {
    const title = str("title", str("headline", "Tip Penting"));
    const subtitle = str("subtitle", "Leret untuk baca semua tip →");
    const cta = str("cta", "Simpan & kongsi post ini!");
    const bgPhoto = photos[0];
    const rawSlides = Array.isArray(fields.slides) ? fields.slides.slice(0, 8) : [];
    const slides = rawSlides.map((s, idx) => {
      if (typeof s === "string") return { heading: `Tip #${idx + 1}`, body: s };
      const obj = (s ?? {}) as Record<string, unknown>;
      return {
        heading: typeof obj.heading === "string" ? obj.heading : typeof obj.title === "string" ? obj.title : `Tip #${idx + 1}`,
        body: typeof obj.body === "string" ? obj.body : "",
      };
    });

    const pages: string[] = [];
    // Slide 0: Cover (accepts photos[0] full-bleed with brand overlay)
    const coverFit = fitFontSize(title, 120, 48, width - 176, height - 520, 1.12);
    const subFit = fitFontSize(subtitle, 44, 34, width - 176, 170, 1.3);
    if (coverFit.overflow) warnings.push("carousel cover title overflows");
    const coverBg = bgPhoto
      ? `background-image:linear-gradient(160deg,${overlayBase}D0,${overlayBase}EA),url('${bgPhoto}');background-size:cover;background-position:center;`
      : `background:${darkCanvasBg};`;
    pages.push(
      wrapDoc(
        width,
        height,
        brand,
        `<div class="canvas" style="padding:84px;${coverBg}color:#FFFFFF;justify-content:space-between;">
          ${!bgPhoto ? brandDecor(c, "dark", "rings") : ""}
          <div class="z1" style="display:flex;align-items:center;justify-content:space-between;">
            <span class="h" style="display:inline-flex;padding:14px 32px;border-radius:999px;background:${c.accent};color:${accentInk};font-weight:700;font-size:28px;letter-spacing:0.04em;">${slides.length ? `${slides.length} TIP PANDUAN` : "PANDUAN"}</span>
            <span style="font-size:28px;font-weight:600;opacity:0.86;">01 / ${String(slides.length + 2).padStart(2, "0")}</span>
          </div>
          <div class="z1" style="display:flex;flex-direction:column;gap:32px;padding:16px 0;">
            <h1 class="h" style="font-size:${coverFit.fontSize}px;line-height:1.12;font-weight:700;word-break:break-word;">${escapeHtml(title)}</h1>
            <p style="font-size:${subFit.fontSize}px;line-height:1.3;opacity:0.92;word-break:break-word;">${escapeHtml(subtitle)}</p>
          </div>
          ${brandFooter(brand, logo, projectName, true)}
        </div>`,
        "",
        fontCss,
      ),
    );

    // Middle slides (1..8)
    slides.forEach((s, idx) => {
      const hFit = fitFontSize(s.heading, 86, 44, width - 230, 260, 1.15);
      const bFit = fitFontSize(s.body, 52, 34, width - 230, height - 620, 1.34);
      if (hFit.overflow || bFit.overflow) warnings.push(`carousel slide ${idx + 1} text overflows`);
      pages.push(
        wrapDoc(
          width,
          height,
          brand,
          `<div class="canvas" style="padding:80px;background:${lightCanvasBg};justify-content:space-between;gap:32px;">
            ${brandDecor(c, "light", "rings")}
            <div class="z1" style="display:flex;align-items:center;justify-content:space-between;">
              <span class="h" style="font-size:34px;font-weight:700;color:${c.primary};">${String(idx + 1).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")}</span>
              <span style="height:10px;width:160px;border-radius:99px;background:${c.accent};"></span>
            </div>
            <div class="z1" style="border:${border};border-radius:${r}px;padding:64px;background:${c.background}E8;flex:1;display:flex;flex-direction:column;justify-content:center;gap:32px;box-shadow:0 20px 48px rgba(15,23,42,0.06);">
              <h2 class="h" style="font-size:${hFit.fontSize}px;line-height:1.15;font-weight:700;color:${c.text};word-break:break-word;">${escapeHtml(s.heading)}</h2>
              ${s.body ? `<p style="font-size:${bFit.fontSize}px;line-height:1.34;color:${c.text};opacity:0.9;word-break:break-word;">${escapeHtml(s.body)}</p>` : ""}
            </div>
            ${brandFooter(brand, logo, projectName)}
          </div>`,
          "",
          fontCss,
        ),
      );
    });

    // End slide: CTA
    const ctaFit = fitFontSize(cta, 96, 44, width - 190, 440, 1.18);
    if (ctaFit.overflow) warnings.push("carousel CTA overflows");
    const ctaTag = brand.handle || projectName;
    pages.push(
      wrapDoc(
        width,
        height,
        brand,
        `<div class="canvas" style="padding:84px;background:${darkCanvasBg};color:#FFFFFF;align-items:center;justify-content:space-between;text-align:center;">
          ${brandDecor(c, "dark", "rings")}
          <span class="z1 h" style="padding:12px 30px;border-radius:999px;background:${c.accent};color:${accentInk};font-size:28px;font-weight:700;">SIMPAN &amp; KONGSI</span>
          <div class="z1" style="display:flex;flex-direction:column;align-items:center;gap:36px;">
            <div>${iconSvg("bookmark", 116, c.accent, 1.8)}</div>
            <h2 class="h" style="font-size:${ctaFit.fontSize}px;line-height:1.18;font-weight:700;max-width:880px;word-break:break-word;">${escapeHtml(cta)}</h2>
          </div>
          <div class="z1" style="display:flex;align-items:center;gap:18px;">
            ${logo ? `<img src="${logo}" alt="" style="height:56px;max-width:220px;object-fit:contain;" />` : ""}
            ${ctaTag ? `<span class="h" style="font-size:36px;font-weight:700;color:${c.accent};">${escapeHtml(ctaTag)}</span>` : ""}
          </div>
        </div>`,
        "",
        fontCss,
      ),
    );
    return { pages, width, height, warnings };
  }

  if (template === "list_top") {
    const title = str("title", "Top 5 Pilihan");
    const items = (Array.isArray(fields.items) ? fields.items : []).map((x) => String(x)).filter(Boolean).slice(0, 10);
    const hFit = fitFontSize(title, 96, 48, width - 160, 230, 1.12);
    if (hFit.overflow) warnings.push("list_top title overflows");
    const availableListH = height - 430;
    const gap = Math.max(16, Math.min(28, Math.floor(availableListH / Math.max(1, items.length) * 0.14)));
    const rowBoxH = Math.max(82, Math.floor((availableListH - gap * Math.max(0, items.length - 1)) / Math.max(1, items.length)));
    const longestItem = items.reduce((a, b) => (b.length > a.length ? b : a), "");
    const itemFit = fitFontSize(longestItem, 52, 34, width - 320, Math.max(76, rowBoxH - 24), 1.2);
    if (itemFit.overflow) warnings.push("one or more list_top items overflow");
    const rowsHtml = items
      .map(
        (it, i) => `<div style="flex:1;display:flex;align-items:center;gap:26px;padding:18px 30px;border-radius:${Math.min(r, 24)}px;border:${border};background:${c.background}E6;box-shadow:0 10px 28px rgba(15,23,42,0.05);">
          <span class="h" style="width:66px;height:66px;border-radius:999px;background:${c.primary};color:${primaryInk};display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:700;flex-shrink:0;">${i + 1}</span>
          <span style="font-size:${itemFit.fontSize}px;line-height:1.2;font-weight:600;color:${c.text};word-break:break-word;">${escapeHtml(it)}</span>
        </div>`,
      )
      .join("");
    const html = wrapDoc(
      width,
      height,
      brand,
      `<div class="canvas" style="padding:72px;background:${lightCanvasBg};justify-content:space-between;gap:28px;">
        ${brandDecor(c, "light", "rings")}
        <div class="z1" style="display:flex;flex-direction:column;gap:14px;">
          <span style="width:84px;height:10px;border-radius:99px;background:${c.accent};display:inline-block;"></span>
          <h1 class="h" style="font-size:${hFit.fontSize}px;line-height:1.12;font-weight:700;color:${c.text};word-break:break-word;">${escapeHtml(title)}</h1>
        </div>
        <div class="z1" style="display:flex;flex-direction:column;gap:${gap}px;flex:1;">${rowsHtml}</div>
        ${brandFooter(brand, logo, projectName)}
      </div>`,
      "",
      fontCss,
    );
    return { pages: [html], width, height, warnings };
  }

  if (template === "before_after") {
    const title = str("title", "Sebelum & Selepas");
    const beforeLabel = str("before_label", "SEBELUM");
    const afterLabel = str("after_label", "SELEPAS");
    const p1 = photos[0];
    const p2 = photos[1];
    const hFit = fitFontSize(title, 84, 44, width - 144, 200, 1.12);
    if (hFit.overflow) warnings.push("before_after title overflows");
    const pane = (photo: string | null | undefined, label: string, bg: string, pillBg: string, pillInk: string) => `
      <div style="position:relative;flex:1;border-radius:${r}px;overflow:hidden;border:${border};background:${bg};display:flex;align-items:center;justify-content:center;">
        ${
          photo
            ? `<img src="${photo}" alt="" style="width:100%;height:100%;object-fit:cover;" />`
            : `<div style="display:flex;flex-direction:column;align-items:center;gap:18px;padding:32px;text-align:center;">
                ${iconSvg("camera", 84, c.primary, 1.6)}
                <span class="h" style="font-size:36px;opacity:0.72;font-weight:700;color:${c.text};">${escapeHtml(label)}</span>
              </div>`
        }
        <span class="h" style="position:absolute;top:24px;left:24px;background:${pillBg};color:${pillInk};padding:12px 26px;border-radius:999px;font-size:28px;font-weight:700;letter-spacing:0.04em;">${escapeHtml(label)}</span>
      </div>`;
    const html = wrapDoc(
      width,
      height,
      brand,
      `<div class="canvas" style="padding:68px;background:${lightCanvasBg};justify-content:space-between;gap:28px;">
        ${brandDecor(c, "light", "rings")}
        <h1 class="z1 h" style="font-size:${hFit.fontSize}px;line-height:1.12;font-weight:700;text-align:center;color:${c.text};word-break:break-word;">${escapeHtml(title)}</h1>
        <div class="z1" style="display:grid;grid-template-columns:1fr 1fr;gap:24px;flex:1;">
          ${pane(p1, beforeLabel, `linear-gradient(160deg,${c.secondary}18,${c.secondary}2A)`, c.secondary, "#FFFFFF")}
          ${pane(p2, afterLabel, `linear-gradient(160deg,${c.primary}1A,${c.accent}24)`, c.primary, primaryInk)}
        </div>
        ${brandFooter(brand, logo, projectName)}
      </div>`,
      "",
      fontCss,
    );
    return { pages: [html], width, height, warnings };
  }

  if (template === "promo") {
    const headline = str("headline", str("title", "Tawaran Istimewa"));
    const price = str("price", "");
    const cta = str("cta", "Tempah Sekarang");
    const subtitle = str("subtitle", "");
    const photo = photos[0];

    if (photo) {
      // Full-bleed photo background with brand overlay >= 4.5:1 contrast
      const hFit = fitFontSize(headline, 112, 46, width - 168, 420, 1.12);
      const sFit = fitFontSize(subtitle, 44, 34, width - 168, 200, 1.3);
      if (hFit.overflow) warnings.push("promo headline overflows");
      const html = wrapDoc(
        width,
        height,
        brand,
        `<div class="canvas" style="padding:80px;background-image:linear-gradient(180deg,${overlayBase}B8 0%,${overlayBase}EA 68%,${overlayBase}F5 100%),url('${photo}');background-size:cover;background-position:center;color:#FFFFFF;justify-content:space-between;">
          <div class="z1" style="display:flex;align-items:center;justify-content:space-between;gap:20px;">
            <span class="h" style="padding:14px 30px;border-radius:999px;background:${c.accent};color:${accentInk};font-size:28px;font-weight:700;letter-spacing:0.05em;">PROMO</span>
            ${price ? `<div class="h" style="background:${c.accent};color:${accentInk};padding:18px 36px;border-radius:${r}px;font-size:48px;font-weight:700;box-shadow:0 16px 36px rgba(0,0,0,0.28);">${escapeHtml(price)}</div>` : ""}
          </div>
          <div class="z1" style="display:flex;flex-direction:column;gap:28px;">
            <h1 class="h" style="font-size:${hFit.fontSize}px;line-height:1.12;font-weight:700;word-break:break-word;">${escapeHtml(headline)}</h1>
            ${subtitle ? `<p style="font-size:${sFit.fontSize}px;line-height:1.3;opacity:0.93;word-break:break-word;">${escapeHtml(subtitle)}</p>` : ""}
            <div style="margin-top:8px;">
              <span class="h" style="display:inline-block;background:${c.accent};color:${accentInk};padding:24px 48px;border-radius:${r}px;font-size:38px;font-weight:700;">${escapeHtml(cta)}</span>
            </div>
          </div>
          ${brandFooter(brand, logo, projectName, true)}
        </div>`,
        "",
        fontCss,
      );
      return { pages: [html], width, height, warnings };
    }

    // No photo: full-canvas brand gradient + geometric decor (NEVER a lone placeholder icon)
    const hFit = fitFontSize(headline, 116, 46, width - 168, height - 560, 1.12);
    const sFit = fitFontSize(subtitle, 44, 34, width - 168, 220, 1.3);
    if (hFit.overflow) warnings.push("promo headline overflows");
    const html = wrapDoc(
      width,
      height,
      brand,
      `<div class="canvas" style="padding:84px;background:${darkCanvasBg};color:#FFFFFF;justify-content:space-between;">
        ${brandDecor(c, "dark", "rings")}
        <div class="z1" style="display:flex;align-items:center;justify-content:space-between;gap:20px;">
          <span class="h" style="padding:14px 32px;border-radius:999px;background:#FFFFFF1F;border:2px solid #FFFFFF38;color:#FFFFFF;font-size:28px;font-weight:700;letter-spacing:0.06em;">TAWARAN</span>
          ${price ? `<div class="h" style="background:${c.accent};color:${accentInk};padding:18px 38px;border-radius:${r}px;font-size:50px;font-weight:700;box-shadow:0 16px 36px rgba(0,0,0,0.28);">${escapeHtml(price)}</div>` : ""}
        </div>
        <div class="z1" style="display:flex;flex-direction:column;gap:30px;padding:12px 0;">
          <h1 class="h" style="font-size:${hFit.fontSize}px;line-height:1.12;font-weight:700;word-break:break-word;">${escapeHtml(headline)}</h1>
          ${subtitle ? `<p style="font-size:${sFit.fontSize}px;line-height:1.3;opacity:0.92;word-break:break-word;">${escapeHtml(subtitle)}</p>` : ""}
          <div style="margin-top:10px;">
            <span class="h" style="display:inline-block;background:${c.accent};color:${accentInk};padding:24px 50px;border-radius:${r}px;font-size:38px;font-weight:700;box-shadow:0 14px 32px rgba(0,0,0,0.22);">${escapeHtml(cta)}</span>
          </div>
        </div>
        ${brandFooter(brand, logo, projectName, true)}
      </div>`,
      "",
      fontCss,
    );
    return { pages: [html], width, height, warnings };
  }

  if (template === "announcement") {
    const eyebrow = str("eyebrow", "PENGUMUMAN");
    const headline = str("headline", str("title", "Berita Terkini"));
    const body = str("body", "");
    const cta = str("cta", str("date", ""));
    const bgPhoto = photos[0];
    const hFit = fitFontSize(headline, 120, 48, width - 168, body ? 380 : 620, 1.12);
    const bFit = fitFontSize(body, 50, 34, width - 168, height - 620, 1.32);
    if (hFit.overflow) warnings.push("announcement headline overflows");
    if (bFit.overflow) warnings.push("announcement body overflows");
    const bgStyle = bgPhoto
      ? `background-image:linear-gradient(160deg,${overlayBase}D0,${overlayBase}EA),url('${bgPhoto}');background-size:cover;background-position:center;`
      : `background:${darkCanvasBg};`;
    const html = wrapDoc(
      width,
      height,
      brand,
      `<div class="canvas" style="padding:84px;${bgStyle}color:#FFFFFF;justify-content:space-between;">
        ${!bgPhoto ? brandDecor(c, "dark", "rings") : ""}
        <div class="z1" style="display:inline-flex;align-self:flex-start;background:${c.accent};color:${accentInk};padding:14px 32px;border-radius:999px;font-size:28px;font-weight:700;letter-spacing:0.06em;">${escapeHtml(eyebrow)}</div>
        <div class="z1" style="display:flex;flex-direction:column;gap:32px;padding:16px 0;">
          <h1 class="h" style="font-size:${hFit.fontSize}px;line-height:1.12;font-weight:700;word-break:break-word;">${escapeHtml(headline)}</h1>
          ${body ? `<p style="font-size:${bFit.fontSize}px;line-height:1.32;opacity:0.94;word-break:break-word;">${escapeHtml(body)}</p>` : ""}
          ${cta ? `<div class="h" style="margin-top:8px;font-size:38px;font-weight:700;color:${c.accent};">${escapeHtml(cta)} →</div>` : ""}
        </div>
        ${brandFooter(brand, logo, projectName, true)}
      </div>`,
      "",
      fontCss,
    );
    return { pages: [html], width, height, warnings };
  }

  // testimonial
  const body = str("body", str("quote", ""));
  const author = str("author", str("name", "Pelanggan"));
  const role = str("role", "");
  const rating = Math.max(1, Math.min(5, Number(fields.rating ?? 5) || 5));
  const bFit = fitFontSize(body, 82, 36, width - 220, height - 560, 1.24);
  if (bFit.overflow) warnings.push("testimonial body overflows");
  const stars = Array.from({ length: rating }, () => iconSvg("star", 56, c.accent, 2)).join("");
  const html = wrapDoc(
    width,
    height,
    brand,
    `<div class="canvas" style="padding:76px;background:${lightCanvasBg};justify-content:space-between;gap:28px;">
      ${brandDecor(c, "light", "quote")}
      <div class="z1" style="flex:1;border:${border};border-radius:${r}px;padding:64px;background:${c.background}EC;display:flex;flex-direction:column;justify-content:space-between;gap:32px;box-shadow:0 22px 54px rgba(15,23,42,0.07);">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div style="display:flex;gap:12px;">${stars}</div>
          <span class="h" style="font-size:26px;font-weight:700;letter-spacing:0.06em;color:${c.primary};">ULASAN</span>
        </div>
        <p class="h" style="font-size:${bFit.fontSize}px;line-height:1.24;font-weight:600;color:${c.text};word-break:break-word;">“${escapeHtml(body)}”</p>
        <div style="display:flex;align-items:center;gap:24px;padding-top:24px;border-top:2px solid ${c.primary}22;">
          <div class="h" style="width:84px;height:84px;border-radius:999px;background:${c.primary};color:${primaryInk};display:flex;align-items:center;justify-content:center;font-size:38px;font-weight:700;flex-shrink:0;">${escapeHtml(author.slice(0, 1).toUpperCase())}</div>
          <div>
            <div class="h" style="font-size:38px;font-weight:700;color:${c.text};">${escapeHtml(author)}</div>
            ${role ? `<div style="font-size:34px;opacity:0.78;color:${c.text};">${escapeHtml(role)}</div>` : ""}
          </div>
        </div>
      </div>
      ${brandFooter(brand, logo, projectName)}
    </div>`,
    "",
    fontCss,
  );
  return { pages: [html], width, height, warnings };
}
