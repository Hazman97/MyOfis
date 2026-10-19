import { hashString } from "../art/characters.ts";
import type { CharacterSnapshot } from "../brain/world.ts";
import type { ScreenKind } from "../brain/intent.ts";

/** Atlas frame names for what the director says. Pure, so it is tested without Phaser. */
const WALK = ["_walk1", "", "_walk2", ""];

export function characterFrame(c: CharacterSnapshot, timeMs: number): string {
  const look = c.look;
  if (c.moving) return `${look}/${c.facing}${WALK[Math.floor(timeMs / 140) % WALK.length]}`;
  if (c.seated) {
    if (c.facing !== "up") return `${look}/sit_down`;
    if (c.pose === "hand") return `${look}/sit_up_hand`;
    if (c.pose === "type") return `${look}/sit_up_type${(Math.floor(timeMs / 170) % 2) + 1}`;
    return `${look}/sit_up`;
  }
  if (c.pose === "hand" && c.facing === "down") return `${look}/down_hand`;
  return `${look}/${c.facing}`;
}

export function bubbleFrame(c: CharacterSnapshot, timeMs: number): string | null {
  switch (c.bubble) {
    case null:
      return null;
    case "think":
      return `bubble/think${(Math.floor(timeMs / 400) % 3) + 1}`;
    case "chat":
      // the two people chatting alternate lines
      return `bubble/chat${((Math.floor(timeMs / 900) + (hashString(c.id) % 2)) % 2) + 1}`;
    default:
      return `bubble/${c.bubble}`;
  }
}

export function screenFrame(kind: ScreenKind, timeMs: number, desk: number): string {
  if (kind === "code") return `screen/code${((Math.floor(timeMs / 260) + desk) % 2) + 1}`;
  return `screen/${kind}`;
}

/**
 * Extra offset (art pixels) for playful moments: a hop while `effect` is "jump", and a lifted
 * wiggle while the owner carries the agent. Pure, so it is tested without Phaser.
 */
export function bodyOffset(c: CharacterSnapshot, timeMs: number): { x: number; y: number } {
  if (c.held) return { x: Math.round(Math.sin(timeMs / 90) * 1.5), y: -10 };
  if (c.effect === "jump") return { x: 0, y: -Math.round(Math.abs(Math.sin(timeMs / 110)) * 4) };
  return { x: 0, y: 0 };
}

/** Top of the head above the feet, in art pixels (seated characters are shorter). */
export const headTop = (c: CharacterSnapshot) => (c.seated ? 21 : 24);
