/**
 * Colours of the 3D office (warm, light, Taskuary-like). Gemini tunes these; the engine only reads them.
 * Every value is a CSS hex colour.
 */
export const PALETTE = {
  background: "#efe8de",
  floor: "#e7dccb",
  floorLine: "#dccfbb",
  wall: "#f4eee5",
  wallTop: "#e2d6c4",
  wallLow: "#ebe2d4",
  /** Floor tint per zone (rugs / carpets); missing zones use `floor`. */
  zones: {
    meeting_room: "#e4d7c3",
    pantry: "#efe5d6",
    library: "#e2d4be",
    server_room: "#dcd6cf",
    owner_desk: "#e9dcc6",
  } as Record<string, string>,
  wood: "#c9a27a",
  woodDark: "#a77f5a",
  white: "#f8f5f0",
  metal: "#9aa0a6",
  dark: "#3a3d42",
  fabric: "#b9c4b1",
  fabricDark: "#98a58f",
  plant: "#7fa36b",
  plantDark: "#5f8650",
  pot: "#d9c7ae",
  /** Screen glow per ScreenKind. */
  screen: {
    off: "#2b2f35",
    idle: "#8fb3d9",
    code: "#7fd1a6",
    browser: "#8fc2f0",
    alert: "#f2b04f",
    done: "#7fd1a6",
    failed: "#e8796b",
  } as Record<string, string>,
  rack: { off: "#3a3d42", on: "#7fd1a6", error: "#e8796b" } as Record<string, string>,
  selection: "#3fc296",
  shadow: "#000000",
} as const;

export type Palette = typeof PALETTE;
