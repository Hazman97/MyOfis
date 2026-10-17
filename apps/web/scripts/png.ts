import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { createPixmap, type Pixmap } from "../src/office/art/pixmap.ts";

/** Nearest-neighbour upscale, for previews. */
export function scale(src: Pixmap, k: number): Pixmap {
  if (k === 1) return src;
  const out = createPixmap(src.w * k, src.h * k);
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++) {
      const si = (Math.floor(y / k) * src.w + Math.floor(x / k)) * 4;
      const di = (y * out.w + x) * 4;
      for (let c = 0; c < 4; c++) out.data[di + c] = src.data[si + c]!;
    }
  return out;
}

export function encodePng(px: Pixmap): Buffer {
  const png = new PNG({ width: px.w, height: px.h });
  png.data = Buffer.from(px.data.buffer, px.data.byteOffset, px.data.byteLength);
  return PNG.sync.write(png);
}

export function writePng(path: string, px: Pixmap, k = 1): void {
  writeFileSync(path, encodePng(scale(px, k)));
}
