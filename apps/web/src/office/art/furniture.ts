import { blit, box, createPixmap, fillRect, noise, setPixel, sprite, type Pixmap } from "./pixmap.ts";
import { P } from "./palette.ts";

/**
 * Furniture and room pieces, drawn at 1 px = 1 art pixel. Sizes are multiples
 * of the 16 px tile; the map cuts them into tiles. "Tall" pieces (cabinets,
 * shelves, racks, plants) are 2 tiles high: the bottom tile is the footprint,
 * the top tile overlaps the wall face or floor behind.
 */
export const TILE = 16;

const L = {
  O: P.outline,
  D: P.deskTop,
  d: P.deskEdge,
  L: P.deskLight,
  M: P.monitor,
  m: P.metalDark,
  X: P.screenOff,
  k: P.keyboard,
  K: P.metal,
  p: P.paper,
  P: P.paperShade,
  w: "#f4f2ec",
  r: "#c0453d",
  g: P.leaf,
  G: P.leafDark,
  l: P.leafLight,
  o: P.pot,
  q: P.potDark,
};

/** Agent desk, 2×2 tiles. Monitor screen area is SCREEN_RECT (the screen prop goes there). */
export const SCREEN_RECT = { x: 11, y: 3, w: 10, h: 7 };

const DESK_ROWS = [
  "................................",
  ".........OOOOOOOOOOOOOO.........",
  ".........OMMMMMMMMMMMMO.........",
  ".........OMXXXXXXXXXXMO.........",
  ".........OMXXXXXXXXXXMO.........",
  ".OOOOOOOOOMXXXXXXXXXXMOOOOOOOOO.",
  ".OLLLLLLLOMXXXXXXXXXXMOLLLLLLLO.",
  ".ODDDDDDDOMXXXXXXXXXXMODDDDDDDO.",
  ".ODDDDDDDOMXXXXXXXXXXMODDDDDDDO.",
  ".ODDDDDDDOMXXXXXXXXXXMODDDDDDDO.",
  ".ODDDDDDDOMMMMMMMMMMMMODDDDDDDO.",
  ".ODDDDDDDOOOOOOmmOOOOOODDDDDDDO.",
  ".ODDDDDDDDDDDOmmmmODDDDDDDDDDDO.",
  ".ODDDDDDDDDDDOOOOOODDDDDDDDDDDO.",
  ".ODDDDDDDDDDDDDDDDDDDDDDDDDDDDO.",
  ".ODDDDDDDOkkkkkkkkkkkkODDDDDDDO.",
  ".ODDDDDDDOkKkKkKkKkKkkODDDDDDDO.",
  ".ODDDDDDDOkkkkkkkkkkkkODDDDDDDO.",
  ".ODDDDDDDOOOOOOOOOOOOOODDDDDDDO.",
  ".ODDDDDDDDDDDDDDDDDDDDDDDDDDDDO.",
  ".ODDDDDDDDDDDDDDDDDDDDDDDDDDDDO.",
  ".ODDDDDDDDDDDDDDDDDDDDDDDDDDDDO.",
  ".ODDDDDDDDDDDDDDDDDDDDDDDDDDDDO.",
  ".OLLLLLLLLLLLLLLLLLLLLLLLLLLLLO.",
  ".OddddddddddddddddddddddddddddO.",
  ".OddddddddddddddddddddddddddddO.",
  ".OddddddddddddddddddddddddddddO.",
  ".OOOOOOOOOOOOOOOOOOOOOOOOOOOOOO.",
  "..OdO......................OdO..",
  "..OdO......................OdO..",
  "..OOO......................OOO..",
  "................................",
];

const DESK_ITEMS: Record<string, { x: number; y: number; rows: string[] }> = {
  mug: { x: 4, y: 12, rows: ["Owww.", "Owrww", "Owww."] },
  papers: { x: 24, y: 13, rows: ["pppp", "pPPp", "pppp", "PPPP"] },
  plant: { x: 3, y: 6, rows: [".gl.", "glgg", "gGlg", ".qo.", ".oo."] },
  books: { x: 23, y: 7, rows: ["rrrr", "OOOO", "KKKK", "OOOO", "llll"] },
};

