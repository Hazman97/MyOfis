import { blit, createPixmap, flipX, sprite, type Pixmap } from "./pixmap.ts";
import { P } from "./palette.ts";

/**
 * Office workers, 16×24 per frame, drawn as character grids.
 * A frame is stacked from parts: head (11 rows, 12 for a hijab whose drape
 * replaces the collar row) + torso (6) + legs (7). Template letters:
 *   O outline  H/h hair (or scarf)  S skin  E eye  B blush
 *   T/t top    P/p pants            F shoes C/c/M desk chair (fixed colours)
 * Accessories (cap, glasses, headphones, badge) are overlays.
 */
export const CHAR_W = 16;
export const CHAR_H = 24;

export const CHARACTER_FRAMES = [
  "down",
  "down_walk1",
  "down_walk2",
  "up",
  "up_walk1",
  "up_walk2",
  "right",
  "right_walk1",
  "right_walk2",
  "left",
  "left_walk1",
  "left_walk2",
  "sit_up",
  "sit_up_type1",
  "sit_up_type2",
  "sit_up_hand",
  "sit_down",
  "down_hand",
] as const;
export type CharacterFrame = (typeof CHARACTER_FRAMES)[number];

type Dir = "down" | "up" | "right";
type HeadStyle = "short" | "bob" | "hijab";

const HEADS: Record<HeadStyle, Record<Dir, string[]>> = {
  short: {
    down: [
      "................",
      ".....OOOOOO.....",
      "....OHHHHHHO....",
      "...OHHHHHHHHO...",
      "...OHHHHHHHHO...",
      "...OHHSSSSHHO...",
      "...OHSSSSSSHO...",
      "...OSSESSESSO...",
      "...OSSESSESSO...",
      "...OSBSSSSBSO...",
      "....OSSSSSSO....",
    ],
    up: [
      "................",
      ".....OOOOOO.....",
      "....OHHHHHHO....",
      "...OHHHHHHHHO...",
      "...OHHHHHHHHO...",
      "...OHHHHHHHHO...",
      "...OHHHHHHHHO...",
      "...OHHHHHHHHO...",
      "...OhHHHHHHhO...",
      "...OShhhhhhSO...",
      "....OSSSSSSO....",
    ],
    right: [
      "................",
      ".....OOOOOO.....",
      "....OHHHHHHO....",
      "...OHHHHHHHHO...",
      "...OHHHHHHHHO...",
      "...OHHHHHHSSO...",
      "...OHHHHSSSSO...",
      "...OHHhSSSESO...",
      "...OHHhSSSESO...",
      "...OhHSSSSBSO...",
      "....OSSSSSSO....",
    ],
  },
  bob: {
    down: [
      "................",
      ".....OOOOOO.....",
      "....OHHHHHHO....",
      "...OHHHHHHHHO...",
      "...OHHHHHHHHO...",
      "...OHHSSSSHHO...",
      "...OHSSSSSSHO...",
      "...OHSESSESHO...",
      "...OHSESSESHO...",
      "...OHBSSSSBHO...",
      "...OHhSSSShHO...",
    ],
    up: [
      "................",
      ".....OOOOOO.....",
      "....OHHHHHHO....",
      "...OHHHHHHHHO...",
      "...OHHHHHHHHO...",
      "...OHHHHHHHHO...",
      "...OHHHHHHHHO...",
      "...OHHHHHHHHO...",
      "...OHHHHHHHHO...",
      "...OHHHHHHHHO...",
      "...OhhhhhhhhO...",
    ],
    right: [
      "................",
      ".....OOOOOO.....",
      "....OHHHHHHO....",
      "...OHHHHHHHHO...",
      "...OHHHHHHHHO...",
      "...OHHHHHHHSO...",
      "...OHHHHHSSSO...",
      "...OHHHHSSESO...",
      "...OHHHHSSESO...",
      "...OHHHHSSBSO...",
      "...OhhhhOSSSO...",
    ],
  },
  hijab: {
    down: [
      "................",
      ".....OOOOOO.....",
      "....OHHHHHHO....",
      "...OHHHHHHHHO...",
      "...OHHhhhhHHO...",
      "...OHhSSSShHO...",
      "...OHSSSSSSHO...",
      "...OHSESSESHO...",
      "...OHSESSESHO...",
      "...OHBSSSSBHO...",
      "...OHHSSSSHHO...",
      "...OHHHHHHHHO...",
    ],
    up: [
      "................",
      ".....OOOOOO.....",
      "....OHHHHHHO....",
      "...OHHHHHHHHO...",
      "...OHHHHHHHHO...",
      "...OHHHHHHHHO...",
      "...OHHHHHHHHO...",
      "...OHHHHHHHHO...",
      "...OHHHHHHHHO...",
      "...OHHHHHHHHO...",
      "...OhHHHHHHhO...",
      "...OHHHHHHHHO...",
    ],
    right: [
      "................",
      ".....OOOOOO.....",
      "....OHHHHHHO....",
      "...OHHHHHHHHO...",
      "...OHHHHHHhhO...",
      "...OHHHHHhSSO...",
      "...OHHHHHSSSO...",
      "...OHHHHHSESO...",
      "...OHHHHHSESO...",
      "...OHHHHHSBSO...",
      "...OHHHHHHSSO...",
      "...OHHHHHHHHO...",
    ],
  },
};

