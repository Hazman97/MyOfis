/**
 * The office floor plan, as data. `build.ts` turns it into a Tiled map
 * (maps/office.tmj) + tileset; the office view only ever reads the .tmj, so the
 * owner can also edit that file in Tiled directly.
 *
 * Coordinates are tiles (16 px). Rooms:
 *   server room (top left) · open office with the owner's desk and 8 agent desks
 *   meeting room (top right) · pantry (bottom right) · library corner (bottom left)
 *   entrance (bottom middle)
 */
import type { Facing, Place } from "./tmj.ts";

export const MAP_W = 40;
export const MAP_H = 24;

/** Structure cells: # wall top, = wall face, w wood, k carpet, t pantry tile, s server floor, d doorway, e entrance. */
export type Cell = "#" | "=" | "w" | "k" | "t" | "s" | "d" | "e";

const row = (...parts: [Cell, number][]) => parts.map(([c, n]) => c.repeat(n)).join("");

export const GRID: string[] = [
  row(["#", 40]),
  row(["#", 1], ["=", 6], ["#", 1], ["=", 19], ["#", 1], ["=", 11], ["#", 1]),
  row(["#", 1], ["s", 6], ["#", 1], ["w", 19], ["#", 1], ["k", 11], ["#", 1]),
  row(["#", 1], ["s", 6], ["#", 1], ["w", 19], ["#", 1], ["k", 11], ["#", 1]),
  row(["#", 1], ["s", 6], ["d", 1], ["w", 19], ["#", 1], ["k", 11], ["#", 1]),
  row(["#", 1], ["s", 6], ["#", 1], ["w", 19], ["#", 1], ["k", 11], ["#", 1]),
  row(["#", 1], ["s", 6], ["#", 1], ["w", 19], ["d", 1], ["k", 11], ["#", 1]),
  row(["#", 1], ["s", 6], ["#", 1], ["w", 19], ["d", 1], ["k", 11], ["#", 1]),
  row(["#", 8], ["w", 19], ["#", 1], ["k", 11], ["#", 1]),
  row(["#", 1], ["=", 7], ["w", 19], ["#", 1], ["k", 11], ["#", 1]),
  row(["#", 1], ["w", 26], ["#", 13]),
  row(["#", 1], ["w", 26], ["#", 1], ["=", 11], ["#", 1]),
  ...Array.from({ length: 3 }, () => row(["#", 1], ["w", 26], ["#", 1], ["t", 11], ["#", 1])),
  ...Array.from({ length: 4 }, () => row(["#", 1], ["w", 26], ["d", 1], ["t", 11], ["#", 1])),
  ...Array.from({ length: 4 }, () => row(["#", 1], ["w", 26], ["#", 1], ["t", 11], ["#", 1])),
  row(["#", 18], ["e", 2], ["#", 20]),
];

export type PieceKind =
  | "desk"
  | "owner_desk"
  | "cabinet"
  | "bookshelf"
  | "rack"
  | "plant"
  | "printer"
  | "meeting_table"
  | "pantry_table"
  | "sofa"
  | "coffee_table"
  | "counter"
  | "sink"
  | "coffee_machine"
  | "fridge"
  | "water_cooler"
  | "vending"
  | "floor_lamp"
  | "rug"
  | "door_mat"
  | "whiteboard"
  | "notice_board"
  | "window"
  | "clock"
  | "picture";

/** A piece of furniture; (x, y) is the top-left tile of its image. */
export interface Piece {
  kind: PieceKind;
  x: number;
  y: number;
  variant?: number;
}

export type ChairKind = Place["chair"];

/** Agent desks: image top-left. Desk n (1-based) is DESKS[n-1]. */
export const DESKS: [number, number][] = [
  [10, 7],
  [14, 7],
  [18, 7],
  [22, 7],
  [10, 12],
  [14, 12],
  [18, 12],
  [22, 12],
];

export const RACKS: number[] = [1, 2, 3, 4, 5]; // x of each server rack (image y = 1)

