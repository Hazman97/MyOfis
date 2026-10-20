import type { OfficeLayout, Place, TiledMap, TiledTileLayer } from "../map/tmj.ts";

/**
 * The 3D office plan (owner request 2026-10-20, Taskuary-style isometric diorama). Pure: no three.js.
 * It reads the same Tiled map as the pixel office, so the brain (paths, places, zones) is unchanged:
 * - walls: cells of the "walls" tile layer; the back walls (top rows, left column) stand tall,
 *   the rest are low, so the camera sees into every room (a cut-away diorama);
 * - furniture: every connected group of blocked, non-wall cells becomes one piece whose footprint
 *   is exactly what the characters walk around; its kind comes from the zone it sits in;
 * - chairs: one per place that has a chair, turned the way the place faces.
 * One world unit = one tile; x → x, y (down the map) → z.
 */

export type FurnitureKind =
  | "desk"
  | "exec_desk"
  | "meeting_table"
  | "counter"
  | "pantry_table"
  | "sofa"
  | "bookshelf"
  | "armchair"
  | "rack"
  | "cabinet"
  | "planter";

export interface Footprint {
  /** Top-left tile (inclusive) and size in tiles. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FurniturePiece extends Footprint {
  kind: FurnitureKind;
  zone: string | null;
  /** Which side of the piece people use (the open floor next to it), so fronts face the room. */
  front: "up" | "down" | "left" | "right";
  /** Desk number (1-based) for desks, so the screen can light up for its agent. */
  desk?: number;
}

export interface WallCell {
  x: number;
  y: number;
  tall: boolean;
}

export interface ChairSpot {
  id: string;
  /** Centre in world units. */
  x: number;
  z: number;
  facing: Place["facing"];
  style: Place["chair"];
}

export interface FloorZone {
  zone: string;
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface OfficePlan {
  width: number;
  depth: number;
  walls: WallCell[];
  furniture: FurniturePiece[];
  chairs: ChairSpot[];
  zones: FloorZone[];
}

/** Walls this far from the top, or in the first column, are "back" walls and stand tall. */
const BACK_ROWS = 2;

export function officePlan(map: TiledMap, layout: OfficeLayout): OfficePlan {
  const { width: W, height: H, tileSize: T } = layout;
  const wallsLayer = map.layers.find((l): l is TiledTileLayer => l.type === "tilelayer" && l.name === "walls");
  const isWall = new Uint8Array(W * H);
  wallsLayer?.data.forEach((gid, i) => (isWall[i] = gid ? 1 : 0));
  // the outer ring is always wall, even where the art leaves a gap (doors, windows)
  const walls: WallCell[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!isWall[y * W + x]) continue;
      walls.push({ x, y, tall: y < BACK_ROWS || x === 0 });
    }

  const zoneAt = (cx: number, cy: number): string | null => {
    let best: { name: string; area: number } | null = null;
    for (const [name, z] of Object.entries(layout.zones)) {
      const inside = cx * T >= z.x && cx * T < z.x + z.w && cy * T >= z.y && cy * T < z.y + z.h;
      if (inside && (!best || z.w * z.h < best.area)) best = { name, area: z.w * z.h };
    }
    return best?.name ?? null;
  };

