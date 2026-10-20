/**
 * Colours of the 3D office (warm, light, Taskuary-like). Gemini tunes these; the engine only reads them.
 * Every value is a CSS hex colour.
 */
export const PALETTE = {
  background: "#f3ede3",
  floor: "#ebe0ce",
  floorLine: "#ded2be",
  wall: "#f8f5ee",
  wallTop: "#dfd2be",
  wallLow: "#ebe1d2",
  /** Floor tint per zone (rugs / carpets); missing zones use `floor`. */
  zones: {
    meeting_room: "#e4dfd2",
    pantry: "#ede5d8",
    library: "#e5dcce",
    server_room: "#dedad4",
    owner_desk: "#eae0cf",
  } as Record<string, string>,
  wood: "#d4a36f",
  woodDark: "#85582f",
  white: "#faf7f2",
  metal: "#8c949c",
  dark: "#2b2e34",
  fabric: "#a2b798",
  fabricDark: "#768c6c",
  plant: "#588b53",
  plantDark: "#3f6a3b",
  pot: "#d4977a",
  /** Screen glow per ScreenKind: distinct off / working / alert / failed. */
  screen: {
    off: "#1d2024",
    idle: "#4ca5ff",
    code: "#2ecc71",
    browser: "#22d3ee",
    alert: "#f59e0b",
    done: "#2ecc71",
    failed: "#ef4444",
  } as Record<string, string>,
  rack: { off: "#25282e", on: "#2ecc71", error: "#ef4444" } as Record<string, string>,
  selection: "#10b981",
  shadow: "#000000",
} as const;

export type Palette = typeof PALETTE;