export const PIECES: Piece[] = [
  // server room
  ...RACKS.map((x) => ({ kind: "rack" as const, x, y: 1 })),
  // open office: wall side
  { kind: "picture", x: 8, y: 1, variant: 0 },
  ...[9, 10, 11, 12].map((x) => ({ kind: "cabinet" as const, x, y: 1 })),
  { kind: "picture", x: 13, y: 1, variant: 1 },
  { kind: "plant", x: 14, y: 1, variant: 1 },
  ...[15, 16, 17, 18].map((x) => ({ kind: "window" as const, x, y: 1 })),
  { kind: "plant", x: 19, y: 1, variant: 2 },
  { kind: "notice_board", x: 21, y: 1 },
  { kind: "picture", x: 23, y: 1, variant: 2 },
  { kind: "clock", x: 24, y: 1 },
  { kind: "printer", x: 25, y: 1 },
  { kind: "plant", x: 26, y: 1, variant: 3 },
  { kind: "owner_desk", x: 15, y: 3 },
  // agent desks
  ...DESKS.map(([x, y], i) => ({ kind: "desk" as const, x, y, variant: i })),
  // library corner
  { kind: "bookshelf", x: 1, y: 9, variant: 1 },
  { kind: "bookshelf", x: 3, y: 9, variant: 2 },
  { kind: "bookshelf", x: 5, y: 9, variant: 3 },
  { kind: "plant", x: 7, y: 9, variant: 4 },
  { kind: "rug", x: 2, y: 13 },
  { kind: "floor_lamp", x: 7, y: 12 },
  { kind: "plant", x: 1, y: 21, variant: 5 },
  // entrance hall
  { kind: "door_mat", x: 18, y: 22 },
  { kind: "plant", x: 16, y: 21, variant: 6 },
  { kind: "plant", x: 21, y: 21, variant: 7 },
  { kind: "plant", x: 9, y: 21, variant: 8 },
  { kind: "plant", x: 26, y: 21, variant: 9 },
  // meeting room
  { kind: "window", x: 29, y: 1 },
  { kind: "window", x: 30, y: 1 },
  { kind: "whiteboard", x: 32, y: 1 },
  { kind: "window", x: 36, y: 1 },
  { kind: "window", x: 37, y: 1 },
  { kind: "plant", x: 28, y: 1, variant: 10 },
  { kind: "plant", x: 38, y: 1, variant: 11 },
  { kind: "plant", x: 38, y: 8, variant: 12 },
  { kind: "meeting_table", x: 31, y: 5 },
  // pantry
  { kind: "fridge", x: 28, y: 11 },
  { kind: "sink", x: 29, y: 11 },
  { kind: "counter", x: 30, y: 11 },
  { kind: "coffee_machine", x: 31, y: 11 },
  { kind: "counter", x: 32, y: 11 },
  { kind: "water_cooler", x: 34, y: 11 },
  { kind: "vending", x: 36, y: 11 },
  { kind: "plant", x: 38, y: 11, variant: 13 },
  { kind: "pantry_table", x: 31, y: 16 },
  { kind: "sofa", x: 33, y: 19 },
  { kind: "coffee_table", x: 33, y: 21 },
  { kind: "plant", x: 28, y: 21, variant: 14 },
  { kind: "plant", x: 38, y: 21, variant: 15 },
];

/** Somewhere a character can be: a desk seat, another seat, or a standing spot. Tile coordinates. */
export interface PlaceDef {
  id: string;
  kind: "desk" | "seat" | "spot";
  zone: ZoneId;
  x: number;
  y: number;
  facing: Facing;
  chair?: ChairKind;
  /** Desk seats sit between two tiles (the desk is 2 wide): shift right by half a tile. */
  halfRight?: boolean;
  /** Pixel nudge up/down from the tile's bottom edge (desk seats tuck in under the desk). */
  dy?: number;
}

export type ZoneId =
  | "owner_desk"
  | "desks"
  | "server_room"
  | "meeting_room"
  | "whiteboard"
  | "notice_board"
  | "file_cabinets"
  | "library"
  | "pantry"
  | "entrance";

