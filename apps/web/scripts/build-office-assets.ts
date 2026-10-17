/**
 * Draws the office art from code and writes it to maps/:
 *   tiles.png + office.tmj      the Tiled map and its tileset
 *   characters.png/.json        worker sprites (atlas, one row per outfit)
 *   props.png/.json             live props: screens, LEDs, chairs, bubbles
 *   preview.png                 the whole office at 2x, for docs and review
 *
 * Run: bun run --cwd apps/web office:assets
 * Re-running overwrites those files. Hand edits made in Tiled to office.tmj are lost, so
 * either keep editing in Tiled or keep editing src/office/map/officeMap.ts — not both.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { blit, createPixmap, crop, type Pixmap } from "../src/office/art/pixmap.ts";
import { buildCharacterAtlas, buildOfficeMap, buildPropAtlas, type Atlas } from "../src/office/map/build.ts";
import { parseOfficeMap, type TiledTileLayer } from "../src/office/map/tmj.ts";
import { outfitFor } from "../src/office/art/characters.ts";
import { writePng } from "./png.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? join(here, "../../../maps");
mkdirSync(outDir, { recursive: true });

const { tileset, map } = buildOfficeMap();
const chars = buildCharacterAtlas();
const props = buildPropAtlas();
const layout = parseOfficeMap(map); // validates what we just built

writePng(join(outDir, "tiles.png"), tileset);
writeFileSync(join(outDir, "office.tmj"), JSON.stringify(map, null, 1));
writePng(join(outDir, "characters.png"), chars.pixmap);
writeFileSync(join(outDir, "characters.json"), JSON.stringify(chars.atlas, null, 1));
writePng(join(outDir, "props.png"), props.pixmap);
writeFileSync(join(outDir, "props.json"), JSON.stringify(props.atlas, null, 1));

// ---- preview: tile layers + a few workers and props, so a human can eyeball the result
const T = map.tilewidth;
const img = createPixmap(map.width * T, map.height * T);
const tile = (gid: number) => crop(tileset, ((gid - 1) % 16) * T, Math.floor((gid - 1) / 16) * T, T, T);
const drawLayer = (name: string) => {
  const l = map.layers.find((x): x is TiledTileLayer => x.type === "tilelayer" && x.name === name)!;
  l.data.forEach((gid, i) => gid && blit(img, tile(gid), (i % map.width) * T, Math.floor(i / map.width) * T));
};
const frame = (atlas: Atlas, src: Pixmap, name: string) => {
  const f = atlas.frames[name];
  if (!f) throw new Error(`no frame ${name}`);
  return crop(src, f.frame.x, f.frame.y, f.frame.w, f.frame.h);
};
const at = (atlas: Atlas, src: Pixmap, name: string, x: number, y: number, anchor: "top-left" | "bottom" = "top-left") => {
  const p = frame(atlas, src, name);
  blit(img, p, anchor === "bottom" ? Math.round(x - p.w / 2) : x, anchor === "bottom" ? y - p.h : y);
};

drawLayer("floor");
drawLayer("walls");
drawLayer("furniture");
const place = (id: string) => layout.places.find((p) => p.id === id)!;
const screens = ["screen/code1", "screen/browser", "screen/idle", "screen/alert", "screen/off", "screen/code2", "screen/done", "screen/off"];
for (const p of layout.props) {
  if (p.type === "screen") at(props.atlas, props.pixmap, screens[(Number(p.props.desk) - 1) % screens.length]!, p.x, p.y);
  if (p.type === "rack") at(props.atlas, props.pixmap, p.props.rack === 5 ? "rack/error" : "rack/on1", p.x, p.y);
  if (p.type === "lamp") at(props.atlas, props.pixmap, "lamp/warn", p.x, p.y);
  if (p.type === "tray") at(props.atlas, props.pixmap, "tray/2", p.x, p.y);
  if (p.type === "decor") at(props.atlas, props.pixmap, String(p.props.frame), p.x, p.y, "bottom");
  if (p.type === "notice_board") {
    const slots = props.atlas.meta.noticeSlots as { x: number; y: number }[];
    ["note/yellow", "note/green", "note/pink"].forEach((n, i) => at(props.atlas, props.pixmap, n, p.x + slots[i]!.x, p.y + slots[i]!.y));
  }
}
// empty chairs everywhere a chair belongs
const occupied: Record<string, [string, string]> = {
  "desk-1": ["coder", "sit_up_type1"],
  "desk-2": ["tester", "sit_up_type2"],
  "desk-4": ["person-2", "sit_up_hand"],
  "desk-6": ["guard", "sit_up"],
  "meeting-1": ["person-3", "sit_down"],
  "meeting-6": ["person-4", "sit_up"],
  "sofa-2": ["marketer", "sit_down"],
  "library-seat-1": ["person-6", "sit_down"],
};
for (const p of layout.places) {
  if (p.chair !== "none" && !occupied[p.id]) at(props.atlas, props.pixmap, `chair/${p.chair}`, p.x, p.y, "bottom");
}
const sprites: { name: string; x: number; y: number; bubble?: string }[] = [
  ...Object.entries(occupied).map(([id, [o, f]]) => ({ name: `${o}/${f}`, x: place(id).x, y: place(id).y })),
  { name: "person-1/down_walk1", x: 18 * T + 8, y: 18 * T, bubble: undefined },
  { name: "person-5/up", x: place("library-2").x, y: place("library-2").y, bubble: "bubble/book" },
  { name: "person-7/right", x: place("pantry-table-1").x, y: place("pantry-table-1").y, bubble: "bubble/chat1" },
  { name: "person-8/left", x: place("pantry-table-2").x, y: place("pantry-table-2").y, bubble: "bubble/chat2" },
  { name: `${outfitFor({ slug: "echo" })}/up`, x: place("owner-drop-1").x, y: place("owner-drop-1").y },
  { name: "coder/up", x: place("notice-1").x, y: place("notice-1").y, bubble: "bubble/pr" },
].sort((a, b) => a.y - b.y);
for (const s of sprites) {
  at(props.atlas, props.pixmap, "fx/shadow", s.x - 6, s.y - 3);
  at(chars.atlas, chars.pixmap, s.name, s.x, s.y, "bottom");
  if (s.bubble) at(props.atlas, props.pixmap, s.bubble, s.x - 8, s.y - 24 - 14);
}
at(props.atlas, props.pixmap, "bubble/think3", place("desk-1").x - 8, place("desk-1").y - 21 - 14);
at(props.atlas, props.pixmap, "bubble/alert", place("desk-4").x - 8, place("desk-4").y - 21 - 14);
drawLayer("overhead");
writePng(join(outDir, "preview.png"), img, 2);

console.log(
  `office assets → ${outDir}\n  map ${map.width}×${map.height}, ${map.tilesets[0]!.tilecount} tiles, ${layout.places.length} places\n  ${Object.keys(chars.atlas.frames).length} character frames, ${Object.keys(props.atlas.frames).length} props`,
);
