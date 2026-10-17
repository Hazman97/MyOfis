import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { CHARACTER_FRAMES, CHAR_H, CHAR_W, OUTFITS, drawCharacterFrame, outfitFor } from "../src/office/art/characters.ts";
import { sprite } from "../src/office/art/pixmap.ts";
import { buildCharacterAtlas, buildOfficeMap, buildPropAtlas, packAtlas } from "../src/office/map/build.ts";
import { DESKS, PLACES, RACKS } from "../src/office/map/officeMap.ts";
import { MapError, REQUIRED_ZONES, isBlocked, parseOfficeMap, type OfficeLayout, type TiledMap } from "../src/office/map/tmj.ts";

const MAPS = join(import.meta.dir, "../../../maps");

describe("pixel art", () => {
  test("sprite() rejects ragged rows and unknown colours", () => {
    expect(() => sprite("x", ["ab", "a"], { a: "#000", b: "#fff" })).toThrow(/row 1/);
    expect(() => sprite("x", ["az"], { a: "#000" })).toThrow(/unknown colour "z"/);
  });

  test("every outfit draws every frame at 16×24 and frames are not empty", () => {
    for (const [name, outfit] of Object.entries(OUTFITS))
      for (const f of CHARACTER_FRAMES) {
        const px = drawCharacterFrame(outfit, f);
        expect([px.w, px.h, name]).toEqual([CHAR_W, CHAR_H, name]);
        expect(px.data.some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
      }
  });

  test("left frames mirror right frames", () => {
    const o = OUTFITS.coder!;
    const r = drawCharacterFrame(o, "right");
    const l = drawCharacterFrame(o, "left");
    for (let y = 0; y < CHAR_H; y++)
      for (let x = 0; x < CHAR_W; x++) {
        const a = (y * CHAR_W + x) * 4;
        const b = (y * CHAR_W + (CHAR_W - 1 - x)) * 4;
        expect(l.data[a + 3]).toBe(r.data[b + 3]!);
      }
  });

  test("outfitFor: known sprite wins, otherwise a stable person-N from the slug", () => {
    expect(outfitFor({ slug: "pak-guard", sprite: "guard" })).toBe("guard");
    const a = outfitFor({ slug: "echo", sprite: "default" });
    expect(a).toMatch(/^person-\d+$/);
    expect(outfitFor({ slug: "echo", sprite: "default" })).toBe(a);
    expect(outfitFor({ slug: "echo", sprite: "no-such-look" })).toBe(a);
    // swapped art with fewer looks still resolves
    expect(outfitFor({ slug: "x", sprite: "robot" }, ["robot", "person-1"])).toBe("robot");
    expect(outfitFor({ slug: "x", sprite: "guard" }, ["person-1"])).toBe("person-1");
  });
});

describe("atlases", () => {
  test("packAtlas places frames without overlap", () => {
    const items = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}`, sprite(`f${i}`, Array.from({ length: 3 + (i % 7) }, () => "a".repeat(5 + (i % 11))), { a: "#123" })]));
    const { atlas, pixmap } = packAtlas("t.png", items, 64);
    const rects = Object.values(atlas.frames).map((f) => f.frame);
    for (const r of rects) expect(r.x + r.w <= pixmap.w && r.y + r.h <= pixmap.h).toBe(true);
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
      }
  });

  test("character atlas lists every outfit × frame", () => {
    const { atlas } = buildCharacterAtlas();
    expect(Object.keys(atlas.frames)).toHaveLength(Object.keys(OUTFITS).length * CHARACTER_FRAMES.length);
    expect(atlas.frames["guard/sit_up_hand"]?.frame.w).toBe(CHAR_W);
  });

  test("prop atlas has the frames the office view relies on", () => {
    const { atlas } = buildPropAtlas();
    for (const n of ["screen/off", "screen/code1", "screen/code2", "screen/browser", "rack/on1", "rack/off", "rack/error", "lamp/ok", "lamp/bad", "tray/0", "tray/3", "chair/back", "chair/front", "chair/arm", "chair/exec", "bubble/think3", "bubble/alert", "bubble/browser", "bubble/search", "bubble/book", "bubble/pr", "bubble/chat1", "fx/dizzy1", "fx/doc", "fx/shadow"])
      expect(atlas.frames[n]).toBeDefined();
  });
});

describe("office map", () => {
  const { map } = buildOfficeMap();
  const layout = parseOfficeMap(map);

  test("has every zone, 8 desks, an entrance and unique place ids", () => {
    for (const z of REQUIRED_ZONES) expect(layout.zones[z]).toBeDefined();
    expect(layout.places.filter((p) => p.kind === "desk")).toHaveLength(DESKS.length);
    expect(layout.places.some((p) => p.zone === "entrance")).toBe(true);
    expect(new Set(layout.places.map((p) => p.id)).size).toBe(PLACES.length);
  });

  test("every place is on a free tile and reachable from the entrance", () => {
    const reach = reachable(layout, layout.places.find((p) => p.zone === "entrance")!);
    for (const p of layout.places) {
      expect([p.id, isBlocked(layout, p.tx, p.ty)]).toEqual([p.id, false]);
      expect([p.id, reach.has(p.ty * layout.width + p.tx)]).toEqual([p.id, true]);
    }
  });

  test("every desk has a screen prop and every rack an LED prop", () => {
    for (let i = 1; i <= DESKS.length; i++) expect(layout.props.some((p) => p.type === "screen" && p.props.desk === i)).toBe(true);
    expect(layout.props.filter((p) => p.type === "rack")).toHaveLength(RACKS.length);
  });

  test("parser rejects maps it cannot run", () => {
    const noCollision: TiledMap = { ...map, layers: map.layers.filter((l) => l.name !== "collision") };
    expect(() => parseOfficeMap(noCollision)).toThrow(MapError);
    const noZones: TiledMap = { ...map, layers: map.layers.filter((l) => l.name !== "zones") };
    expect(() => parseOfficeMap(noZones)).toThrow(/missing zones/);
  });

  test("files in maps/ match the art code (run `bun run --cwd apps/web office:assets` after changing art)", () => {
    const onDisk = JSON.parse(readFileSync(join(MAPS, "office.tmj"), "utf8"));
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(map)));
    const png = (name: string) => PNG.sync.read(readFileSync(join(MAPS, name)));
    const same = (name: string, px: { w: number; h: number; data: Uint8ClampedArray }) => {
      const disk = png(name);
      expect([name, disk.width, disk.height]).toEqual([name, px.w, px.h]);
      expect(Buffer.compare(disk.data, Buffer.from(px.data))).toBe(0);
    };
    same("tiles.png", buildOfficeMap().tileset);
    same("characters.png", buildCharacterAtlas().pixmap);
    same("props.png", buildPropAtlas().pixmap);
    expect(JSON.parse(readFileSync(join(MAPS, "props.json"), "utf8"))).toEqual(JSON.parse(JSON.stringify(buildPropAtlas().atlas)));
  });
});

function reachable(l: OfficeLayout, from: { tx: number; ty: number }): Set<number> {
  const seen = new Set<number>([from.ty * l.width + from.tx]);
  const queue = [[from.tx, from.ty] as const];
  while (queue.length) {
    const [x, y] = queue.shift()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      const k = ny * l.width + nx;
      if (isBlocked(l, nx, ny) || seen.has(k)) continue;
      seen.add(k);
      queue.push([nx, ny]);
    }
  }
  return seen;
}