const TORSO = {
  front: ["....OOTTTTOO....", "...OTTTTTTTTO...", "..OtTTTTTTTTtO..", "..OtTTTTTTTTtO..", "..OSOTTTTTTOSO..", "...OOTTTTTTOO..."],
  /** Right arm left out: it is drawn raised by the HAND_UP overlay. */
  frontArmUp: ["....OOTTTTOO....", "...OTTTTTTTTO...", "..OtTTTTTTTTO...", "..OtTTTTTTTTO...", "..OSOTTTTTTO....", "...OOTTTTTTO...."],
  side: [".....OOTTOO.....", "....OTTTTTTO....", "....OTTttTTO....", "....OTTttTTO....", "....OTTSSTTO....", "....OOTTTTOO...."],
  sideSwingA: [".....OOTTOO.....", "....OTTTTTTO....", "....OTTTttTO....", "....OTTTTttO....", "....OTTTTTSSO...", "....OOTTTTOO...."],
  sideSwingB: [".....OOTTOO.....", "....OTTTTTTO....", "....OttTTTTO....", "...OttTTTTTO....", "...OSSTTTTTO....", "....OOTTTTOO...."],
  /** Seen from behind while seated: shoulders + elbows only (the chair covers the rest). */
  seatedIdle: ["...OTTTTTTTTO...", "..OtTTTTTTTTtO.."],
  seatedTypeA: ["...OTTTTTTTTO...", "..OtTTTTTTTTO..."],
  seatedTypeB: ["...OTTTTTTTTO...", "...OTTTTTTTTtO.."],
};

const LEGS = {
  front: ["...OPPPPPPPPO...", "...OPPPPPPPPO...", "...OPPPOOPPPO...", "...OPPO..OPPO...", "...OPPO..OPPO...", "...OFFO..OFFO...", "...OOOO..OOOO..."],
  frontStepL: ["...OPPPPPPPPO...", "...OPPPPPPPPO...", "...OPPPOOPPPO...", "...OPPO..OPPO...", "...OFFO..OPPO...", "...OOOO..OFFO...", ".........OOOO..."],
  frontStepR: ["...OPPPPPPPPO...", "...OPPPPPPPPO...", "...OPPPOOPPPO...", "...OPPO..OPPO...", "...OPPO..OFFO...", "...OFFO..OOOO...", "...OOOO........."],
  side: ["....OPPPPPPO....", "....OPPPPPPO....", "....OPPPPPPO....", ".....OPPPPO.....", ".....OPPPPO.....", ".....OFFFFFO....", ".....OOOOOOO...."],
  sideStrideA: ["....OPPPPPPO....", "....OPPPPPPO....", "...OpppOOPPPO...", "...OppO..OPPO...", "..OppO....OPPO..", "..OFFFO...OFFFO.", "..OOOOO...OOOOO."],
  sideStrideB: ["....OPPPPPPO....", "....OPPPPPPO....", "...OPPPOOpppO...", "...OPPO..OppO...", "..OPPO....OppO..", "..OFFFO...OFFFO.", "..OOOOO...OOOOO."],
  /** Seated, facing the viewer: thighs towards us, feet on the floor. */
  seatedFront: ["...OPPPPPPPPO...", "...OPPPPPPPPO...", "...OPPPOOPPPO...", "...OFFO..OFFO...", "...OOOO..OOOO..."],
};

