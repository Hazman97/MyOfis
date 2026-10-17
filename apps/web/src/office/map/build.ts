import { blit, createPixmap, crop, isTransparent, type Pixmap } from "../art/pixmap.ts";
import * as F from "../art/furniture.ts";
import { collisionMark, doorway, floor, wallCap, wallFace, withTopShadow, type FloorKind } from "../art/tiles.ts";
import { CHARACTER_FRAMES, CHAR_H, CHAR_W, OUTFITS, drawCharacterFrame } from "../art/characters.ts";
import { buildProps } from "../art/props.ts";
import { DESKS, GRID, MAP_H, MAP_W, OWNER_CHAIR, PIECES, PLACES, RACKS, SERVER_LAMP, ZONES, type PieceKind } from "./officeMap.ts";
import type { TiledMap, TiledObject, TiledProperty, TiledTileLayer } from "./tmj.ts";

/**
 * Builds every office asset from code: the tileset image, the Tiled map, and
 * the character / prop atlases. Pure (returns pixmaps + JSON); the build script
 * writes them to maps/.
 */
const T = F.TILE;
const TILESET_COLUMNS = 16;

interface PieceSpec {
  draw: (variant: number) => Pixmap;
  /** Image rows (in tiles, from the top) that block walking. */
  blockRows: number[];
  /** Image rows drawn above characters. */
  overheadRows?: number[];
}

const tall = (draw: (v: number) => Pixmap, overhead = false): PieceSpec => ({ draw, blockRows: [1], overheadRows: overhead ? [0] : [] });

const SPECS: Record<PieceKind, PieceSpec> = {
  desk: { draw: (v) => F.desk(v), blockRows: [0, 1] },
  owner_desk: { draw: () => F.ownerDesk(), blockRows: [0, 1] },
  cabinet: tall(() => F.cabinet()),
  bookshelf: { draw: (v) => F.bookshelf(v), blockRows: [1] },
  rack: tall(() => F.serverRack()),
  plant: tall((v) => F.plant(v), true),
  printer: tall(() => F.printer()),
  meeting_table: { draw: () => F.meetingTable(), blockRows: [0, 1] },
  pantry_table: { draw: () => F.pantryTable(), blockRows: [0] },
  sofa: { draw: () => F.sofa(), blockRows: [0] },
  coffee_table: { draw: () => F.coffeeTable(), blockRows: [0] },
  counter: tall(() => F.counter("plain")),
  sink: tall(() => F.counter("sink")),
  coffee_machine: tall(() => F.counter("coffee")),
  fridge: tall(() => F.fridge()),
  water_cooler: tall(() => F.waterCooler()),
  vending: tall(() => F.vendingMachine()),
  floor_lamp: tall(() => F.floorLamp(), true),
  rug: { draw: () => F.rug(64, 48, "#7a3b2e", "#e0a33a"), blockRows: [] },
  door_mat: { draw: () => F.doorMat(), blockRows: [] },
  whiteboard: { draw: () => F.whiteboard(), blockRows: [] },
  notice_board: { draw: () => F.noticeBoard(), blockRows: [] },
  window: { draw: () => F.windowPane(), blockRows: [] },
  clock: { draw: () => F.wallClock(), blockRows: [] },
  picture: { draw: (v) => F.picture(v), blockRows: [] },
};

/** Collects unique 16×16 tiles; returns Tiled gids (1-based). */
class TilesetBuilder {
  tiles: Pixmap[] = [];
  #byKey = new Map<string, number>();
  collides = new Set<number>();

  add(px: Pixmap, collides = false): number {
    if (px.w !== T || px.h !== T) throw new Error(`tile must be ${T}×${T}`);
    const key = px.data.join(",");
    let id = this.#byKey.get(key);
    if (id === undefined) {
      id = this.tiles.length;
      this.tiles.push(px);
      this.#byKey.set(key, id);
    }
    if (collides) this.collides.add(id);
    return id + 1;
  }

