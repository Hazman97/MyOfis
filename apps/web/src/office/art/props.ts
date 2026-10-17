import { blit, box, clearPixel, createPixmap, fillRect, setPixel, sprite, type Pixmap } from "./pixmap.ts";
import { P } from "./palette.ts";
import { CHAIR_BACK_ROWS } from "./characters.ts";
import { RACK_LEDS, SCREEN_RECT, execChair } from "./furniture.ts";

/**
 * Live props: things the office view swaps or animates at runtime (screens,
 * LEDs, lamps, chairs, speech bubbles). Packed into props.png + an atlas.
 */

// ------------------------------------------------------------------ screens (SCREEN_RECT sized)

function screen(fill: string): Pixmap {
  const px = createPixmap(SCREEN_RECT.w, SCREEN_RECT.h);
  fillRect(px, 0, 0, px.w, px.h, fill);
  return px;
}

function screens(): Record<string, Pixmap> {
  const off = screen(P.screenOff);
  setPixel(off, 1, 1, "#2a3531");
  setPixel(off, 2, 1, "#2a3531");

  const idle = screen("#1f3a33");
  fillRect(idle, 1, 1, 3, 2, "#2f6e5a");
  fillRect(idle, 1, 4, 3, 2, "#2f6e5a");
  fillRect(idle, 6, 5, 3, 1, "#3fc296");

  const code = (shift: number) => {
    const px = screen("#14201c");
    const lines = [
      [1, 5, "#3fc296"],
      [2, 6, "#e9c46a"],
      [2, 4, "#63b6e8"],
      [1, 7, "#3fc296"],
      [3, 3, "#e9c46a"],
      [1, 6, "#63b6e8"],
      [2, 5, "#3fc296"],
    ] as const;
    for (let y = 0; y < px.h; y++) {
      const [x, w, c] = lines[(y + shift) % lines.length]!;
      fillRect(px, x, y, w, 1, c);
    }
    if (shift % 2) setPixel(px, 8, px.h - 1, "#ffffff");
    return px;
  };

  const browser = screen("#eef3f1");
  fillRect(browser, 0, 0, browser.w, 2, "#3d82d6");
  setPixel(browser, 1, 0, "#ff7a85");
  fillRect(browser, 1, 3, 4, 3, "#9fc9e8");
  fillRect(browser, 6, 3, 3, 1, "#8a9a92");
  fillRect(browser, 6, 5, 3, 1, "#8a9a92");

  const alert = screen("#3a2a10");
  fillRect(alert, 4, 1, 2, 3, P.ledAmber);
  fillRect(alert, 4, 5, 2, 1, P.ledAmber);

  const done = screen("#123326");
  for (const [x, y] of [
    [2, 3],
    [3, 4],
    [4, 5],
    [5, 4],
    [6, 3],
    [7, 2],
  ] as const)
    setPixel(done, x, y, P.ledGreen);

  const failed = screen("#3a1418");
  for (let i = 0; i < 5; i++) {
    setPixel(failed, 2 + i, 1 + i, P.ledRed);
    setPixel(failed, 6 - i, 1 + i, P.ledRed);
  }

  return {
    "screen/off": off,
    "screen/idle": idle,
    "screen/code1": code(0),
    "screen/code2": code(3),
    "screen/browser": browser,
    "screen/alert": alert,
    "screen/done": done,
    "screen/failed": failed,
  };
}

// ------------------------------------------------------------------ server room

function rackLeds(pattern: (row: number) => [string, string] | null): Pixmap {
  const px = createPixmap(16, 32);
  for (let i = 0; i < RACK_LEDS.rows; i++) {
    const c = pattern(i);
    if (!c) continue;
    const y = RACK_LEDS.y + i * RACK_LEDS.step;
    setPixel(px, RACK_LEDS.x, y, c[0]);
    setPixel(px, RACK_LEDS.x + 1, y, c[1]);
  }
  return px;
}

function lamp(colour: string, glow: string): Pixmap {
  const px = createPixmap(16, 16);
  box(px, 5, 8, 6, 3, "#2f3a36", P.outline);
  box(px, 5, 3, 6, 6, colour, P.outline);
  setPixel(px, 6, 4, "#ffffffaa");
  for (const [x, y] of [
    [3, 4],
    [12, 4],
    [4, 2],
    [11, 2],
    [8, 1],
  ] as const)
    setPixel(px, x, y, glow);
  return px;
}

// ------------------------------------------------------------------ owner's in-tray