/** Desk chair seen from behind, shared with the empty-chair prop so both line up. */
export const CHAIR_BACK_ROWS = [
  "...OOOOOOOOOO...",
  "...OCccccccCO...",
  "...OCCCCCCCCO...",
  "...OCCCCCCCCO...",
  "....OOOOOOOO....",
  "......OMMO......",
  "....OMMMMMMO....",
  "....OO....OO....",
];

const HAND_UP_ROWS = [
  "............OOOO",
  "............OSSO",
  "............OSSO",
  "............OTTO",
  "............OTTO",
  "............OTTO",
  "............OTTO",
  "............OTTO",
  "............OTTO",
  "............OTTO",
  "............OTTO",
];

type Accessory = "cap" | "glasses" | "headphones" | "badge";

/** Overlay rows keyed by first row index (in standing coordinates). */
const ACCESSORIES: Record<Accessory, Partial<Record<Dir, { y: number; rows: string[] }>>> = {
  cap: {
    down: { y: 1, rows: [".....OOOOOO.....", "....OKKKKKKO....", "...OKKKYYKKKO...", "...OKKKKKKKKO...", "..OkkkkkkkkkkO.."] },
    up: { y: 1, rows: [".....OOOOOO.....", "....OKKKKKKO....", "...OKKKKKKKKO...", "...OKKKKKKKKO...", "...OkkkkkkkkO..."] },
    right: { y: 1, rows: [".....OOOOOO.....", "....OKKKKKKO....", "...OKKKKKKYKO...", "...OKKKKKKKKOO..", "...OkkkkkkkkkkO."] },
  },
  glasses: {
    down: { y: 7, rows: [".....GEGGEG.....", ".....GEGGEG....."] },
    right: { y: 7, rows: ["........GGEG....", "........GGEG...."] },
  },
  headphones: {
    down: {
      y: 2,
      rows: ["....OAAAAAAO....", "...A........A...", "...A........A...", "...A........A...", "..OAA......AAO..", "..OaA......AaO..", "..OAA......AAO.."],
    },
    up: {
      y: 2,
      rows: ["....OAAAAAAO....", "...A........A...", "...A........A...", "...A........A...", "..OAA......AAO..", "..OaA......AaO..", "..OAA......AAO.."],
    },
    right: {
      y: 2,
      rows: ["....OAAAAAAO....", ".......A........", ".......A........", ".......A........", "......OAAO......", "......OAaO......", "......OAAO......"],
    },
  },
  badge: {
    down: { y: 13, rows: ["....Y..........."] },
    right: { y: 13, rows: [".........Y......"] },
  },
};

export interface Outfit {
  head: HeadStyle;
  hair: string;
  hairShade: string;
  skin: string;
  top: string;
  topShade: string;
  pants: string;
  pantsShade: string;
  shoes: string;
  accessories?: Accessory[];
  /** Accessory colours. */
  cap?: string;
  capBrim?: string;
  glasses?: string;
  phones?: string;
}

const SKIN = ["#f3cfa6", "#e3b086", "#c98f62", "#a8703f", "#7d4f31"] as const;