/** Four looks so a row of desks does not look copy-pasted. */
export function desk(variant: number): Pixmap {
  const px = sprite("desk", DESK_ROWS, L);
  const items = [
    ["mug", "papers"],
    ["plant", "papers"],
    ["mug", "books"],
    ["plant", "books"],
  ][variant % 4]!;
  for (const name of items) {
    const it = DESK_ITEMS[name]!;
    blit(px, sprite(name, it.rows, L), it.x, it.y);
  }
  return px;
}

/** The owner's desk, 4×2 tiles, front panel towards the viewer. TRAY_POS is where the in-tray prop goes. */
export const TRAY_POS = { x: 44, y: 4 };

export function ownerDesk(): Pixmap {
  const px = createPixmap(64, 32);
  // top surface
  box(px, 1, 4, 62, 20, "#7a4e30", P.outline);
  fillRect(px, 2, 5, 60, 1, "#91603d");
  for (let x = 2; x < 62; x++) if (noise(x, 1, 3) > 0.85) setPixel(px, x, 10 + Math.floor(noise(x, 2) * 10), "#6f462b");
  // front (modesty) panel with an inset
  box(px, 1, 23, 62, 8, "#5f3b24", P.outline);
  fillRect(px, 2, 23, 60, 1, "#91603d");
  box(px, 8, 25, 48, 4, "#6b432a", "#4f311e");
  // laptop, seen from behind (the owner sits on the far side)
  box(px, 24, 6, 16, 9, "#c7cfcb", P.outline);
  fillRect(px, 25, 7, 14, 1, "#dde3e0");
  setPixel(px, 31, 10, "#9aa5a0");
  setPixel(px, 32, 10, "#9aa5a0");
  box(px, 22, 15, 20, 3, "#a7b1ad", P.outline);
  // desk lamp
  box(px, 5, 14, 6, 3, "#2f3a36", P.outline);
  fillRect(px, 7, 8, 2, 6, "#2f3a36");
  box(px, 4, 5, 8, 4, "#e0a33a", P.outline);
  fillRect(px, 5, 8, 6, 1, "#f7d27a");
  // nameplate
  box(px, 26, 19, 12, 4, "#e9c46a", P.outline);
  fillRect(px, 28, 21, 8, 1, "#876000");
  // pen cup
  box(px, 15, 13, 4, 5, "#3d82d6", P.outline);
  setPixel(px, 16, 11, "#e0444f");
  setPixel(px, 16, 12, "#e0444f");
  setPixel(px, 17, 12, "#2f3a36");
  return px;
}

/** Executive chair facing the viewer (sits behind the owner's desk, nobody uses it in-game). */
export function execChair(): Pixmap {
  return sprite(
    "exec-chair",
    [
      "....OOOOOOOO....",
      "...OCcccccccCO..",
      "...OCCCCCCCCO...",
      "...OCCCCCCCCO...",
      "...OCCCCCCCCO...",
      "...OCCCCCCCCO...",
      "..OOCCCCCCCCOO..",
      "..OcOCCCCCCOcO..",
      "..OcOccccccOcO..",
      "..OOOOOOOOOOOO..",
      "......OMMO......",
      "....OMMMMMMO....",
      "....OO....OO....",
    ].map((r) => r.padEnd(16, ".").slice(0, 16)),
    { O: P.outline, C: "#3b2f2a", c: "#54443c", M: P.metalDark },
  );
}

/** Metal filing cabinet, 1×2 tiles. */
export function cabinet(): Pixmap {
  const px = createPixmap(16, 32);
  box(px, 1, 6, 14, 25, P.metal, P.outline);
  fillRect(px, 2, 7, 12, 2, P.metalLight);
  for (const y of [10, 17, 24]) {
    box(px, 2, y, 12, 6, "#b9c2be", P.metalDark);
    box(px, 5, y + 1, 6, 2, P.paper, P.metalDark);
    fillRect(px, 6, y + 4, 4, 1, P.outline);
  }
  fillRect(px, 1, 31, 14, 1, "#00000033");
  return px;
}