  image(): Pixmap {
    const rows = Math.ceil(this.tiles.length / TILESET_COLUMNS);
    const img = createPixmap(TILESET_COLUMNS * T, rows * T);
    this.tiles.forEach((t, i) => blit(img, t, (i % TILESET_COLUMNS) * T, Math.floor(i / TILESET_COLUMNS) * T));
    return img;
  }
}

const cellAt = (x: number, y: number) => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H ? "#" : GRID[y]![x]!);
const isWall = (c: string) => c === "#" || c === "=";

const FLOOR_OF: Record<string, FloorKind> = { w: "wood", d: "wood", k: "carpet", t: "pantry", s: "server" };

export interface OfficeBuild {
  tileset: Pixmap;
  map: TiledMap;
}

export function buildOfficeMap(): OfficeBuild {
  if (GRID.length !== MAP_H || GRID.some((r) => r.length !== MAP_W)) throw new Error(`GRID must be ${MAP_W}×${MAP_H}`);
  const ts = new TilesetBuilder();
  const layer = () => new Array<number>(MAP_W * MAP_H).fill(0);
  const floorL = layer();
  const wallsL = layer();
  const furnitureL = layer();
  const overheadL = layer();
  const collisionL = layer();
  const solid = new Uint8Array(MAP_W * MAP_H);
  const at = (x: number, y: number) => y * MAP_W + x;

  // ---- floors and walls
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      const c = cellAt(x, y);
      if (c === "#") {
        const open = (isWall(cellAt(x, y - 1)) ? 0 : 1) | (isWall(cellAt(x + 1, y)) ? 0 : 2) | (isWall(cellAt(x, y + 1)) ? 0 : 4) | (isWall(cellAt(x - 1, y)) ? 0 : 8);
        wallsL[at(x, y)] = ts.add(wallCap(open));
        solid[at(x, y)] = 1;
      } else if (c === "=") {
        wallsL[at(x, y)] = ts.add(wallFace());
        solid[at(x, y)] = 1;
      } else if (c === "e") {
        floorL[at(x, y)] = ts.add(doorway());
      } else {
        const kind = FLOOR_OF[c];
        if (!kind) throw new Error(`unknown cell "${c}" at ${x},${y}`);
        const variant = kind === "wood" ? (x * 2 + y * 5) % 3 : (x + y) % 2;
        let px = floor(kind, variant);
        if (isWall(cellAt(x, y - 1))) px = withTopShadow(px);
        floorL[at(x, y)] = ts.add(px);
      }
    }

  // ---- furniture
  for (const piece of PIECES) {
    const spec = SPECS[piece.kind];
    const img = spec.draw(piece.variant ?? 0);
    const wTiles = img.w / T;
    const hTiles = img.h / T;
    for (let dy = 0; dy < hTiles; dy++)
      for (let dx = 0; dx < wTiles; dx++) {
        const x = piece.x + dx;
        const y = piece.y + dy;
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) throw new Error(`${piece.kind} at ${piece.x},${piece.y} goes off the map`);
        const tile = crop(img, dx * T, dy * T, T, T);
        if (spec.blockRows.includes(dy)) {
          if (solid[at(x, y)] && !isWall(cellAt(x, y))) throw new Error(`${piece.kind} at ${x},${y} overlaps other furniture`);
          solid[at(x, y)] = 1;
        }
        if (isTransparent(tile)) continue;
        const target = spec.overheadRows?.includes(dy) ? overheadL : furnitureL;
        if (target[at(x, y)]) throw new Error(`${piece.kind} at ${x},${y} overlaps another piece on the same layer`);
        target[at(x, y)] = ts.add(tile);
      }
  }
  // the owner's chair stands behind the desk: block those two tiles
  solid[at(OWNER_CHAIR[0], OWNER_CHAIR[1])] = 1;
  solid[at(OWNER_CHAIR[0] + 1, OWNER_CHAIR[1])] = 1;

  const mark = ts.add(collisionMark(), true);
  solid.forEach((s, i) => (collisionL[i] = s ? mark : 0));

  // ---- objects
  let nextId = 1;
  const str = (name: string, value: string): TiledProperty => ({ name, type: "string", value });
  const int = (name: string, value: number): TiledProperty => ({ name, type: "int", value });
  const point = (name: string, type: string, x: number, y: number, properties: TiledProperty[]): TiledObject => ({
    id: nextId++,
    name,
    type,
    x,
    y,
    width: 0,
    height: 0,
    rotation: 0,
    visible: true,
    point: true,
    properties,
  });

  const places = PLACES.map((p) => {
    if (solid[at(p.x, p.y)]) throw new Error(`place ${p.id} is on a blocked tile`);
    const props = [str("zone", p.zone), str("facing", p.facing)];
    if (p.chair) props.push(str("chair", p.chair));
    return point(p.id, p.kind, p.x * T + T / 2 + (p.halfRight ? T / 2 : 0), (p.y + 1) * T + (p.dy ?? 0), props);
  });

  const props: TiledObject[] = [
    ...DESKS.map(([x, y], i) => point(`screen-${i + 1}`, "screen", x * T + F.SCREEN_RECT.x, y * T + F.SCREEN_RECT.y, [int("desk", i + 1)])),
    ...RACKS.map((x, i) => point(`rack-${i + 1}`, "rack", x * T, 1 * T, [int("rack", i + 1)])),
    point("server-lamp", "lamp", SERVER_LAMP[0] * T, SERVER_LAMP[1] * T, []),
    point("owner-tray", "tray", 15 * T + F.TRAY_POS.x, 3 * T + F.TRAY_POS.y, []),
    point("notice-board", "notice_board", 21 * T, 1 * T, []),
    // decor sprites are anchored at their bottom centre
    point("owner-chair", "decor", (OWNER_CHAIR[0] + 1) * T, (OWNER_CHAIR[1] + 1) * T + 2, [str("frame", "chair/exec")]),
  ];

  const zones: TiledObject[] = Object.entries(ZONES).map(([name, [x0, y0, x1, y1]]) => ({
    id: nextId++,
    name,
    type: "zone",
    x: x0 * T,
    y: y0 * T,
    width: (x1 - x0 + 1) * T,
    height: (y1 - y0 + 1) * T,
    rotation: 0,
    visible: true,
  }));

  const tileset = ts.image();
  const tileLayer = (id: number, name: string, data: number[], visible = true): TiledTileLayer => ({
    id,
    name,
    type: "tilelayer",
    width: MAP_W,
    height: MAP_H,
    x: 0,
    y: 0,
    opacity: 1,
    visible,
    data,
  });
  const objectLayer = (id: number, name: string, objects: TiledObject[]) => ({
    id,
    name,
    type: "objectgroup" as const,
    draworder: "topdown" as const,
    x: 0 as const,
    y: 0 as const,
    opacity: 1,
    visible: true,
    objects,
  });

  const map: TiledMap = {
    type: "map",
    version: "1.10",
    tiledversion: "1.10.2",
    orientation: "orthogonal",
    renderorder: "right-down",
    infinite: false,
    width: MAP_W,
    height: MAP_H,
    tilewidth: T,
    tileheight: T,
    nextlayerid: 9,
    nextobjectid: nextId,
    layers: [
      tileLayer(1, "floor", floorL),
      tileLayer(2, "walls", wallsL),
      tileLayer(3, "furniture", furnitureL),
      tileLayer(4, "overhead", overheadL),
      tileLayer(5, "collision", collisionL, false),
      objectLayer(6, "places", places),
      objectLayer(7, "props", props),
      objectLayer(8, "zones", zones),
    ],
    tilesets: [
      {
        firstgid: 1,
        name: "office",
        image: "tiles.png",
        imagewidth: tileset.w,
        imageheight: tileset.h,
        tilewidth: T,
        tileheight: T,
        tilecount: ts.tiles.length,
        columns: TILESET_COLUMNS,
        margin: 0,
        spacing: 0,
        tiles: [...ts.collides].map((id) => ({ id, properties: [{ name: "collides", type: "bool", value: true }] })),
      },
    ],
    properties: [str("characters", "characters.json"), str("props", "props.json")],
  };
  return { tileset, map };
}