/** Built-in looks. Agents pick one with their `sprite` field; unknown names fall back to a person-N look. */
export const OUTFITS: Record<string, Outfit> = {
  guard: {
    head: "short",
    hair: "#2b2320",
    hairShade: "#1d1715",
    skin: SKIN[2],
    top: "#2f4f80",
    topShade: "#243d64",
    pants: "#1f2b40",
    pantsShade: "#172131",
    shoes: "#141414",
    accessories: ["cap", "badge"],
    cap: "#22385f",
    capBrim: "#182946",
  },
  tester: {
    head: "bob",
    hair: "#5a3825",
    hairShade: "#43291a",
    skin: SKIN[1],
    top: "#f1f4f2",
    topShade: "#cdd6d1",
    pants: "#3f4f6b",
    pantsShade: "#313e55",
    shoes: "#2a2a2a",
    accessories: ["glasses"],
    glasses: "#20262b",
  },
  coder: {
    head: "short",
    hair: "#1c1c20",
    hairShade: "#111114",
    skin: SKIN[3],
    top: "#2f9a72",
    topShade: "#237658",
    pants: "#2c3036",
    pantsShade: "#202328",
    shoes: "#e9ecea",
    accessories: ["headphones"],
    phones: "#3a3f44",
  },
  marketer: {
    head: "hijab",
    hair: "#c4577a",
    hairShade: "#a24363",
    skin: SKIN[1],
    top: "#efe3cf",
    topShade: "#d6c6ab",
    pants: "#4a3c5c",
    pantsShade: "#3a2f49",
    shoes: "#3b2a22",
  },
  "person-1": {
    head: "short",
    hair: "#3b2a20",
    hairShade: "#2a1d16",
    skin: SKIN[0],
    top: "#d96c3f",
    topShade: "#b5552f",
    pants: "#34445e",
    pantsShade: "#28354a",
    shoes: "#2b2b2b",
  },
  "person-2": {
    head: "hijab",
    hair: "#2f7d8c",
    hairShade: "#24626e",
    skin: SKIN[2],
    top: "#f2d27a",
    topShade: "#d4b45c",
    pants: "#2f3a4a",
    pantsShade: "#232c38",
    shoes: "#2b2b2b",
  },
  "person-3": {
    head: "bob",
    hair: "#151517",
    hairShade: "#0c0c0d",
    skin: SKIN[0],
    top: "#7a5aa6",
    topShade: "#614787",
    pants: "#2c2f36",
    pantsShade: "#202227",
    shoes: "#e0e0e0",
  },
  "person-4": {
    head: "short",
    hair: "#6b4a2b",
    hairShade: "#51381f",
    skin: SKIN[4],
    top: "#3d82d6",
    topShade: "#2f68ad",
    pants: "#4a4f57",
    pantsShade: "#3a3e45",
    shoes: "#202020",
  },
  "person-5": {
    head: "hijab",
    hair: "#3a3f6b",
    hairShade: "#2c3053",
    skin: SKIN[1],
    top: "#e9ecea",
    topShade: "#c8cfcb",
    pants: "#6b4b3a",
    pantsShade: "#553a2d",
    shoes: "#2b2b2b",
  },
  "person-6": {
    head: "short",
    hair: "#a35a2a",
    hairShade: "#80451f",
    skin: SKIN[1],
    top: "#4f9a6a",
    topShade: "#3e7b54",
    pants: "#30343a",
    pantsShade: "#24272c",
    shoes: "#5a3a26",
  },
  "person-7": {
    head: "bob",
    hair: "#d9b26a",
    hairShade: "#b8924f",
    skin: SKIN[0],
    top: "#c0453d",
    topShade: "#9c3730",
    pants: "#26324a",
    pantsShade: "#1c2538",
    shoes: "#202020",
  },
  "person-8": {
    head: "short",
    hair: "#2a2a2e",
    hairShade: "#1a1a1d",
    skin: SKIN[3],
    top: "#e0a33a",
    topShade: "#bf862a",
    pants: "#3d4a3f",
    pantsShade: "#2f3a31",
    shoes: "#202020",
  },
  /** You, walking around your own office (not an agent look). */
  boss: {
    head: "short",
    hair: "#1c1c22",
    hairShade: "#121216",
    skin: SKIN[2],
    top: "#24324d",
    topShade: "#1a253a",
    pants: "#20283a",
    pantsShade: "#171d2b",
    shoes: "#111111",
    accessories: ["badge"],
  },
};

export const PERSON_OUTFITS = Object.keys(OUTFITS).filter((k) => k.startsWith("person-"));