export const PLACES: PlaceDef[] = [
  ...DESKS.map(([x, y], i): PlaceDef => ({ id: `desk-${i + 1}`, kind: "desk", zone: "desks", x, y: y + 2, facing: "up", chair: "back", halfRight: true, dy: -5 })),
  // owner's desk: where finished work gets dropped off
  { id: "owner-drop-1", kind: "spot", zone: "owner_desk", x: 16, y: 5, facing: "up" },
  { id: "owner-drop-2", kind: "spot", zone: "owner_desk", x: 17, y: 5, facing: "up" },
  // notice board (PRs get pinned here) and file cabinets
  { id: "notice-1", kind: "spot", zone: "notice_board", x: 21, y: 2, facing: "up" },
  { id: "notice-2", kind: "spot", zone: "notice_board", x: 22, y: 2, facing: "up" },
  { id: "cabinet-1", kind: "spot", zone: "file_cabinets", x: 10, y: 3, facing: "up" },
  { id: "cabinet-2", kind: "spot", zone: "file_cabinets", x: 12, y: 3, facing: "up" },
  // library
  { id: "library-1", kind: "spot", zone: "library", x: 2, y: 11, facing: "up" },
  { id: "library-2", kind: "spot", zone: "library", x: 4, y: 11, facing: "up" },
  { id: "library-3", kind: "spot", zone: "library", x: 6, y: 11, facing: "up" },
  { id: "library-seat-1", kind: "seat", zone: "library", x: 2, y: 14, facing: "down", chair: "arm" },
  { id: "library-seat-2", kind: "seat", zone: "library", x: 5, y: 14, facing: "down", chair: "arm" },
  // meeting room
  ...[31, 32, 33, 34].map((x, i): PlaceDef => ({ id: `meeting-${i + 1}`, kind: "seat", zone: "meeting_room", x, y: 4, facing: "down", chair: "front" })),
  ...[31, 32, 33, 34].map((x, i): PlaceDef => ({ id: `meeting-${i + 5}`, kind: "seat", zone: "meeting_room", x, y: 7, facing: "up", chair: "back" })),
  { id: "whiteboard-1", kind: "spot", zone: "whiteboard", x: 32, y: 2, facing: "up" },
  { id: "whiteboard-2", kind: "spot", zone: "whiteboard", x: 33, y: 2, facing: "up" },
  // pantry
  { id: "pantry-sink", kind: "spot", zone: "pantry", x: 29, y: 13, facing: "up" },
  { id: "pantry-coffee", kind: "spot", zone: "pantry", x: 31, y: 13, facing: "up" },
  { id: "pantry-water", kind: "spot", zone: "pantry", x: 34, y: 13, facing: "up" },
  { id: "pantry-table-1", kind: "spot", zone: "pantry", x: 30, y: 16, facing: "right" },
  { id: "pantry-table-2", kind: "spot", zone: "pantry", x: 33, y: 16, facing: "left" },
  { id: "pantry-table-3", kind: "spot", zone: "pantry", x: 31, y: 15, facing: "down" },
  { id: "pantry-table-4", kind: "spot", zone: "pantry", x: 32, y: 17, facing: "up" },
  ...[33, 34, 35].map((x, i): PlaceDef => ({ id: `sofa-${i + 1}`, kind: "seat", zone: "pantry", x, y: 20, facing: "down", chair: "none" })),
  // entrance: spawn / go home
  { id: "entrance-1", kind: "spot", zone: "entrance", x: 18, y: 23, facing: "down" },
  { id: "entrance-2", kind: "spot", zone: "entrance", x: 19, y: 23, facing: "down" },
];

/** Zone rectangles (inclusive tile bounds). */
export const ZONES: Record<ZoneId, [number, number, number, number]> = {
  server_room: [1, 2, 6, 7],
  owner_desk: [14, 2, 19, 5],
  file_cabinets: [9, 2, 12, 3],
  notice_board: [20, 2, 23, 3],
  desks: [9, 7, 24, 14],
  library: [1, 10, 8, 17],
  meeting_room: [28, 2, 38, 9],
  whiteboard: [31, 2, 34, 3],
  pantry: [28, 12, 38, 22],
  entrance: [16, 20, 21, 23],
};

/** Live props placed by the map (positions in tiles; the builder converts to pixels). */
export const OWNER_CHAIR: [number, number] = [16, 2]; // left tile of the 2 tiles behind the owner's desk
export const SERVER_LAMP: [number, number] = [6, 1];