// ------------------------------------------------------------------ atlases

export interface AtlasFrame {
  frame: { x: number; y: number; w: number; h: number };
  rotated: false;
  trimmed: false;
  spriteSourceSize: { x: 0; y: 0; w: number; h: number };
  sourceSize: { w: number; h: number };
}

export interface Atlas {
  frames: Record<string, AtlasFrame>;
  meta: Record<string, unknown> & { image: string; size: { w: number; h: number } };
}

const atlasFrame = (x: number, y: number, w: number, h: number): AtlasFrame => ({
  frame: { x, y, w, h },
  rotated: false,
  trimmed: false,
  spriteSourceSize: { x: 0, y: 0, w, h },
  sourceSize: { w, h },
});

/** Shelf packer: tallest first, rows of fixed width, 1 px gap so filtering never bleeds. */
export function packAtlas(image: string, items: Record<string, Pixmap>, width = 256): { pixmap: Pixmap; atlas: Atlas } {
  const names = Object.keys(items).sort((a, b) => items[b]!.h - items[a]!.h || a.localeCompare(b));
  const placed: Record<string, { x: number; y: number }> = {};
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const n of names) {
    const p = items[n]!;
    if (p.w > width) throw new Error(`${n} is wider than the atlas`);
    if (x + p.w > width) {
      x = 0;
      y += rowH + 1;
      rowH = 0;
    }
    placed[n] = { x, y };
    x += p.w + 1;
    rowH = Math.max(rowH, p.h);
  }
  const pixmap = createPixmap(width, y + rowH);
  const frames: Record<string, AtlasFrame> = {};
  for (const n of Object.keys(items).sort()) {
    const p = items[n]!;
    const at = placed[n]!;
    blit(pixmap, p, at.x, at.y);
    frames[n] = atlasFrame(at.x, at.y, p.w, p.h);
  }
  return { pixmap, atlas: { frames, meta: { image, size: { w: pixmap.w, h: pixmap.h }, scale: "1", app: "agent-office build-office-assets" } } };
}