const BOOK_COLOURS = [P.bookA, P.bookB, P.bookC, P.bookD, P.bookE, "#d9d4c4", "#2f3a36"];

/** Bookshelf, 2×2 tiles, three shelves of books. */
export function bookshelf(seed: number): Pixmap {
  const px = createPixmap(32, 32);
  box(px, 0, 2, 32, 30, P.shelf, P.outline);
  fillRect(px, 1, 3, 30, 1, "#8d6239");
  for (const [i, top] of [4, 13, 22].entries()) {
    fillRect(px, 2, top, 28, 8, P.shelfDark);
    let x = 2;
    while (x < 29) {
      const w = 2 + Math.floor(noise(x, i, seed) * 2);
      const h = 5 + Math.floor(noise(x, i + 9, seed) * 3);
      if (noise(x, i + 20, seed) > 0.88) {
        x += 2; // gap
        continue;
      }
      const c = BOOK_COLOURS[Math.floor(noise(x, i + 30, seed) * BOOK_COLOURS.length)]!;
      fillRect(px, x, top + 8 - h, Math.min(w, 30 - x), h, c);
      setPixel(px, x, top + 8 - h, "#ffffff40");
      x += w;
    }
    fillRect(px, 1, top + 8, 30, 1, P.outline);
  }
  return px;
}

/** Server rack, 1×2 tiles. LED sockets at RACK_LEDS (the live LED prop draws over them). */
export const RACK_LEDS = { x: 11, y: 8, rows: 6, step: 3 };

export function serverRack(): Pixmap {
  const px = createPixmap(16, 32);
  box(px, 1, 2, 14, 29, P.rack, P.outline);
  fillRect(px, 2, 3, 12, 1, P.rackLight);
  for (let i = 0; i < RACK_LEDS.rows; i++) {
    const y = RACK_LEDS.y + i * RACK_LEDS.step;
    fillRect(px, 3, y, 10, 2, P.rackLight);
    fillRect(px, 4, y, 5, 1, "#232b28");
    setPixel(px, RACK_LEDS.x, y, "#151b19");
    setPixel(px, RACK_LEDS.x + 1, y, "#151b19");
  }
  fillRect(px, 3, 27, 10, 2, "#232b28");
  fillRect(px, 1, 31, 14, 1, "#00000040");
  return px;
}

/** Potted plant, 1×2 tiles. */
export function plant(seed: number): Pixmap {
  const px = createPixmap(16, 32);
  // leaves: overlapping blobs
  const blobs = [
    [8, 10, 5],
    [5, 14, 4],
    [11, 14, 4],
    [8, 17, 4],
    [4, 9, 3],
    [12, 9, 3],
  ] as const;
  for (const [cx, cy, r] of blobs)
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > r) continue;
        const n = noise(x, y, seed);
        setPixel(px, x, y + 2, d > r - 1 ? P.leafDark : n > 0.7 ? P.leafLight : P.leaf);
      }
  // pot
  box(px, 4, 23, 8, 8, P.pot, P.outline);
  fillRect(px, 5, 24, 6, 1, "#cf7a2a");
  fillRect(px, 4, 31, 8, 1, "#00000033");
  return px;
}

/** Laser printer, 1×2 tiles (short: top tile mostly empty). */
export function printer(): Pixmap {
  const px = createPixmap(16, 32);
  box(px, 1, 14, 14, 16, "#e3e7e5", P.outline);
  fillRect(px, 2, 15, 12, 2, "#f4f6f5");
  box(px, 3, 11, 10, 4, P.paper, P.outline);
  fillRect(px, 3, 20, 10, 2, "#2f3a36");
  setPixel(px, 12, 25, P.ledGreen);
  fillRect(px, 3, 25, 6, 1, P.metalDark);
  fillRect(px, 1, 30, 14, 1, P.outline);
  fillRect(px, 1, 31, 14, 1, "#00000033");
  return px;
}