function tray(papers: number): Pixmap {
  const px = createPixmap(16, 16);
  for (let i = 0; i < papers; i++) box(px, 2, 8 - i * 2, 12, 5, P.paper, P.paperShade);
  box(px, 1, 9, 14, 5, "#6b4b3a", P.outline);
  fillRect(px, 2, 10, 12, 1, "#86604a");
  return px;
}

function note(colour: string): Pixmap {
  const px = createPixmap(6, 6);
  box(px, 0, 1, 6, 5, colour, "#00000033");
  fillRect(px, 1, 3, 4, 1, "#00000040");
  setPixel(px, 2, 0, P.pinRed);
  setPixel(px, 2, 1, P.pinRed);
  return px;
}

// ------------------------------------------------------------------ chairs

const CHAIR_LEGEND = { O: P.outline, C: P.chair, c: P.chairLight, M: P.metalDark };

function chairFront(): Pixmap {
  return sprite(
    "chair-front",
    [
      "....OOOOOOOO....",
      "...OCcccccccO...",
      "...OCCCCCCCCO...",
      "...OCCCCCCCCO...",
      "...OCCCCCCCCO...",
      "..OOOOOOOOOOOO..",
      "..OcccccccccccO.",
      "..OCCCCCCCCCCO..",
      "...OOOOOOOOOO...",
      "......OMMO......",
      "....OMMMMMMO....",
      "....OO....OO....",
    ].map((r) => r.padEnd(16, ".").slice(0, 16)),
    CHAIR_LEGEND,
  );
}

function armchair(): Pixmap {
  return sprite(
    "armchair",
    [
      "...OOOOOOOOOO...",
      "..OAaaaaaaaaAO..",
      "..OAAAAAAAAAAO..",
      "..OAAAAAAAAAAO..",
      ".OOOAAAAAAAAOOO.",
      ".OaOOOOOOOOOOaO.",
      ".OAOaaaaaaaaOAO.",
      ".OAOAAAAAAAAOAO.",
      ".OAOAAAAAAAAOAO.",
      ".OOOOOOOOOOOOOO.",
      "..OO........OO..",
    ],
    { O: P.outline, A: "#8c4a3a", a: "#a85d4b" },
  );
}

// ------------------------------------------------------------------ bubbles and icons

const BUBBLE_W = 16;
const BUBBLE_H = 14;

function bubble(glyph: string[], legend: Record<string, string>, fill = "#ffffff"): Pixmap {
  const px = createPixmap(BUBBLE_W, BUBBLE_H);
  box(px, 1, 0, 14, 11, fill, P.outline);
  // rounded corners
  for (const [x, y] of [
    [1, 0],
    [14, 0],
    [1, 10],
    [14, 10],
  ] as const)
    clearPixel(px, x, y);
  // tail
  fillRect(px, 6, 10, 4, 1, fill);
  fillRect(px, 6, 11, 3, 1, P.outline);
  setPixel(px, 7, 11, fill);
  setPixel(px, 7, 12, P.outline);
  const g = sprite("glyph", glyph, { O: P.outline, ...legend });
  blit(px, g, 2 + Math.floor((12 - g.w) / 2), 1 + Math.floor((9 - g.h) / 2));
  return px;
}

/** "Thinking" dots, 1 to 3 of them, always 12 wide so the bubble does not jump. */
const DOTS = (n: number) => {
  const row = [0, 1, 2].map((i) => (i < n ? ".OO." : "....")).join("");
  return [row, row];
};