/** Characters: one row per outfit, one column per frame, so CSS can crop a face without the atlas. */
export function buildCharacterAtlas(): { pixmap: Pixmap; atlas: Atlas } {
  const outfits = Object.keys(OUTFITS);
  const pixmap = createPixmap(CHAR_W * CHARACTER_FRAMES.length, CHAR_H * outfits.length);
  const frames: Record<string, AtlasFrame> = {};
  outfits.forEach((name, row) =>
    CHARACTER_FRAMES.forEach((f, col) => {
      blit(pixmap, drawCharacterFrame(OUTFITS[name]!, f), col * CHAR_W, row * CHAR_H);
      frames[`${name}/${f}`] = atlasFrame(col * CHAR_W, row * CHAR_H, CHAR_W, CHAR_H);
    }),
  );
  return {
    pixmap,
    atlas: {
      frames,
      meta: {
        image: "characters.png",
        size: { w: pixmap.w, h: pixmap.h },
        scale: "1",
        app: "agent-office build-office-assets",
        frameWidth: CHAR_W,
        frameHeight: CHAR_H,
        outfits,
        frameNames: [...CHARACTER_FRAMES],
      },
    },
  };
}

export function buildPropAtlas(): { pixmap: Pixmap; atlas: Atlas } {
  const out = packAtlas("props.png", buildProps());
  out.atlas.meta.noticeSlots = F.NOTICE_SLOTS;
  return out;
}