/** Meeting table, 4×2 tiles. */
export function meetingTable(): Pixmap {
  const px = createPixmap(64, 32);
  box(px, 2, 3, 60, 22, "#9a6a43", P.outline);
  fillRect(px, 3, 4, 58, 1, "#b07d52");
  box(px, 2, 24, 60, 4, "#6e4730", P.outline);
  fillRect(px, 6, 28, 3, 3, P.outline);
  fillRect(px, 55, 28, 3, 3, P.outline);
  // papers and a laptop on the table
  box(px, 10, 8, 8, 6, P.paper, P.paperShade);
  box(px, 44, 12, 8, 6, P.paper, P.paperShade);
  box(px, 26, 9, 12, 8, "#c7cfcb", P.outline);
  fillRect(px, 27, 10, 10, 5, "#2b3a4a");
  box(px, 24, 17, 16, 3, P.metal, P.outline);
  // water glasses
  box(px, 50, 6, 3, 4, P.glassLight, P.frame);
  box(px, 14, 17, 3, 4, P.glassLight, P.frame);
  return px;
}

/** Small round pantry table, 2×1 tiles. */
export function pantryTable(): Pixmap {
  const px = createPixmap(32, 16);
  box(px, 2, 1, 28, 10, "#e9ecea", P.outline);
  fillRect(px, 3, 2, 26, 1, "#ffffff");
  fillRect(px, 14, 11, 4, 4, P.metalDark);
  fillRect(px, 10, 15, 12, 1, P.outline);
  box(px, 7, 4, 4, 4, "#f4f2ec", P.outline); // cup
  setPixel(px, 8, 5, "#6b4b3a");
  box(px, 20, 3, 6, 4, P.bookC, P.outline); // snack box
  return px;
}

/** Sofa facing the viewer, 3×2 tiles: back row (blocked) + seat row. */
export function sofa(): Pixmap {
  const px = createPixmap(48, 32);
  box(px, 2, 6, 44, 14, P.sofaDark, P.outline); // back
  fillRect(px, 3, 7, 42, 2, P.sofaLight);
  box(px, 0, 14, 7, 16, P.sofa, P.outline); // left arm
  box(px, 41, 14, 7, 16, P.sofa, P.outline); // right arm
  box(px, 6, 18, 36, 11, P.sofa, P.outline); // seat
  fillRect(px, 7, 19, 34, 2, P.sofaLight);
  fillRect(px, 18, 19, 1, 9, P.sofaDark);
  fillRect(px, 30, 19, 1, 9, P.sofaDark);
  fillRect(px, 2, 30, 44, 1, "#00000033");
  return px;
}

export function coffeeTable(): Pixmap {
  const px = createPixmap(48, 16);
  box(px, 4, 2, 40, 9, "#6b4b3a", P.outline);
  fillRect(px, 5, 3, 38, 1, "#86604a");
  fillRect(px, 7, 11, 2, 4, P.outline);
  fillRect(px, 39, 11, 2, 4, P.outline);
  box(px, 12, 4, 8, 5, P.paper, P.paperShade); // magazine
  fillRect(px, 13, 6, 5, 1, P.bookB);
  box(px, 30, 4, 4, 4, "#f4f2ec", P.outline);
  return px;
}

