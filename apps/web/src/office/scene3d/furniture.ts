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

  const addMesh = (mesh: THREE.Mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };

  switch (kind) {
    case "desk": {
      const top = 0.72;
      const topThick = 0.04;
      const topW = w - 0.08;
      const topD = d - 0.12;
      // Light wood desk surface
      g.add(box(topW, topThick, topD, mat(pal.wood, 0.75), 0, top - topThick, 0, 0.02));

      // Slim legs inset from corners
      const legInsetX = topW / 2 - 0.06;
      const legInsetZ = topD / 2 - 0.06;
      const legThick = 0.04;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          g.add(box(legThick, top - topThick, legThick, mat(pal.metal, 0.6), sx * legInsetX, 0, sz * legInsetZ, 0.01));
        }
      }
      // Horizontal crossbars between legs
      for (const sx of [-1, 1]) {
        g.add(box(0.025, 0.025, topD - 0.12, mat(pal.metal, 0.6), sx * legInsetX, 0.18, 0, 0.005));
      }

      // Thin monitor with stand at the back (-Z), facing +Z
      const standZ = -topD / 2 + 0.16;
      const standBase = box(0.18, 0.015, 0.12, mat(pal.dark, 0.5), 0, top, standZ, 0.008);
      const standPole = box(0.04, 0.22, 0.025, mat(pal.metal, 0.4), 0, top + 0.015, standZ - 0.01, 0.008);
      const frameW = Math.min(0.64, topW - 0.2);
      const frameH = 0.38;
      const frame = box(frameW, frameH, 0.02, mat(pal.dark, 0.5), 0, top + 0.16, standZ + 0.015, 0.01);
      const screenW = frameW - 0.04;
      const screenH = frameH - 0.04;
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(screenW, screenH),
        new THREE.MeshStandardMaterial({ color: pal.screen.off, emissive: pal.screen.off, emissiveIntensity: 0.6 })
      );
      screen.position.set(0, top + 0.16 + frameH / 2, standZ + 0.026);
      g.add(standBase, standPole, frame, screen);
      screens.push(screen);

      // Keyboard & mouse
      const kbW = Math.min(0.38, topW - 0.3);
      g.add(box(kbW, 0.012, 0.13, mat(pal.dark, 0.7), -0.06, top, topD / 2 - 0.14, 0.004));
      g.add(box(0.06, 0.012, 0.09, mat(pal.dark, 0.7), Math.min(topW / 2 - 0.12, 0.19), top, topD / 2 - 0.14, 0.004));

      // Desk accessory varying by position/size
      const seed = Math.abs(Math.round(w * 7 + d * 13)) % 3;
      if (seed === 0) {
        // Ceramic coffee mug
        const mugX = -topW / 2 + 0.16;
        const mugZ = topD / 2 - 0.18;
        g.add(box(0.08, 0.09, 0.08, mat(pal.white, 0.5), mugX, top, mugZ, 0.02));
        g.add(box(0.06, 0.008, 0.06, mat(pal.dark, 0.9), mugX, top + 0.08, mugZ, 0.01));
      } else if (seed === 1) {
        // Mini succulent in a terracotta pot
        const potX = topW / 2 - 0.16;
        const potZ = -topD / 2 + 0.20;
        g.add(box(0.09, 0.08, 0.09, mat(pal.pot, 0.8), potX, top, potZ, 0.015));
        const plantGeo = new THREE.DodecahedronGeometry(0.05, 0);
        const plantMesh = new THREE.Mesh(plantGeo, mat(pal.plant, 0.7));
        plantMesh.position.set(potX, top + 0.11, potZ);
        addMesh(plantMesh);
      } else {
        // Small note pad with pen
        const padX = topW / 2 - 0.18;
        const padZ = topD / 2 - 0.16;
        g.add(box(0.12, 0.01, 0.12, mat("#fef08a", 0.9), padX, top, padZ, 0.004));
        g.add(box(0.012, 0.012, 0.11, mat(pal.dark, 0.6), padX + 0.09, top, padZ, 0.003));
      }
      break;
    }

    case "exec_desk": {
      // The executive desk: dark rich wood, modesty panel, monitor only when w >= 2
      const top = 0.72;
      const topThick = 0.05;
      const topW = w - 0.06;
      const topD = d - 0.08;
      g.add(box(topW, topThick, topD, mat(pal.woodDark, 0.7), 0, top - topThick, 0, 0.02));

      // Side end panels (waterfall / slab style)
      const slabThick = 0.06;
      for (const sx of [-1, 1]) {
        g.add(box(slabThick, top - topThick, topD - 0.08, mat(pal.woodDark, 0.75), sx * (topW / 2 - slabThick / 2), 0, 0, 0.01));
      }

      // Modesty panel hanging at the back (-Z)
      const modestyH = top - 0.18;
      g.add(box(topW - slabThick * 2 - 0.04, modestyH, 0.03, mat(pal.woodDark, 0.8), 0, 0.12, -topD / 2 + 0.08, 0.01));

      // One monitor only when w >= 2
      if (w >= 1.8) {
        const standZ = -topD / 2 + 0.22;
        const stand = box(0.22, 0.015, 0.14, mat(pal.dark, 0.5), 0, top, standZ, 0.008);
        const neck = box(0.045, 0.24, 0.03, mat(pal.metal, 0.4), 0, top + 0.015, standZ - 0.01, 0.008);
        const frameW = 0.68;
        const frameH = 0.40;
        const frame = box(frameW, frameH, 0.025, mat(pal.dark, 0.5), 0, top + 0.18, standZ + 0.015, 0.012);
        const screen = new THREE.Mesh(
          new THREE.PlaneGeometry(frameW - 0.04, frameH - 0.04),
          new THREE.MeshStandardMaterial({ color: pal.screen.off, emissive: pal.screen.off, emissiveIntensity: 0.6 })
        );
        screen.position.set(0, top + 0.18 + frameH / 2, standZ + 0.029);
        g.add(stand, neck, frame, screen);
        screens.push(screen);

        // Keyboard & mouse
        g.add(box(0.38, 0.012, 0.13, mat(pal.dark, 0.7), -0.06, top, topD / 2 - 0.16, 0.004));
        g.add(box(0.06, 0.012, 0.09, mat(pal.dark, 0.7), 0.22, top, topD / 2 - 0.16, 0.004));
      }
      break;
    }

    case "meeting_table": {
      // Long conference table with soft warm-white top and elegant legs
      const top = 0.72;
      const topThick = 0.045;
      const tableW = w - 0.14;
      const tableD = d - 0.18;
      g.add(box(tableW, topThick, tableD, mat(pal.white, 0.65), 0, top - topThick, 0, 0.04));

      // Inset metal cable/connectivity tray in center
      const trayW = Math.min(1.2, tableW * 0.45);
      g.add(box(trayW, 0.005, 0.12, mat(pal.metal, 0.4), 0, top, 0, 0.008));

      // Architectural slab legs
      const legDist = tableW / 2 - 0.35;
      for (const sx of [-1, 1]) {
        g.add(box(0.08, top - topThick, tableD - 0.28, mat(pal.woodDark, 0.7), sx * legDist, 0, 0, 0.02));
      }
      // Under-table stretcher beam
      g.add(box(legDist * 2, 0.04, 0.06, mat(pal.woodDark, 0.7), 0, 0.18, 0, 0.01));
      break;
    }

    case "counter": {
      // Pantry counter cabinets; 1x1 is an appliance (coffee machine station)
      const isAppliance = Math.round(w) <= 1 && Math.round(d) <= 1;
      const counterH = 0.86;
      const topThick = 0.04;

      if (isAppliance) {
        // Base cabinet
        g.add(box(w - 0.08, counterH - topThick, d - 0.10, mat(pal.white, 0.7), 0, 0, -0.02, 0.02));
        // Countertop
        g.add(box(w - 0.04, topThick, d - 0.06, mat(pal.wood, 0.7), 0, counterH - topThick, 0, 0.015));

        // Coffee machine appliance on top
        const cmW = 0.44;
        const cmH = 0.40;
        const cmD = 0.38;
        const cmY = counterH;
        // Machine body
        g.add(box(cmW, cmH, cmD, mat(pal.dark, 0.5), 0, cmY, -0.03, 0.02));
        // Chrome faceplate
        g.add(box(cmW - 0.04, cmH * 0.65, 0.02, mat(pal.metal, 0.3), 0, cmY + 0.10, -0.03 + cmD / 2, 0.01));
        // Water reservoir at back
        g.add(box(cmW - 0.08, cmH * 0.75, 0.08, mat("#8ec5e8", 0.4), 0, cmY + 0.06, -0.03 - cmD / 2 + 0.05, 0.015));
        // Drip tray & spouts
        g.add(box(cmW - 0.06, 0.03, 0.14, mat(pal.metal, 0.3), 0, cmY, -0.03 + cmD / 2 + 0.05, 0.008));
        g.add(box(0.08, 0.04, 0.03, mat(pal.metal, 0.2), 0, cmY + 0.20, -0.03 + cmD / 2 + 0.04, 0.008));
        // Espresso cup
        g.add(box(0.08, 0.08, 0.08, mat(pal.white, 0.4), 0, cmY + 0.03, -0.03 + cmD / 2 + 0.05, 0.025));
      } else {
        // Multi-tile pantry counter with cabinets and sink/prep surface
        const bodyW = w - 0.06;
        const bodyD = d - 0.08;
        // Recessed toe-kick base
        g.add(box(bodyW - 0.04, 0.10, bodyD - 0.10, mat(pal.dark, 0.8), 0, 0, -0.04, 0.01));
        // Main cabinet body
        g.add(box(bodyW, counterH - topThick - 0.10, bodyD, mat(pal.white, 0.7), 0, 0.10, -0.02, 0.02));
        // Wood countertop
        g.add(box(w - 0.02, topThick, d - 0.04, mat(pal.wood, 0.7), 0, counterH - topThick, 0, 0.015));

        // Chrome sink & faucet on one side if w >= 2
        if (w >= 1.8) {
          const sinkX = -w / 4;
          g.add(box(0.48, 0.005, 0.38, mat(pal.metal, 0.3), sinkX, counterH, 0, 0.02));
          // Gooseneck faucet
          g.add(box(0.03, 0.22, 0.03, mat(pal.metal, 0.2), sinkX, counterH, -0.16, 0.01));
          g.add(box(0.03, 0.03, 0.12, mat(pal.metal, 0.2), sinkX, counterH + 0.20, -0.10, 0.01));
        }
      }
      break;
    }

    case "pantry_table": {
      // Small round café table with round top and central metal pedestal
      const top = 0.68;
      const radius = Math.min(w, d) / 2 - 0.08;
      // Round top
      const topGeo = new THREE.CylinderGeometry(radius, radius, 0.035, 24);
      const topMesh = new THREE.Mesh(topGeo, mat(pal.wood, 0.75));
      topMesh.position.set(0, top - 0.0175, 0);
      addMesh(topMesh);

      // Central pedestal post
      const postGeo = new THREE.CylinderGeometry(0.035, 0.035, top - 0.05, 16);
      const postMesh = new THREE.Mesh(postGeo, mat(pal.metal, 0.5));
      postMesh.position.set(0, (top - 0.05) / 2 + 0.015, 0);
      addMesh(postMesh);

      // Flat circular base plate on floor
      const baseGeo = new THREE.CylinderGeometry(radius * 0.65, radius * 0.7, 0.02, 24);
      const baseMesh = new THREE.Mesh(baseGeo, mat(pal.metal, 0.5));
      baseMesh.position.set(0, 0.01, 0);
      addMesh(baseMesh);
      break;
    }

    case "sofa": {
      // Warm, cozy sofa with cushions, arms and back
      const sofaW = w - 0.06;
      const sofaD = d - 0.08;
      const seatH = 0.38;

      // Small low tapered feet
      const footH = 0.06;
      const footInsetX = sofaW / 2 - 0.10;
      const footInsetZ = sofaD / 2 - 0.10;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          g.add(box(0.05, footH, 0.05, mat(pal.woodDark, 0.8), sx * footInsetX, 0, sz * footInsetZ, 0.01));
        }
      }

      // Base frame platform
      g.add(box(sofaW, 0.14, sofaD, mat(pal.fabric, 0.85), 0, footH, 0, 0.03));

      // Seat cushions
      const cushionW = sofaW - 0.24;
      const cushionD = sofaD - 0.20;
      const numCushions = Math.max(1, Math.round(w - 0.5));
      const singleW = cushionW / numCushions;
      for (let i = 0; i < numCushions; i++) {
        const cx = -cushionW / 2 + singleW / 2 + i * singleW;
        g.add(box(singleW - 0.02, 0.12, cushionD, mat(pal.fabric, 0.8), cx, footH + 0.14, 0.04, 0.03));
      }

      // Backrest
      const backH = 0.44;
      const backD = 0.18;
      const backZ = -sofaD / 2 + backD / 2;
      g.add(box(sofaW, backH, backD, mat(pal.fabricDark, 0.9), 0, footH + 0.14, backZ, 0.05));

      // Armrests on left and right
      const armW = 0.14;
      const armH = 0.26;
      for (const sx of [-1, 1]) {
        g.add(box(armW, armH, sofaD, mat(pal.fabricDark, 0.9), sx * (sofaW / 2 - armW / 2), footH + 0.12, 0, 0.04));
      }

      // Small accent throw pillow
      g.add(box(0.18, 0.18, 0.08, mat(pal.pot, 0.8), -sofaW / 2 + armW + 0.10, footH + 0.20, backZ + backD / 2 + 0.04, 0.03));
      break;
    }

    case "bookshelf": {
      // Bookshelf with shelves and colorful books of varied heights
      const shelfW = w - 0.06;
      const shelfH = 1.75;
      const shelfD = d - 0.32;
      const shelfZ = -0.10;

      // Wooden carcass (outer frame)
      const frameThick = 0.04;
      // Top and bottom
      g.add(box(shelfW, frameThick, shelfD, mat(pal.wood, 0.8), 0, 0, shelfZ, 0.01));
      g.add(box(shelfW, frameThick, shelfD, mat(pal.wood, 0.8), 0, shelfH - frameThick, shelfZ, 0.01));
      // Left and right side walls
      g.add(box(frameThick, shelfH, shelfD, mat(pal.wood, 0.8), -shelfW / 2 + frameThick / 2, 0, shelfZ, 0.01));
      g.add(box(frameThick, shelfH, shelfD, mat(pal.wood, 0.8), shelfW / 2 - frameThick / 2, 0, shelfZ, 0.01));
      // Backing board
      g.add(box(shelfW, shelfH, 0.02, mat(pal.woodDark, 0.85), 0, 0, shelfZ - shelfD / 2 + 0.01, 0.005));

      // 3 intermediate shelf boards
      const numShelves = 3;
      const shelfSpacing = (shelfH - frameThick * 2) / (numShelves + 1);
      for (let s = 1; s <= numShelves; s++) {
        g.add(box(shelfW - frameThick * 2, frameThick, shelfD - 0.02, mat(pal.wood, 0.8), 0, frameThick + s * shelfSpacing, shelfZ + 0.01, 0.005));
      }

      // Books on each shelf
      const bookColors = ["#c9705a", "#5b82a6", "#d4a34b", "#6a935b", "#8e6e9e", "#b85d43", "#4d908e"];
      const innerW = shelfW - frameThick * 2 - 0.06;
      for (let row = 0; row <= numShelves; row++) {
        const shelfY = frameThick + row * shelfSpacing + (row > 0 ? frameThick : 0);
        let currX = -innerW / 2;
        let bIdx = row * 3;
        while (currX < innerW / 2 - 0.08) {
          const bW = 0.04 + ((bIdx * 7) % 5) * 0.015;
          const bH = 0.22 + ((bIdx * 11) % 6) * 0.022;
          const color = bookColors[bIdx % bookColors.length]!;
          g.add(box(bW, bH, shelfD * 0.70, mat(color, 0.75), currX + bW / 2, shelfY, shelfZ + 0.02, 0.005));
          currX += bW + 0.008;
          bIdx++;
        }
      }
      break;
    }

    case "rack": {
      // Server racks with LED strips (keep them in `lights`)
      for (let i = 0; i < Math.round(w); i++) {
        const x = -w / 2 + 0.5 + i;
        const rackH = 1.85;
        const rackD = d - 0.18;
        // Dark metallic outer cabinet
        g.add(box(0.84, rackH, rackD, mat(pal.dark, 0.5), x, 0, -0.04, 0.02));

        // Front recessed server bay
        const bayW = 0.72;
        const bayD = 0.04;
        const frontZ = -0.04 + rackD / 2 - bayD / 2;

        // Multiple stacked server units
        for (let s = 0; s < 5; s++) {
          const sy = 0.25 + s * 0.30;
          g.add(box(bayW, 0.26, bayD, mat("#1e2227", 0.4), x, sy, frontZ, 0.005));
          // Ventilation slits & drive bays
          g.add(box(bayW - 0.22, 0.08, 0.01, mat("#14171a", 0.3), x - 0.08, sy + 0.08, frontZ + bayD / 2, 0.002));
        }

        // Active LED status indicator strip (recoloured by office3d.ts)
        const led = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, 0.035, 0.02),
          new THREE.MeshStandardMaterial({ color: pal.rack.off, emissive: pal.rack.off, emissiveIntensity: 0.8 })
        );
        led.position.set(x + 0.22, 1.48, frontZ + bayD / 2 + 0.01);
        g.add(led);
        lights.push(led);
      }
      break;
    }

    case "cabinet": {
      // Filing cabinets with drawer lines and sleek horizontal handles
      for (let i = 0; i < Math.round(w); i++) {
        const x = -w / 2 + 0.5 + i;
        const cabH = 1.15;
        const cabD = d - 0.20;
        // Main metal cabinet body
        g.add(box(0.88, cabH, cabD, mat(pal.metal, 0.6), x, 0, -0.06, 0.02));

        // 3 filing drawers
        const numDrawers = 3;
        const dH = (cabH - 0.12) / numDrawers;
        for (let row = 0; row < numDrawers; row++) {
          const dy = 0.06 + row * dH;
          const frontZ = -0.06 + cabD / 2;
          // Drawer face
          g.add(box(0.80, dH - 0.03, 0.015, mat(pal.metal, 0.5), x, dy, frontZ, 0.005));
          // Horizontal handle
          g.add(box(0.24, 0.02, 0.02, mat(pal.dark, 0.4), x, dy + dH / 2 - 0.01, frontZ + 0.015, 0.004));
          // Small card/label holder
          g.add(box(0.08, 0.04, 0.005, mat(pal.white, 0.4), x + 0.25, dy + dH / 2 - 0.01, frontZ + 0.01, 0.002));
        }
      }
      break;
    }

    case "armchair":
    case "planter":
    default: {
      // Varied potted plants (tall leafy plant, round bush, small geometric pot)
      const plantType = Math.abs(Math.round(w * 17 + d * 23)) % 3;

      if (plantType === 0) {
        // Tall leafy indoor palm / fiddle fig
        const potRadius = 0.22;
        const potH = 0.44;
        const potGeo = new THREE.CylinderGeometry(potRadius, potRadius * 0.75, potH, 18);
        const potMesh = new THREE.Mesh(potGeo, mat(pal.pot, 0.8));
        potMesh.position.set(0, potH / 2, 0);
        addMesh(potMesh);

        // Dark soil
        const soilGeo = new THREE.CylinderGeometry(potRadius * 0.92, potRadius * 0.92, 0.02, 16);
        const soilMesh = new THREE.Mesh(soilGeo, mat(pal.dark, 0.9));
        soilMesh.position.set(0, potH - 0.01, 0);
        addMesh(soilMesh);

        // Slender stem
        const stemGeo = new THREE.CylinderGeometry(0.02, 0.025, 0.55, 8);
        const stemMesh = new THREE.Mesh(stemGeo, mat(pal.woodDark, 0.8));
        stemMesh.position.set(0, potH + 0.25, 0);
        addMesh(stemMesh);

        // Radiating leaves
        const numLeaves = 6;
        for (let l = 0; l < numLeaves; l++) {
          const angle = (l / numLeaves) * Math.PI * 2;
          const leafH = 0.28;
          const leafW = 0.16;
          const leaf = box(leafW, 0.015, leafH, mat(l % 2 === 0 ? pal.plant : pal.plantDark, 0.7), 0, 0, 0, 0.01);
          leaf.position.set(Math.sin(angle) * 0.16, potH + 0.35 + (l % 3) * 0.08, Math.cos(angle) * 0.16);
          leaf.rotation.y = angle;
          leaf.rotation.x = 0.45;
          g.add(leaf);
        }
      } else if (plantType === 1) {
        // Round sculpted topiary bush in a sleek square pot
        const potSize = 0.44;
        const potH = 0.40;
        g.add(box(potSize, potH, potSize, mat(pal.pot, 0.8), 0, 0, 0, 0.04));

        // Lush green foliage canopy
        const mainBushGeo = new THREE.DodecahedronGeometry(0.36, 1);
        const mainBush = new THREE.Mesh(mainBushGeo, mat(pal.plant, 0.7));
        mainBush.position.set(0, potH + 0.34, 0);
        addMesh(mainBush);

        const topBushGeo = new THREE.DodecahedronGeometry(0.22, 1);
        const topBush = new THREE.Mesh(topBushGeo, mat(pal.plantDark, 0.7));
        topBush.position.set(0.04, potH + 0.58, -0.03);
        addMesh(topBush);
      } else {
        // Geometric ceramic pot with upright snake plant leaves
        const potRadius = 0.24;
        const potH = 0.35;
        const potGeo = new THREE.CylinderGeometry(potRadius, potRadius * 0.8, potH, 16);
        const potMesh = new THREE.Mesh(potGeo, mat(pal.white, 0.6));
        potMesh.position.set(0, potH / 2, 0);
        addMesh(potMesh);

        // Upright sword leaves
        const leafAngles = [0, 0.8, 1.7, 2.5, 3.4, 4.3, 5.2];
        leafAngles.forEach((a, idx) => {
          const lH = 0.38 + (idx % 3) * 0.10;
          const leaf = box(0.08, lH, 0.02, mat(idx % 2 === 0 ? pal.plant : pal.plantDark, 0.7), 0, 0, 0, 0.005);
          leaf.position.set(Math.sin(a) * 0.09, potH + lH / 2 - 0.05, Math.cos(a) * 0.09);
          leaf.rotation.y = a;
          leaf.rotation.z = (Math.sin(a) * 0.15);
          g.add(leaf);
        });
      }
      break;
    }
  }

  return { group: g, screens, lights };
}

