import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { ChairSpot, FurnitureKind, FurniturePiece } from "./plan.ts";
import type { Palette } from "./palette.ts";

/**
 * The look of every piece of furniture in the 3D office, built from simple shapes in code (our own
 * art, no downloaded models). The engine (office3d.ts) places and turns what these return.
 *
 * CONTRACT (keep it when restyling):
 * - `buildFurniture(kind, w, d, pal)` builds the piece in LOCAL space: centred on the origin, standing
 *   on y = 0, `w` wide along X and `d` deep along Z (in tiles; 1 tile = 1 unit), the side people use
 *   toward +Z. Stay inside the footprint (±w/2, ±d/2) so characters never walk through it.
 * - Return `screens` for monitors (the engine recolours them per agent state) and `lights` for rack
 *   LEDs (recoloured on/off/error). Everything else is decoration.
 * - Every mesh should `castShadow` / `receiveShadow` as fits. A person is ~1.15 units tall; a desk top
 *   sits at ~0.72, a seat at ~0.42.
 * - `buildChair(style, pal)` builds one chair centred on the origin, facing +Z (a sitter looks to +Z).
 */
export interface FurnitureParts {
  group: THREE.Group;
  /** Monitors, in order (desk screen first). */
  screens: THREE.Mesh[];
  /** Rack LEDs. */
  lights: THREE.Mesh[];
}

const mats = new Map<string, THREE.MeshStandardMaterial>();
/** One shared material per colour (cheap; never mutate these, clone for per-object colours). */
export function mat(color: string, roughness = 0.85): THREE.MeshStandardMaterial {
  const key = `${color}/${roughness}`;
  let m = mats.get(key);
  if (!m) mats.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 })));
  return m;
}

/** A rounded box resting on y = `y` (bottom), centred on x/z. */
export function box(w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0, radius = 0.04): THREE.Mesh {
  const r = Math.min(radius, w / 2, h / 2, d / 2);
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, r), material);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildFurniture(kind: FurnitureKind, w: number, d: number, pal: Palette): FurnitureParts {
  const g = new THREE.Group();
  const screens: THREE.Mesh[] = [];
  const lights: THREE.Mesh[] = [];
  const legs = (top: number, inset = 0.08, color: string = pal.woodDark) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.06, top, 0.06, mat(color), sx * (w / 2 - inset), 0, sz * (d / 2 - inset), 0.02));
  };
  switch (kind) {
    case "desk":
    case "exec_desk": {
      const top = 0.72;
      g.add(box(w - 0.1, 0.06, d - 0.2, mat(kind === "exec_desk" ? pal.woodDark : pal.wood), 0, top - 0.06, 0, 0.03));
      legs(top - 0.06, 0.12);
      // monitor at the back, facing +Z
      const stand = box(0.06, 0.18, 0.06, mat(pal.dark), 0, top, -d / 2 + 0.35, 0.02);
      const frame = box(0.62, 0.38, 0.04, mat(pal.dark), 0, top + 0.16, -d / 2 + 0.33, 0.02);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.32), new THREE.MeshStandardMaterial({ color: pal.screen.off, emissive: pal.screen.off, emissiveIntensity: 0.6 }));
      screen.position.set(0, top + 0.35, -d / 2 + 0.355);
      g.add(stand, frame, screen);
      screens.push(screen);
      break;
    }
    case "meeting_table":
      g.add(box(w - 0.2, 0.06, d - 0.3, mat(pal.white, 0.6), 0, 0.68, 0, 0.05));
      legs(0.68, 0.3, pal.metal);
      break;
    case "counter":
      g.add(box(w - 0.04, 0.86, d - 0.1, mat(pal.white, 0.7), 0, 0, -0.05, 0.03));
      g.add(box(w, 0.05, d, mat(pal.wood), 0, 0.86, 0, 0.02));
      break;
    case "pantry_table":
      g.add(box(w - 0.25, 0.05, d - 0.25, mat(pal.wood), 0, 0.45, 0, 0.03));
      legs(0.45, 0.22);
      break;
    case "sofa":
      g.add(box(w - 0.1, 0.4, d - 0.1, mat(pal.fabric), 0, 0, 0.05, 0.08));
      g.add(box(w - 0.1, 0.45, 0.22, mat(pal.fabricDark), 0, 0.35, -d / 2 + 0.16, 0.08));
      break;
    case "bookshelf": {
      g.add(box(w - 0.06, 1.7, d - 0.4, mat(pal.wood), 0, 0, -0.2, 0.02));
      const colors = ["#c9705a", "#6f8fb3", "#d9b25c", "#7fa36b", "#a07ab3"];
      for (let row = 0; row < 3; row++)
        for (let i = 0; i < Math.floor((w - 0.2) / 0.16); i++)
          g.add(box(0.12, 0.34, 0.24, mat(colors[(i + row) % colors.length]!), -w / 2 + 0.18 + i * 0.16, 0.18 + row * 0.5, -0.02, 0.01));
      break;
    }
    case "rack": {
      for (let i = 0; i < Math.round(w); i++) {
        const x = -w / 2 + 0.5 + i;
        g.add(box(0.8, 1.8, d - 0.2, mat(pal.dark, 0.5), x, 0, -0.05, 0.03));
        const led = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.02), new THREE.MeshStandardMaterial({ color: pal.rack.off, emissive: pal.rack.off, emissiveIntensity: 0.8 }));
        led.position.set(x, 1.4, d / 2 - 0.14);
        g.add(led);
        lights.push(led);
      }
      break;
    }
    case "cabinet":
      for (let i = 0; i < Math.round(w); i++) g.add(box(0.9, 1.2, d - 0.25, mat(pal.metal, 0.5), -w / 2 + 0.5 + i, 0, -0.1, 0.03));
      break;
    case "armchair":
    case "planter":
    default: {
      g.add(box(0.45, 0.4, 0.45, mat(pal.pot), 0, 0, 0, 0.08));
      const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), mat(pal.plant));
      leaves.position.set(0, 0.85, 0);
      leaves.castShadow = true;
      g.add(leaves);
      break;
    }
  }
  return { group: g, screens, lights };
}

export function buildChair(style: ChairSpot["style"], pal: Palette): THREE.Group {
  const g = new THREE.Group();
  const seat = style === "arm" ? pal.fabric : style === "front" || style === "back" ? pal.dark : pal.wood;
  g.add(box(0.48, 0.08, 0.46, mat(seat), 0, 0.38, 0, 0.04));
  g.add(box(0.48, 0.5, 0.07, mat(seat), 0, 0.42, -0.22, 0.04));
  g.add(box(0.06, 0.38, 0.06, mat(pal.metal), 0, 0, 0, 0.02));
  if (style === "arm") for (const sx of [-1, 1]) g.add(box(0.07, 0.22, 0.4, mat(pal.fabricDark), sx * 0.26, 0.42, 0, 0.03));
  return g;
}