/** Kitchen counter, 1×2 tiles: backsplash on the wall above, counter + cupboard on the floor tile. */
export function counter(kind: "plain" | "sink" | "coffee"): Pixmap {
  const px = createPixmap(16, 32);
  // backsplash tiles
  fillRect(px, 0, 6, 16, 10, "#e8eeea");
  for (let y = 6; y < 16; y += 4) fillRect(px, 0, y, 16, 1, "#cfd8d2");
  for (let x = 3; x < 16; x += 6) fillRect(px, x, 6, 1, 10, "#cfd8d2");
  // counter top + cupboard
  fillRect(px, 0, 16, 16, 4, "#d9dfdc");
  fillRect(px, 0, 16, 16, 1, "#eef2f0");
  fillRect(px, 0, 20, 16, 1, P.outline);
  fillRect(px, 0, 21, 16, 10, "#7a8f86");
  fillRect(px, 7, 21, 1, 10, "#5f7169");
  fillRect(px, 5, 25, 1, 2, P.metalLight);
  fillRect(px, 9, 25, 1, 2, P.metalLight);
  fillRect(px, 0, 31, 16, 1, P.outline);
  if (kind === "sink") {
    box(px, 3, 16, 10, 4, "#a7b1ad", P.metalDark);
    fillRect(px, 7, 11, 2, 5, P.metal);
    fillRect(px, 7, 11, 4, 1, P.metal);
  }
  if (kind === "coffee") {
    box(px, 3, 5, 10, 13, "#2f3633", P.outline);
    fillRect(px, 4, 6, 8, 2, "#4a5450");
    setPixel(px, 10, 9, P.ledRed);
    fillRect(px, 5, 11, 6, 1, "#151b19");
    box(px, 6, 13, 4, 4, "#f4f2ec", P.outline);
  }
  return px;
}

export function fridge(): Pixmap {
  const px = createPixmap(16, 32);
  box(px, 1, 2, 14, 29, "#e9eeeb", P.outline);
  fillRect(px, 2, 3, 12, 1, "#ffffff");
  fillRect(px, 1, 12, 14, 1, P.metalDark);
  fillRect(px, 12, 6, 1, 4, P.metalDark);
  fillRect(px, 12, 15, 1, 6, P.metalDark);
  box(px, 4, 16, 4, 4, P.bookC, P.outline); // magnet note
  fillRect(px, 1, 31, 14, 1, "#00000033");
  return px;
}

export function waterCooler(): Pixmap {
  const px = createPixmap(16, 32);
  box(px, 4, 3, 8, 9, P.water, "#3d82d6");
  fillRect(px, 5, 4, 2, 6, "#c9ecfb");
  box(px, 3, 12, 10, 18, "#e9eeeb", P.outline);
  fillRect(px, 5, 16, 2, 2, "#3d82d6");
  fillRect(px, 9, 16, 2, 2, P.ledRed);
  box(px, 5, 21, 6, 2, P.metalDark, P.outline);
  fillRect(px, 3, 30, 10, 1, "#00000033");
  return px;
}

export function vendingMachine(): Pixmap {
  const px = createPixmap(16, 32);
  box(px, 0, 2, 16, 29, "#c0453d", P.outline);
  box(px, 2, 4, 9, 18, "#2b3a4a", P.outline);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 3; c++) setPixel(px, 4 + c * 2, 7 + r * 4, [P.bookC, P.bookD, P.bookB, "#f4f2ec"][(r + c) % 4]!);
  for (let r = 0; r < 4; r++) fillRect(px, 3, 9 + r * 4, 7, 1, "#3f5266");
  box(px, 12, 6, 3, 6, "#2f3633", P.outline);
  box(px, 3, 24, 8, 4, "#2f3633", P.outline);
  return px;
}

export function floorLamp(): Pixmap {
  const px = createPixmap(16, 32);
  box(px, 4, 4, 8, 6, "#f2d27a", P.outline);
  fillRect(px, 5, 9, 6, 1, "#ffe8a8");
  fillRect(px, 7, 10, 2, 18, "#2f3a36");
  box(px, 4, 27, 8, 3, "#2f3a36", P.outline);
  return px;
}