const shade = (hex: string, f: number) => {
  const v = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(v.slice(i, i + 2), 16) * f))));
  return `#${c.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
};

function legendFor(o: Outfit) {
  return {
    O: P.outline,
    H: o.hair,
    h: o.hairShade,
    S: o.skin,
    E: "#1d1b1a",
    B: shade(o.skin, 0.9),
    T: o.top,
    t: o.topShade,
    P: o.pants,
    p: o.pantsShade,
    F: o.shoes,
    C: P.chair,
    c: P.chairLight,
    M: P.metalDark,
    K: o.cap ?? "#22385f",
    k: o.capBrim ?? "#182946",
    Y: "#f0c640",
    G: o.glasses ?? "#20262b",
    A: o.phones ?? "#3a3f44",
    a: "#3fc296",
  };
}

const blank = (n: number) => Array.from({ length: n }, () => "................");

/** Standing frame: head + torso (minus collar row under a hijab drape) + legs. */
function standing(head: string[], torso: string[], legs: string[]) {
  return [...head, ...torso.slice(head.length - 11), ...legs];
}

function frameRows(o: Outfit, frame: CharacterFrame): { rows: string[]; dir: Dir | null; seatedOffset: number } {
  const H = HEADS[o.head];
  switch (frame) {
    case "down":
    case "up":
      return { rows: standing(H[frame], TORSO.front, LEGS.front), dir: frame, seatedOffset: 0 };
    case "down_walk1":
    case "up_walk1":
      return { rows: standing(H[frame === "down_walk1" ? "down" : "up"], TORSO.front, LEGS.frontStepL), dir: frame === "down_walk1" ? "down" : "up", seatedOffset: 0 };
    case "down_walk2":
    case "up_walk2":
      return { rows: standing(H[frame === "down_walk2" ? "down" : "up"], TORSO.front, LEGS.frontStepR), dir: frame === "down_walk2" ? "down" : "up", seatedOffset: 0 };
    case "right":
    case "left":
      return { rows: standing(H.right, TORSO.side, LEGS.side), dir: "right", seatedOffset: 0 };
    case "right_walk1":
    case "left_walk1":
      return { rows: standing(H.right, TORSO.sideSwingA, LEGS.sideStrideA), dir: "right", seatedOffset: 0 };
    case "right_walk2":
    case "left_walk2":
      return { rows: standing(H.right, TORSO.sideSwingB, LEGS.sideStrideB), dir: "right", seatedOffset: 0 };
    case "down_hand":
      return { rows: standing(H.down, TORSO.frontArmUp, LEGS.front), dir: "down", seatedOffset: 0 };
    case "sit_up":
    case "sit_up_hand":
    case "sit_up_type1":
    case "sit_up_type2": {
      const torso = frame === "sit_up_type1" ? TORSO.seatedTypeA : frame === "sit_up_type2" ? TORSO.seatedTypeB : TORSO.seatedIdle;
      const rows = [...blank(3), ...H.up, ...torso.slice(H.up.length - 11), ...CHAIR_BACK_ROWS];
      return { rows, dir: "up", seatedOffset: 3 };
    }
    case "sit_down": {
      const rows = [...blank(3), ...H.down, ...TORSO.front.slice(H.down.length - 11, 5), ...LEGS.seatedFront];
      return { rows, dir: "down", seatedOffset: 3 };
    }
  }
}

export function drawCharacterFrame(o: Outfit, frame: CharacterFrame): Pixmap {
  const legend = legendFor(o);
  const { rows, dir, seatedOffset } = frameRows(o, frame);
  if (rows.length !== CHAR_H) throw new Error(`frame ${frame}/${o.head}: ${rows.length} rows, expected ${CHAR_H}`);
  const px = sprite(`${o.head}/${frame}`, rows, legend);
  if (dir) {
    for (const acc of o.accessories ?? []) {
      const part = ACCESSORIES[acc][dir];
      // A hijab already covers the head: no cap or headphones over it.
      if (!part || (o.head === "hijab" && (acc === "cap" || acc === "headphones"))) continue;
      // The badge belongs to the standing torso; seated frames hide it behind arms/chair.
      if (acc === "badge" && seatedOffset) continue;
      blit(px, sprite(`${acc}/${dir}`, part.rows, legend), 0, part.y + seatedOffset);
    }
  }
  if (frame === "down_hand" || frame === "sit_up_hand") {
    blit(px, sprite("hand_up", HAND_UP_ROWS, legend), 0, 2 + seatedOffset);
  }
  return frame.startsWith("left") ? flipX(px) : px;
}

/** All frames of one outfit, left to right in CHARACTER_FRAMES order. */
export function drawCharacterStrip(o: Outfit): Pixmap {
  const strip = createPixmap(CHAR_W * CHARACTER_FRAMES.length, CHAR_H);
  CHARACTER_FRAMES.forEach((f, i) => blit(strip, drawCharacterFrame(o, f), i * CHAR_W, 0));
  return strip;
}

/** Stable hash so an agent keeps the same look across reloads. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Which outfit an agent wears: its `sprite` when that names a known look,
 * otherwise a person-N picked from the slug. `known` lets swapped art add looks.
 */
export function outfitFor(agent: { slug: string; sprite?: string | null }, known: readonly string[] = Object.keys(OUTFITS)): string {
  if (agent.sprite && agent.sprite !== "default" && known.includes(agent.sprite)) return agent.sprite;
  const people = known.filter((k) => k.startsWith("person-"));
  const pool = people.length ? people : known;
  return pool[hashString(agent.slug) % pool.length]!;
}
