/**
 * Tiny RGBA image type used by all office art. Pure TypeScript (no DOM), so the
 * same art can be painted in the browser and exported to PNG by a Bun script.
 */
export interface Pixmap {
  w: number;
  h: number;
  /** RGBA, row-major, length w*h*4 */
  data: Uint8ClampedArray;
}

export const createPixmap = (w: number, h: number): Pixmap => ({ w, h, data: new Uint8ClampedArray(w * h * 4) });

export function hexToRgba(hex: string): [number, number, number, number] {
  const m = hex.replace("#", "");
  const v = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const a = v.length === 8 ? parseInt(v.slice(6, 8), 16) : 255;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16), a];
}

export type Legend = Record<string, string>;

/**
 * Build a pixmap from rows of characters. Each character is looked up in the
 * legend (char -> hex colour); "." and " " are transparent.
 * Throws when rows have different widths or a character is not in the legend,
 * so drawing mistakes fail loudly in tests and at build time.
 */
export function sprite(name: string, rows: string[], legend: Legend): Pixmap {
  const w = rows[0]?.length ?? 0;
  const px = createPixmap(w, rows.length);
  rows.forEach((row, y) => {
    if (row.length !== w) throw new Error(`sprite "${name}": row ${y} is ${row.length} wide, expected ${w}`);
    for (let x = 0; x < w; x++) {
      const ch = row[x]!;
      if (ch === "." || ch === " ") continue;
      const hex = legend[ch];
      if (!hex) throw new Error(`sprite "${name}": unknown colour "${ch}" at ${x},${y}`);
      const [r, g, b, a] = hexToRgba(hex);
      const i = (y * w + x) * 4;
      px.data[i] = r;
      px.data[i + 1] = g;
      px.data[i + 2] = b;
      px.data[i + 3] = a;
    }
  });
  return px;
}

/** Copy `src` onto `dst` at (dx, dy), alpha-over (fully transparent pixels skipped). */
export function blit(dst: Pixmap, src: Pixmap, dx: number, dy: number): void {
  for (let y = 0; y < src.h; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.h) continue;
    for (let x = 0; x < src.w; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.w) continue;
      const si = (y * src.w + x) * 4;
      const a = src.data[si + 3]!;
      if (a === 0) continue;
      const di = (ty * dst.w + tx) * 4;
      if (a === 255) {
        dst.data[di] = src.data[si]!;
        dst.data[di + 1] = src.data[si + 1]!;
        dst.data[di + 2] = src.data[si + 2]!;
        dst.data[di + 3] = 255;
      } else {
        const t = a / 255;
        for (let c = 0; c < 3; c++) dst.data[di + c] = Math.round(src.data[si + c]! * t + dst.data[di + c]! * (1 - t));
        dst.data[di + 3] = Math.max(dst.data[di + 3]!, a);
      }
    }
  }
}

export function flipX(src: Pixmap): Pixmap {
  const out = createPixmap(src.w, src.h);
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const si = (y * src.w + x) * 4;
      const di = (y * src.w + (src.w - 1 - x)) * 4;
      for (let c = 0; c < 4; c++) out.data[di + c] = src.data[si + c]!;
    }
  return out;
}

/** Cut a w×h region (out-of-bounds pixels stay transparent). */
export function crop(src: Pixmap, sx: number, sy: number, w: number, h: number): Pixmap {
  const out = createPixmap(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const tx = sx + x;
      const ty = sy + y;
      if (tx < 0 || ty < 0 || tx >= src.w || ty >= src.h) continue;
      const si = (ty * src.w + tx) * 4;
      const di = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) out.data[di + c] = src.data[si + c]!;
    }
  return out;
}

/** Recolour: every pixel whose colour equals a key gets the mapped colour. */
export function recolor(src: Pixmap, map: Record<string, string>): Pixmap {
  const out = createPixmap(src.w, src.h);
  out.data.set(src.data);
  const pairs = Object.entries(map).map(([from, to]) => [hexToRgba(from), hexToRgba(to)] as const);
  for (let i = 0; i < out.data.length; i += 4) {
    for (const [f, t] of pairs) {
      if (out.data[i] === f[0] && out.data[i + 1] === f[1] && out.data[i + 2] === f[2] && out.data[i + 3]! > 0) {
        out.data[i] = t[0];
        out.data[i + 1] = t[1];
        out.data[i + 2] = t[2];
        break;
      }
    }
  }
  return out;
}

/** Paint one pixel, alpha-over when the colour has alpha. Out of bounds is ignored. */
export function setPixel(px: Pixmap, x: number, y: number, hex: string): void {
  if (x < 0 || y < 0 || x >= px.w || y >= px.h) return;
  const [r, g, b, a] = hexToRgba(hex);
  const i = (y * px.w + x) * 4;
  if (a === 255 || px.data[i + 3] === 0) {
    px.data[i] = r;
    px.data[i + 1] = g;
    px.data[i + 2] = b;
    px.data[i + 3] = a;
    return;
  }
  const t = a / 255;
  px.data[i] = Math.round(r * t + px.data[i]! * (1 - t));
  px.data[i + 1] = Math.round(g * t + px.data[i + 1]! * (1 - t));
  px.data[i + 2] = Math.round(b * t + px.data[i + 2]! * (1 - t));
}

export function clearPixel(px: Pixmap, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= px.w || y >= px.h) return;
  px.data.fill(0, (y * px.w + x) * 4, (y * px.w + x) * 4 + 4);
}

export function fillRect(px: Pixmap, x: number, y: number, w: number, h: number, hex: string): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) setPixel(px, xx, yy, hex);
}

/** Filled box with a 1px outline. */
export function box(px: Pixmap, x: number, y: number, w: number, h: number, fill: string, outline: string): void {
  fillRect(px, x, y, w, h, outline);
  fillRect(px, x + 1, y + 1, w - 2, h - 2, fill);
}

/** Deterministic 0..1 noise from integer coordinates (no Math.random: art must be reproducible). */
export function noise(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const isTransparent = (p: Pixmap) => {
  for (let i = 3; i < p.data.length; i += 4) if (p.data[i]! > 0) return false;
  return true;
};