  const free = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && !layout.blocked[y * W + x];
  const seen = new Uint8Array(W * H);
  const furniture: FurniturePiece[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (seen[i] || !layout.blocked[i] || isWall[i]) continue;
      // flood fill one piece (4-neighbours, blocked and not wall)
      const cells: [number, number][] = [];
      const stack: [number, number][] = [[x, y]];
      seen[i] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        cells.push([cx, cy]);
        for (const [nx, ny] of [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ] as const) {
          const j = ny * W + nx;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[j] || !layout.blocked[j] || isWall[j]) continue;
          seen[j] = 1;
          stack.push([nx, ny]);
        }
      }
      // an L-shaped group becomes several rectangles, so no piece covers a walkable cell
      for (const fp of rectangles(cells)) addPiece(fp);
    }

  function addPiece(fp: Footprint): void {
      const zone = zoneAt(fp.x + fp.w / 2, fp.y + fp.h / 2);
      // the open side: where most free cells touch the piece
      const sides = {
        up: range(fp.x, fp.w).filter((cx) => free(cx, fp.y - 1)).length,
        down: range(fp.x, fp.w).filter((cx) => free(cx, fp.y + fp.h)).length,
        left: range(fp.y, fp.h).filter((cy) => free(fp.x - 1, cy)).length,
        right: range(fp.y, fp.h).filter((cy) => free(fp.x + fp.w, cy)).length,
      };
      const againstWall = (["up", "down", "left", "right"] as const).find((s) => touchesWall(fp, s, isWall, W, H));
      // the side where people stand or sit at it (a place right next to it), else the most open side
      const used = {
        up: layout.places.filter((p) => p.ty === fp.y - 1 && p.tx >= fp.x - 1 && p.tx <= fp.x + fp.w).length,
        down: layout.places.filter((p) => p.ty === fp.y + fp.h && p.tx >= fp.x - 1 && p.tx <= fp.x + fp.w).length,
        left: layout.places.filter((p) => p.tx === fp.x - 1 && p.ty >= fp.y && p.ty < fp.y + fp.h).length,
        right: layout.places.filter((p) => p.tx === fp.x + fp.w && p.ty >= fp.y && p.ty < fp.y + fp.h).length,
      };
      const score = (s: FurniturePiece["front"]) => used[s] * 100 + sides[s];
      const front = (["down", "up", "left", "right"] as const).reduce((a, b) => (score(b) > score(a) ? b : a));
      furniture.push({ ...fp, zone, front, kind: kindFor(zone, fp, !!againstWall, touchesWall(fp, "up", isWall, W, H), layout.places) });
  }

  // desks are numbered like the screens: left to right, then top to bottom
  furniture
    .filter((f) => f.kind === "desk")
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .forEach((f, i) => (f.desk = i + 1));

  const chairs: ChairSpot[] = layout.places
    .filter((p) => p.chair !== "none")
    .map((p) => ({ id: p.id, x: p.x / T, z: p.y / T - 0.35, facing: p.facing, style: p.chair }));

  const zones: FloorZone[] = Object.entries(layout.zones).map(([zone, z]) => ({ zone, x: z.x / T, z: z.y / T, w: z.w / T, d: z.h / T }));
  return { width: W, depth: H, walls, furniture, chairs, zones };
}

const range = (start: number, n: number) => Array.from({ length: n }, (_, i) => start + i);

/** Split a group of cells into rectangles: take the top-left cell, grow right, then grow down while whole rows fit. */
export function rectangles(cells: [number, number][]): Footprint[] {
  const left = new Set(cells.map(([x, y]) => `${x},${y}`));
  const out: Footprint[] = [];
  const sorted = [...cells].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const [x, y] of sorted) {
    if (!left.has(`${x},${y}`)) continue;
    let w = 1;
    while (left.has(`${x + w},${y}`)) w++;
    let h = 1;
    while (range(x, w).every((cx) => left.has(`${cx},${y + h}`))) h++;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) left.delete(`${x + dx},${y + dy}`);
    out.push({ x, y, w, h });
  }
  return out;
}

function touchesWall(fp: Footprint, side: "up" | "down" | "left" | "right", isWall: Uint8Array, W: number, H: number): boolean {
  const at = (x: number, y: number) => x < 0 || y < 0 || x >= W || y >= H || !!isWall[y * W + x];
  if (side === "up") return range(fp.x, fp.w).every((x) => at(x, fp.y - 1));
  if (side === "down") return range(fp.x, fp.w).every((x) => at(x, fp.y + fp.h));
  if (side === "left") return range(fp.y, fp.h).every((y) => at(fp.x - 1, y));
  return range(fp.y, fp.h).every((y) => at(fp.x + fp.w, y));
}

function kindFor(zone: string | null, fp: Footprint, againstWall: boolean, upWall: boolean, places: Place[]): FurnitureKind {
  // seats next to a piece: they sit on it (a sofa behind them) or look at it (a coffee table)
  let behind = false;
  let facingIt = false;
  for (const p of places) {
    if (p.kind !== "seat" || p.tx < fp.x || p.tx >= fp.x + fp.w) continue;
    if (p.ty === fp.y - 1) (p.facing === "down" ? (facingIt = true) : (behind = true));
    if (p.ty === fp.y + fp.h) (p.facing === "up" ? (facingIt = true) : (behind = true));
  }
  // a single cell in a room corner is decoration (a plant, a lamp), except pantry appliances on the wall
  if (fp.w * fp.h === 1 && !(zone === "pantry" && upWall)) return "planter";
  switch (zone) {
    case "desks":
      return "desk";
    case "owner_desk":
      return "exec_desk";
    case "meeting_room":
    case "whiteboard":
      return "meeting_table";
    case "pantry":
      if (againstWall) return "counter";
      return behind && !facingIt ? "sofa" : "pantry_table";
    case "library":
      return "bookshelf";
    case "server_room":
      return "rack";
    case "file_cabinets":
      return "cabinet";
    default:
      return "planter";
  }
}
