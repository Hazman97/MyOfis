import * as THREE from "three";
import type { Outfit } from "../art/characters.ts";
import type { CharacterSnapshot } from "../brain/world.ts";
import { box } from "./furniture.ts";

/**
 * A low-poly person built from shapes (our own art), coloured from the same outfits as the pixel
 * office, posed from the brain's snapshot every frame (walk, sit, type, raise a hand, hop, carried).
 * Local space: feet on y = 0, looking toward +Z.
 */
export interface Person {
  root: THREE.Group;
  /** Turned toward the facing direction; holds every body part. */
  body: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  torso: THREE.Group;
  /** Every material of this person (cloned, so fading one person does not fade the others). */
  materials: THREE.MeshStandardMaterial[];
  doc: THREE.Mesh;
  /** Smoothed facing angle and walk phase. */
  yaw: number;
  phase: number;
}

const FACING_YAW: Record<CharacterSnapshot["facing"], number> = { down: 0, up: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 };
const SEAT = 0.42;

export function buildPerson(outfit: Outfit, id: string): Person {
  const materials: THREE.MeshStandardMaterial[] = [];
  const m = (color: string, roughness = 0.8) => {
    const x = new THREE.MeshStandardMaterial({ color, roughness, transparent: true });
    materials.push(x);
    return x;
  };
  const tag = (o: THREE.Object3D) => o.traverse((c) => (c.userData.agent = id));
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const limb = (color: string, w: number, h: number, x: number, y: number) => {
    // pivot at the top (hip / shoulder) so it swings
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const part = box(w, h, w, m(color), 0, -h, 0, 0.04);
    pivot.add(part);
    return pivot;
  };
  const legL = limb(outfit.pants, 0.15, 0.44, -0.09, 0.48);
  const legR = limb(outfit.pants, 0.15, 0.44, 0.09, 0.48);
  for (const leg of [legL, legR]) leg.add(box(0.16, 0.06, 0.22, m(outfit.shoes), 0, -0.48, 0.03, 0.03));

  const torso = new THREE.Group();
  torso.position.y = 0.46;
  torso.add(box(0.36, 0.4, 0.22, m(outfit.top), 0, 0, 0, 0.08));
  const head = new THREE.Group();
  head.position.y = 0.42;
  head.add(box(0.28, 0.28, 0.26, m(outfit.skin, 0.7), 0, 0, 0, 0.1));
  // eyes on the +Z face
  for (const sx of [-1, 1]) head.add(box(0.035, 0.05, 0.02, m("#2a2522"), sx * 0.065, 0.12, 0.13, 0.01));
  if (outfit.head === "hijab") {
    head.add(box(0.33, 0.3, 0.31, m(outfit.hair), 0, 0.02, -0.02, 0.12));
    head.add(box(0.36, 0.16, 0.26, m(outfit.hair), 0, -0.1, -0.02, 0.06));
  } else {
    // hair: a cap on top and the back of the head (longer for a bob)
    head.add(box(0.3, 0.1, 0.28, m(outfit.hair), 0, 0.24, -0.005, 0.05));
    head.add(box(0.3, outfit.head === "bob" ? 0.26 : 0.18, 0.08, m(outfit.hair), 0, outfit.head === "bob" ? 0.04 : 0.12, -0.12, 0.04));
  }
  if (outfit.accessories?.includes("cap")) head.add(box(0.32, 0.08, 0.3, m(outfit.cap ?? "#334"), 0, 0.3, 0, 0.04), box(0.28, 0.03, 0.14, m(outfit.capBrim ?? "#223"), 0, 0.3, 0.18, 0.01));
  if (outfit.accessories?.includes("glasses")) head.add(box(0.22, 0.05, 0.02, m(outfit.glasses ?? "#222"), 0, 0.11, 0.14, 0.01));
  if (outfit.accessories?.includes("headphones")) head.add(box(0.34, 0.06, 0.08, m(outfit.phones ?? "#222"), 0, 0.3, 0, 0.03));
  torso.add(head);
  const armL = limb(outfit.top, 0.11, 0.38, -0.24, 0.38);
  const armR = limb(outfit.top, 0.11, 0.38, 0.24, 0.38);
  for (const arm of [armL, armR]) arm.add(box(0.1, 0.08, 0.1, m(outfit.skin, 0.7), 0, -0.44, 0, 0.04));
  torso.add(armL, armR);

  // the document a character carries (deliveries, handoffs)
  const doc = box(0.22, 0.02, 0.28, m("#ffffff", 0.6), 0, 0.12, 0.2, 0.01);
  doc.visible = false;
  torso.add(doc);

  body.add(legL, legR, torso);
  tag(root);
  return { root, body, legL, legR, armL, armR, torso, materials, doc, yaw: 0, phase: Math.random() * 6 };
}

/** Pose the person from the snapshot. `dt` in seconds, `t` = time in seconds. */
export function posePerson(p: Person, c: CharacterSnapshot, dt: number, t: number): void {
  // turn smoothly toward the facing direction
  const target = FACING_YAW[c.facing];
  let diff = target - p.yaw;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  p.yaw += diff * Math.min(1, dt * 12);
  p.body.rotation.y = p.yaw;

  let lift = 0;
  let legSwing = 0;
  let armSwing = 0;
  let armForward = 0;
  let raise = 0;
  let lean = 0;
  if (c.moving) {
    p.phase += dt * 9;
    legSwing = Math.sin(p.phase) * 0.55;
    armSwing = -legSwing * 0.8;
    lift = Math.abs(Math.cos(p.phase)) * 0.03;
  }
  const sitting = c.seated || c.pose === "sit" || c.pose === "type";
  if (sitting) {
    lift = SEAT - 0.5;
    legSwing = 0;
  }
  if (c.pose === "type") {
    armForward = -1.1 + Math.sin(t * 14) * 0.08;
    lean = 0.08;
  }
  if (c.pose === "hand") raise = -2.6;
  if (c.effect === "jump") lift += Math.abs(Math.sin(t * 9)) * 0.25;
  if (c.effect === "dizzy") p.body.rotation.z = Math.sin(t * 6) * 0.12;
  else p.body.rotation.z = 0;
  if (c.held) {
    lift = 0.6;
    legSwing = Math.sin(t * 10) * 0.4;
    armSwing = -legSwing;
    raise = -2.4;
  }

  p.body.position.y = lift;
  // sitting: thighs forward (legs at -90°), shins down is good enough at this size
  const hip = sitting ? -1.45 : 0;
  p.legL.rotation.x = hip + legSwing;
  p.legR.rotation.x = hip - legSwing;
  p.armL.rotation.x = (armForward || armSwing) + (c.carrying ? -0.9 : 0);
  p.armR.rotation.x = raise || (armForward ? armForward + Math.sin(t * 14 + 1) * 0.08 : -armSwing) + (c.carrying ? -0.9 : 0);
  p.torso.rotation.x = lean;
  p.doc.visible = c.carrying;

  for (const x of p.materials) {
    x.opacity = c.alpha;
    x.depthWrite = c.alpha > 0.98;
  }
  p.root.visible = c.alpha > 0.02;
}