/** Rug for the library corner, 4×3 tiles. Drawn on the furniture layer (does not block). */
export function rug(w: number, h: number, main: string, edge: string): Pixmap {
  const px = createPixmap(w, h);
  box(px, 1, 1, w - 2, h - 2, main, edge);
  box(px, 4, 4, w - 8, h - 8, main, edge);
  for (let x = 6; x < w - 6; x += 4) setPixel(px, x, Math.floor(h / 2), edge);
  for (let x = 2; x < w - 2; x += 2) {
    setPixel(px, x, 0, edge);
    setPixel(px, x, h - 1, edge);
  }
  return px;
}

export function doorMat(): Pixmap {
  const px = createPixmap(32, 16);
  box(px, 1, 3, 30, 11, P.mat, P.outline);
  for (let x = 3; x < 29; x += 2) fillRect(px, x, 5, 1, 7, P.matLight);
  return px;
}

// ------------------------------------------------------------- wall decorations (drawn over a wall face)

export function whiteboard(): Pixmap {
  const px = createPixmap(32, 16);
  box(px, 1, 1, 30, 12, P.board, P.frame);
  // a bar chart and a couple of lines
  fillRect(px, 4, 8, 2, 3, P.ink);
  fillRect(px, 7, 6, 2, 5, P.ink);
  fillRect(px, 10, 4, 2, 7, P.inkRed);
  fillRect(px, 15, 4, 12, 1, P.ink);
  fillRect(px, 15, 7, 9, 1, "#3f8f5f");
  fillRect(px, 15, 10, 11, 1, P.ink);
  fillRect(px, 3, 13, 26, 2, P.metalDark); // marker tray
  setPixel(px, 8, 13, P.inkRed);
  setPixel(px, 10, 13, P.ink);
  return px;
}

/** Cork notice board. PR notes get pinned at NOTICE_SLOTS (props). */
export const NOTICE_SLOTS = [
  { x: 3, y: 3 },
  { x: 11, y: 2 },
  { x: 19, y: 3 },
  { x: 7, y: 8 },
  { x: 15, y: 8 },
  { x: 23, y: 8 },
];

export function noticeBoard(): Pixmap {
  const px = createPixmap(32, 16);
  box(px, 1, 1, 30, 14, P.cork, P.shelf);
  for (let y = 2; y < 14; y++) for (let x = 2; x < 30; x++) if (noise(x, y, 77) > 0.8) setPixel(px, x, y, P.corkDark);
  // one permanent memo
  box(px, 25, 3, 4, 4, P.paper, P.paperShade);
  setPixel(px, 26, 3, P.pinBlue);
  return px;
}

export function windowPane(): Pixmap {
  const px = createPixmap(16, 16);
  box(px, 1, 2, 14, 11, P.glass, P.frame);
  fillRect(px, 2, 3, 12, 1, P.glassLight);
  fillRect(px, 7, 3, 1, 9, P.frame);
  setPixel(px, 3, 5, P.glassLight);
  setPixel(px, 4, 4, P.glassLight);
  setPixel(px, 10, 6, P.glassLight);
  fillRect(px, 0, 13, 16, 1, P.frame); // sill
  return px;
}

export function wallClock(): Pixmap {
  return sprite(
    "clock",
    [
      "................",
      "................",
      ".....OOOOOO.....",
      "....OwwwwwwO....",
      "...OwwwOwwwwO...",
      "...OwwwOwwwwO...",
      "...OwwwOwwwwO...",
      "...OwwwOOOwwO...",
      "...OwwwwwwwwO...",
      "...OwwwwwwwwO...",
      "....OwwwwwwO....",
      ".....OOOOOO.....",
      "................",
      "................",
      "................",
      "................",
    ],
    { O: P.outline, w: "#f7f6f0" },
  );
}

export function picture(seed: number): Pixmap {
  const px = createPixmap(16, 16);
  box(px, 2, 2, 12, 10, "#f0e9da", "#6b4b3a");
  const hue = [P.bookB, P.bookD, P.bookC][seed % 3]!;
  fillRect(px, 4, 7, 8, 3, hue);
  fillRect(px, 6, 5, 3, 2, P.rug);
  setPixel(px, 10, 4, "#f0c640");
  return px;
}