function bubbles(): Record<string, Pixmap> {
  const b = "#3d82d6";
  return {
    "bubble/think1": bubble(DOTS(1), {}),
    "bubble/think2": bubble(DOTS(2), {}),
    "bubble/think3": bubble(DOTS(3), {}),
    "bubble/alert": bubble(["OO", "OO", "OO", "OO", "..", "OO"], {}, "#f0a04b"),
    "bubble/browser": bubble(
      ["..bbbb..", ".bwbbwb.", "bbwbbwbb", "wwwwwwww", "bbwbbwbb", ".bwbbwb.", "..bbbb.."],
      { b, w: "#cfe6f7" },
    ),
    "bubble/code": bubble(["..b...b.b...", ".b....b..b..", "b....b....b.", ".b..b....b..", "..b.b...b..."].map((r) => r.slice(0, 11)), { b: "#0f7a5c" }),
    "bubble/chat1": bubble(["mmmmmmmm", "........", "mmmmm...", "........", "mmmmmmm."], { m: "#8a9a92" }),
    "bubble/chat2": bubble(["mmmmm...", "........", "mmmmmmmm", "........", "mmm....."], { m: "#8a9a92" }),
    "bubble/coffee": bubble(
      ["..s..s..", ".s..s...", "OOOOOOO.", "OwwwwwOO", "OwwwwwO.O".slice(0, 8), "OwwwwwOO", ".OOOOO.."],
      { s: "#b8c5bd", w: "#86604a" },
    ),
    "bubble/book": bubble(
      [".OOOOOOOOOO.", "OppppOOppppO", "OpmmpOOpmmpO", "OppppOOppppO", "OpmmpOOpmmpO", "OppppOOppppO", "OOOOOOOOOOOO", ".bbbbbbbbbb."],
      { p: P.paper, m: "#8a9a92", b: P.bookB },
    ),
    "bubble/search": bubble(
      ["..OOOO....", ".OwwwwO...", "OwwwwwwO..", "OwwwwwwO..", "OwwwwwwO..", ".OwwwwO...", "..OOOOOO..", "......OOO.", ".......OOO"],
      { w: "#cfe6f7" },
    ),
    "bubble/pr": bubble(
      ["gg....gg", "gg....gg", "g......g", "g.....g.", "g...gg..", "g.gg....", "gg......"],
      { g: "#7a5aa6" },
    ),
    "bubble/check": bubble(
      [".......gg", "......gg.", "gg...gg..", ".gg.gg...", "..ggg....", "...g....."],
      { g: "#0f7a5c" },
    ),
    "bubble/fail": bubble(
      ["rr....rr", ".rr..rr.", "..rrrr..", "...rr...", "..rrrr..", ".rr..rr.", "rr....rr"],
      { r: "#d34a4a" },
    ),
    "bubble/zzz": bubble([".......OOO", "........O.", ".......OOO", "OOOO......", "...O......", "..O.......", ".O........", "OOOO......"], {}),
  };
}

function dizzy(phase: number): Pixmap {
  const px = createPixmap(16, 8);
  const star = (x: number, y: number) => {
    setPixel(px, x, y, "#f0c640");
    setPixel(px, x - 1, y, "#f0c640");
    setPixel(px, x + 1, y, "#f0c640");
    setPixel(px, x, y - 1, "#f0c640");
    setPixel(px, x, y + 1, "#f0c640");
  };
  const spots = [
    [2, 4],
    [8, 2],
    [14, 4],
    [8, 6],
  ] as const;
  for (let i = 0; i < 3; i++) {
    const [x, y] = spots[(i + phase) % spots.length]!;
    star(x, y);
  }
  return px;
}

function heldDoc(): Pixmap {
  return sprite(
    "doc",
    [".OOOOOO.", ".OppppOO", ".OpOOpPO", ".OppppPO", ".OpOOOpO", ".OppppPO", ".OpOOppO", ".OppppPO", ".OOOOOOO"],
    { O: P.outline, p: P.paper, P: P.paperShade },
  );
}

function shadow(): Pixmap {
  const px = createPixmap(12, 4);
  fillRect(px, 2, 0, 8, 4, "#00000030");
  fillRect(px, 0, 1, 12, 2, "#00000030");
  return px;
}

export function buildProps(): Record<string, Pixmap> {
  return {
    ...screens(),
    "rack/on1": rackLeds((i) => (i % 2 ? [P.ledGreen, "#1d6b4f"] : ["#1d6b4f", P.ledGreen])),
    "rack/on2": rackLeds((i) => (i % 2 ? ["#1d6b4f", P.ledGreen] : [P.ledGreen, P.ledAmber])),
    "rack/off": rackLeds(() => null),
    "rack/error": rackLeds((i) => (i % 2 ? [P.ledRed, "#5a1a20"] : ["#5a1a20", P.ledRed])),
    "lamp/ok": lamp(P.ledGreen, "#3fe0a055"),
    "lamp/warn": lamp(P.ledAmber, "#f0a04b55"),
    "lamp/bad": lamp(P.ledRed, "#ff5a6466"),
    "tray/0": tray(0),
    "tray/1": tray(1),
    "tray/2": tray(2),
    "tray/3": tray(3),
    "note/yellow": note("#f2d27a"),
    "note/green": note("#a8dcc0"),
    "note/pink": note("#f2b8c6"),
    "note/blue": note("#b7d6f0"),
    "chair/back": sprite("chair-back", CHAIR_BACK_ROWS, CHAIR_LEGEND),
    "chair/front": chairFront(),
    "chair/exec": execChair(),
    "chair/arm": armchair(),
    ...bubbles(),
    "fx/dizzy1": dizzy(0),
    "fx/dizzy2": dizzy(1),
    "fx/doc": heldDoc(),
    "fx/shadow": shadow(),
  };
}