export function buildChair(style: ChairSpot["style"], pal: Palette): THREE.Group {
  const g = new THREE.Group();

  const addMesh = (mesh: THREE.Mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };

  if (style === "arm") {
    // Soft comfortable armchair: wood legs, plush seat, curved back, armrests
    const seatW = 0.54;
    const seatD = 0.52;
    const seatH = 0.40;

    // 4 angled wooden peg legs
    const legH = 0.18;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = box(0.045, legH, 0.045, mat(pal.woodDark, 0.7), sx * 0.20, 0, sz * 0.19, 0.01);
        leg.rotation.z = -sx * 0.12;
        leg.rotation.x = sz * 0.12;
        g.add(leg);
      }
    }

    // Plush seat cushion
    g.add(box(seatW, 0.16, seatD, mat(pal.fabric, 0.85), 0, legH - 0.02, 0.02, 0.06));

    // Comfy backrest
    g.add(box(seatW, 0.44, 0.16, mat(pal.fabricDark, 0.9), 0, legH + 0.10, -seatD / 2 + 0.08, 0.06));

    // Padded side arms
    for (const sx of [-1, 1]) {
      g.add(box(0.12, 0.26, seatD - 0.04, mat(pal.fabricDark, 0.9), sx * (seatW / 2 - 0.06), legH + 0.08, 0.02, 0.05));
    }
  } else {
    // Ergonomic task/office chair: 5-star base with casters, cylinder stem, contoured seat & back
    // 5-star base radiating from origin on the floor
    const numProngs = 5;
    for (let i = 0; i < numProngs; i++) {
      const angle = (i / numProngs) * Math.PI * 2;
      const prong = box(0.035, 0.025, 0.22, mat(pal.dark, 0.5), 0, 0.02, 0.11, 0.005);
      prong.position.set(0, 0.02, 0);
      prong.rotation.y = angle;
      g.add(prong);

      // Caster wheel at tip
      const wheel = box(0.025, 0.035, 0.035, mat(pal.dark, 0.3), Math.sin(angle) * 0.21, 0, Math.cos(angle) * 0.21, 0.005);
      g.add(wheel);
    }

    // Central pneumatic cylinder / stem
    const stemGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.32, 12);
    const stem = new THREE.Mesh(stemGeo, mat(pal.metal, 0.4));
    stem.position.set(0, 0.18, 0);
    addMesh(stem);

    // Seat mechanism housing under cushion
    g.add(box(0.18, 0.04, 0.18, mat(pal.dark, 0.6), 0, 0.34, 0, 0.01));

    // Contoured seat cushion (height ~0.41, perfect for seated character at y ~ 0.42)
    const seatColor = style === "front" || style === "back" ? pal.dark : pal.fabric;
    g.add(box(0.46, 0.06, 0.44, mat(seatColor, 0.8), 0, 0.38, 0.02, 0.04));

    // Curved ergonomic backrest support spine
    g.add(box(0.05, 0.36, 0.03, mat(pal.dark, 0.5), 0, 0.46, -0.20, 0.01));

    // Contoured backrest
    g.add(box(0.42, 0.34, 0.05, mat(seatColor, 0.8), 0, 0.52, -0.21, 0.04));

    // Modern slim armrests
    for (const sx of [-1, 1]) {
      // Vertical post
      g.add(box(0.03, 0.14, 0.04, mat(pal.dark, 0.5), sx * 0.22, 0.42, -0.02, 0.005));
      // Horizontal arm pad
      g.add(box(0.06, 0.02, 0.20, mat(pal.dark, 0.6), sx * 0.22, 0.55, 0.02, 0.01));
    }
  }

  return g;
}

