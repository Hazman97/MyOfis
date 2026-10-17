import { createPixmap, fillRect, noise, setPixel, type Pixmap } from "./pixmap.ts";
import { P } from "./palette.ts";

/** Floors, walls and other single-tile pieces (16×16), drawn procedurally. */
const T = 16;

export type FloorKind = "wood" | "carpet" | "pantry" | "server";

export function floor(kind: FloorKind, variant = 0): Pixmap {
  const px = createPixmap(T, T);
  switch (kind) {
    case "wood": {
      // 4 px planks; joints offset per plank row and per variant
      for (let row = 0; row < 4; row++) {
        const y0 = row * 4;
        fillRect(px, 0, y0, T, 4, P.wood);
        for (let x = 0; x < T; x++) if (noise(x, y0, variant + 1) > 0.82) setPixel(px, x, y0 + 1 + (x % 2), P.woodLight);
        fillRect(px, 0, y0 + 3, T, 1, P.woodDark);
        const joint = (row * 7 + variant * 5) % T;
        fillRect(px, joint, y0, 1, 3, P.woodDark);
      }
      break;
    }
    case "carpet":
      fillRect(px, 0, 0, T, T, P.carpet);
      for (let y = 0; y < T; y++)
        for (let x = 0; x < T; x++) {
          const n = noise(x, y, 11 + variant);
          if (n > 0.86) setPixel(px, x, y, P.carpetLight);
          else if (n < 0.1) setPixel(px, x, y, P.carpetDark);
        }
      break;
    case "pantry":
      // 8 px checker tiles with grout
      for (let y = 0; y < T; y++)
        for (let x = 0; x < T; x++) setPixel(px, x, y, (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? "#dfe5e1" : "#c9d3cd");
      fillRect(px, 0, 0, T, 1, "#b3bfb8");
      fillRect(px, 0, 8, T, 1, "#b3bfb8");
      fillRect(px, 0, 0, 1, T, "#b3bfb8");
      fillRect(px, 8, 0, 1, T, "#b3bfb8");
      break;
    case "server":
      // raised-floor panels
      fillRect(px, 0, 0, T, T, P.tile);
      fillRect(px, 0, 0, T, 1, P.tileLight);
      fillRect(px, 0, 0, 1, T, P.tileLight);
      fillRect(px, 0, 15, T, 1, P.tileDark);
      fillRect(px, 15, 0, 1, T, P.tileDark);
      for (const [x, y] of [
        [3, 3],
        [12, 3],
        [3, 12],
        [12, 12],
      ] as const)
        setPixel(px, x, y, P.tileDark);
      break;
  }
  return px;
}

/** Soft shadow along the top edge: used on floor tiles right below a wall. */
export function withTopShadow(src: Pixmap): Pixmap {
  const px = createPixmap(src.w, src.h);
  px.data.set(src.data);
  fillRect(px, 0, 0, T, 2, "#0000002e");
  fillRect(px, 0, 2, T, 1, "#00000014");
  return px;
}

/**
 * Wall top seen from above. `open` says which sides face a non-wall cell
 * (N, E, S, W bits: 1, 2, 4, 8); those sides get a light rim so a run of wall
 * caps reads as one solid wall without a visible grid.
 */
export function wallCap(open: number): Pixmap {
  const px = createPixmap(T, T);
  fillRect(px, 0, 0, T, T, P.wallTop);
  if (open & 1) {
    fillRect(px, 0, 0, T, 1, P.outline);
    fillRect(px, 0, 1, T, 1, P.wallTopLight);
  }
  if (open & 4) {
    fillRect(px, 0, 15, T, 1, P.outline);
    fillRect(px, 0, 14, T, 1, P.wallTopLight);
  }
  if (open & 8) {
    fillRect(px, 0, 0, 1, T, P.outline);
    fillRect(px, 1, 0, 1, T, P.wallTopLight);
  }
  if (open & 2) {
    fillRect(px, 15, 0, 1, T, P.outline);
    fillRect(px, 14, 0, 1, T, P.wallTopLight);
  }
  return px;
}

/** Wall face (the vertical side of a wall, seen from the front). */
export function wallFace(): Pixmap {
  const px = createPixmap(T, T);
  fillRect(px, 0, 0, T, T, P.wall);
  fillRect(px, 0, 0, T, 1, P.outline);
  fillRect(px, 0, 1, T, 2, P.wallShade);
  fillRect(px, 0, 12, T, 1, P.outline);
  fillRect(px, 0, 13, T, 3, P.baseboard);
  return px;
}

/** Threshold across a doorway in a horizontal wall. */
export function doorway(): Pixmap {
  const px = floor("wood", 3);
  fillRect(px, 0, 0, T, 2, P.metalDark);
  fillRect(px, 0, 2, T, 1, P.metal);
  return px;
}

/** The invisible tile painted on the "collision" layer. */
export function collisionMark(): Pixmap {
  const px = createPixmap(T, T);
  fillRect(px, 0, 0, T, T, "#ff2d5566");
  fillRect(px, 0, 0, T, 1, "#ff2d55");
  fillRect(px, 0, 0, 1, T, "#ff2d55");
  return px;
}
