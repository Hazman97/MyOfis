/**
 * The subset of the Tiled JSON map format (.tmj) the office uses, plus the
 * parser that turns a map into an OfficeLayout. Pure: no Phaser, no DOM.
 */
export interface TiledProperty {
  name: string;
  type: "string" | "int" | "bool" | "float";
  value: string | number | boolean;
}

export interface TiledObject {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  point?: boolean;
  properties?: TiledProperty[];
}

export interface TiledTileLayer {
  id: number;
  name: string;
  type: "tilelayer";
  width: number;
  height: number;
  x: 0;
  y: 0;
  opacity: number;
  visible: boolean;
  data: number[];
}

export interface TiledObjectLayer {
  id: number;
  name: string;
  type: "objectgroup";
  draworder: "topdown";
  x: 0;
  y: 0;
  opacity: number;
  visible: boolean;
  objects: TiledObject[];
}

export interface TiledTileset {
  firstgid: number;
  name: string;
  image: string;
  imagewidth: number;
  imageheight: number;
  tilewidth: number;
  tileheight: number;
  tilecount: number;
  columns: number;
  margin: 0;
  spacing: 0;
  tiles?: { id: number; properties?: TiledProperty[] }[];
}

export interface TiledMap {
  type: "map";
  version: string;
  tiledversion: string;
  orientation: "orthogonal";
  renderorder: "right-down";
  infinite: false;
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  nextlayerid: number;
  nextobjectid: number;
  layers: (TiledTileLayer | TiledObjectLayer)[];
  tilesets: TiledTileset[];
  properties?: TiledProperty[];
}

/** Tile layers the office view draws, bottom to top. Characters go between "furniture" and "overhead". */
export const TILE_LAYERS = ["floor", "walls", "furniture", "overhead", "collision"] as const;
export const OBJECT_LAYERS = ["places", "props", "zones"] as const;

export const REQUIRED_ZONES = [
  "owner_desk",
  "desks",
  "server_room",
  "meeting_room",
  "whiteboard",
  "notice_board",
  "file_cabinets",
  "library",
  "pantry",
  "entrance",
] as const;

export type Facing = "up" | "down" | "left" | "right";

export interface Place {
  id: string;
  kind: "desk" | "seat" | "spot";
  zone: string;
  facing: Facing;
  chair: "back" | "front" | "arm" | "none";
  /** Where the character's feet go, in pixels. */
  x: number;
  y: number;
  /** The tile to walk to. */
  tx: number;
  ty: number;
}

export interface MapProp {
  id: number;
  type: string;
  name: string;
  x: number;
  y: number;
  props: Record<string, string | number | boolean>;
}

export interface OfficeLayout {
  width: number;
  height: number;
  tileSize: number;
  /** 1 = cannot walk, row-major width*height. */
  blocked: Uint8Array;
  places: Place[];
  props: MapProp[];
  zones: Record<string, { x: number; y: number; w: number; h: number }>;
  /** Art files next to the map (configurable through map properties). */
  assets: { characters: string; props: string };
}

const propsOf = (o: { properties?: TiledProperty[] }) =>
  Object.fromEntries((o.properties ?? []).map((p) => [p.name, p.value])) as Record<string, string | number | boolean>;

const FACINGS = new Set<Facing>(["up", "down", "left", "right"]);

export class MapError extends Error {}

/** Read a Tiled map into the shape the office view and the character brain need. */
export function parseOfficeMap(map: TiledMap): OfficeLayout {
  if (map.orientation !== "orthogonal" || map.tilewidth !== map.tileheight) throw new MapError("office map must be orthogonal with square tiles");
  const size = map.tilewidth;
  const tileLayer = (name: string) => map.layers.find((l): l is TiledTileLayer => l.type === "tilelayer" && l.name === name);
  const objectLayer = (name: string) => map.layers.find((l): l is TiledObjectLayer => l.type === "objectgroup" && l.name === name);

  const collision = tileLayer("collision");
  if (!collision) throw new MapError('office map needs a "collision" tile layer');
  if (collision.data.length !== map.width * map.height) throw new MapError("collision layer size does not match the map");
  const blocked = new Uint8Array(map.width * map.height);
  collision.data.forEach((gid, i) => (blocked[i] = gid ? 1 : 0));

  const tileOf = (px: number) => Math.floor((px - 1) / size);
  const places: Place[] = [];
  for (const o of objectLayer("places")?.objects ?? []) {
    const p = propsOf(o);
    const kind = o.type as Place["kind"];
    if (kind !== "desk" && kind !== "seat" && kind !== "spot") continue;
    const facing = (FACINGS.has(p.facing as Facing) ? p.facing : "down") as Facing;
    const tx = tileOf(o.x);
    const ty = tileOf(o.y);
    if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) throw new MapError(`place "${o.name}" is outside the map`);
    places.push({
      id: o.name,
      kind,
      zone: String(p.zone ?? ""),
      facing,
      chair: (["back", "front", "arm", "none"].includes(String(p.chair)) ? p.chair : "none") as Place["chair"],
      x: o.x,
      y: o.y,
      tx,
      ty,
    });
  }

  const zones: OfficeLayout["zones"] = {};
  for (const o of objectLayer("zones")?.objects ?? []) zones[o.name] = { x: o.x, y: o.y, w: o.width, h: o.height };
  const missing = REQUIRED_ZONES.filter((z) => !zones[z]);
  if (missing.length) throw new MapError(`office map is missing zones: ${missing.join(", ")}`);
  if (!places.some((p) => p.kind === "desk")) throw new MapError("office map has no desks");
  if (!places.some((p) => p.zone === "entrance")) throw new MapError("office map has no entrance spot");

  const props: MapProp[] = (objectLayer("props")?.objects ?? []).map((o) => ({ id: o.id, type: o.type, name: o.name, x: o.x, y: o.y, props: propsOf(o) }));
  const mapProps = propsOf(map);
  return {
    width: map.width,
    height: map.height,
    tileSize: size,
    blocked,
    places,
    props,
    zones,
    assets: { characters: String(mapProps.characters ?? "characters.json"), props: String(mapProps.props ?? "props.json") },
  };
}

export const isBlocked = (l: OfficeLayout, x: number, y: number) =>
  x < 0 || y < 0 || x >= l.width || y >= l.height || l.blocked[y * l.width + x] === 1;
