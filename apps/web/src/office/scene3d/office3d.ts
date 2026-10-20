import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { OUTFITS, type Outfit } from "../art/characters.ts";
import type { CharacterSnapshot } from "../brain/world.ts";
import type { OfficeGame, OfficeGameOptions } from "../scene/game.ts";
import { buildPerson, posePerson, type Person } from "./character.ts";
import { box, buildChair, buildFurniture, mat } from "./furniture.ts";
import { PALETTE } from "./palette.ts";
import { officePlan, type FurniturePiece } from "./plan.ts";

/**
 * The 3D office (owner request 2026-10-20: "proper and cantik", like Taskuary's isometric office).
 * Like the pixel scene it only DRAWS: every decision comes from OfficeWorld (the brain), so events,
 * catch-up, pokes, carrying and your own character behave the same. Lazy chunk (three.js is big).
 *
 * Map pixels → world: one tile (16 px) = one unit; map x → x, map y → z. Camera: orthographic,
 * looking from the south-east, so the tall walls (north and west) are the back of the diorama.
 */
const TALL = 2.4;
const LOW = 0.45;
const DRAG_PX = 6;
const PAN_PX = 4;
const LONG_PRESS_MS = 500;
const BLUR_FPS = 30;
const KEYS: Record<string, "up" | "down" | "left" | "right"> = {
  ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
};
/** Bubble icons (the pixel office draws these as sprites). */
const BUBBLE: Record<string, string> = {
  think: "💭", alert: "❗", browser: "🌐", search: "🔍", book: "📖", pr: "🔀", chat: "💬", check: "✅", fail: "❌",
  zzz: "💤", coffee: "☕", heart: "❤️", angry: "💢", note: "🎵", smile: "😊", exclaim: "❕",
};
const FRONT_YAW: Record<FurniturePiece["front"], number> = { down: 0, up: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 };
const FACING_YAW = { down: 0, up: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 } as const;

interface Press {
  agent: string | null;
  x0: number;
  y0: number;
  carrying: boolean;
  panning: boolean;
  menu: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  last: THREE.Vector3 | null;
}

interface CharView {
  person: Person;
  label: HTMLDivElement;
  bubble: HTMLDivElement;
  /** Shown / hidden through `visible`: CSS2DRenderer rewrites the element's display every frame. */
  labelObj: CSS2DObject;
  bubbleObj: CSS2DObject;
  last: CharacterSnapshot | null;
}

export function createOffice3d(parent: HTMLElement, o: OfficeGameOptions): OfficeGame {
  const T = o.layout.tileSize;
  const plan = officePlan(o.map, o.layout);
  const W = plan.width;
  const D = plan.depth;
  const center = new THREE.Vector3(W / 2, 0, D / 2);

  // ---------------------------------------------------------------- renderer, camera, light
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  parent.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  Object.assign(labels.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" });
  parent.style.position ||= "relative";
  parent.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.background);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  const viewDir = new THREE.Vector3(1, 1.25, 1.35).normalize();
  const target = center.clone();
  let zoom = 0; // 0 = fit
  let fitZoom = 1;

  scene.add(new THREE.HemisphereLight("#fffaf2", "#d8c9b4", 1.6));
  const sun = new THREE.DirectionalLight("#fff3e2", 2.2);
  sun.position.set(center.x - 14, 30, center.z + 18);
  sun.target.position.copy(center);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -W * 0.75;
  sun.shadow.camera.right = W * 0.75;
  sun.shadow.camera.top = D * 1.1;
  sun.shadow.camera.bottom = -D * 1.1;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0008;
  sun.shadow.radius = 4;
  scene.add(sun, sun.target);

  // ---------------------------------------------------------------- the room
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat(PALETTE.floor, 0.95));
  floor.rotation.x = -Math.PI / 2;
  floor.position.copy(center);
  floor.receiveShadow = true;
  scene.add(floor);
  for (const z of plan.zones) {
    const color = PALETTE.zones[z.zone];
    if (!color) continue;
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.2, z.w - 0.3), Math.max(0.2, z.d - 0.3)), mat(color, 0.95));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(z.x + z.w / 2, 0.005, z.z + z.d / 2);
    rug.receiveShadow = true;
    scene.add(rug);
  }
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const [tall, height, color] of [
    [true, TALL, PALETTE.wall],
    [false, LOW, PALETTE.wallLow],
  ] as const) {
    const cells = plan.walls.filter((w) => w.tall === tall);
    const inst = new THREE.InstancedMesh(wallGeo, mat(color, 0.9), cells.length);
    const m4 = new THREE.Matrix4();
    cells.forEach((c, i) => inst.setMatrixAt(i, m4.compose(new THREE.Vector3(c.x + 0.5, height / 2, c.y + 0.5), new THREE.Quaternion(), new THREE.Vector3(1, height, 1))));
    inst.castShadow = true;
    inst.receiveShadow = true;
    scene.add(inst);
  }

  const screens = new Map<number, THREE.Mesh[]>();
  const rackLights: THREE.Mesh[] = [];
  let execDesk: THREE.Group | null = null;
  for (const f of plan.furniture) {
    const side = f.front === "left" || f.front === "right";
    const parts = buildFurniture(f.kind, side ? f.h : f.w, side ? f.w : f.h, PALETTE);
    parts.group.position.set(f.x + f.w / 2, 0, f.y + f.h / 2);
    parts.group.rotation.y = FRONT_YAW[f.front];
    scene.add(parts.group);
    if (f.desk) screens.set(f.desk, parts.screens);
    rackLights.push(...parts.lights);
    if (f.kind === "exec_desk") execDesk = parts.group;
  }
  for (const c of plan.chairs) {
    const chair = buildChair(c.style, PALETTE);
    chair.position.set(c.x, 0, c.z + 0.2);
    chair.rotation.y = FACING_YAW[c.facing] + Math.PI;
    scene.add(chair);
  }
  // wall boards: the whiteboard and the notice board hang on the back wall over their zones
  const notes: THREE.Mesh[] = [];
  const boardAt = (zone: string, color: string) => {
    const z = o.layout.zones[zone];
    if (!z) return null;
    const b = box(z.w / T - 0.6, 0.9, 0.06, mat(color, 0.7), z.x / T + z.w / T / 2, 0.9, 2.03, 0.02);
    scene.add(b);
    return b;
  };
  boardAt("whiteboard", "#fbfaf7");
  const cork = boardAt("notice_board", "#cfae84");
  if (cork) {
    const colors = ["#f6e27a", "#a8dba0", "#f2a7b7", "#9cc4ec"];
    for (let i = 0; i < 8; i++) {
      const n = box(0.2, 0.2, 0.02, mat(colors[i % 4]!), cork.position.x - 1 + (i % 4) * 0.62, 1.05 + Math.floor(i / 4) * 0.36, 2.07, 0.01);
      n.visible = false;
      notes.push(n);
      scene.add(n);
    }
  }
  // the owner's in-tray: a stack of papers on the executive desk
  const tray: THREE.Mesh[] = [];
  if (execDesk) {
    for (let i = 0; i < 6; i++) {
      const sheet = box(0.3, 0.025, 0.22, mat("#ffffff", 0.6), 0.6, 0.73 + i * 0.03, 0.15, 0.005);
      sheet.visible = false;
      execDesk.add(sheet);
      tray.push(sheet);
    }
  }
  // the server-room lamp
  const lampMat = new THREE.MeshStandardMaterial({ color: "#f2b04f", emissive: "#f2b04f", emissiveIntensity: 0.9 });
  const sr = o.layout.zones.server_room;
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), lampMat);
  if (sr) lamp.position.set(sr.x / T + sr.w / T - 0.6, TALL - 0.3, 2.2);
  scene.add(lamp);

  // selection ring on the floor
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.38, 0.46, 40), new THREE.MeshBasicMaterial({ color: PALETTE.selection, transparent: true, opacity: 0.9 }));
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);

  // ---------------------------------------------------------------- characters
  const chars = new Map<string, CharView>();
  const outfitOf = (look: string): Outfit => OUTFITS[look] ?? OUTFITS["person-1"] ?? Object.values(OUTFITS)[0]!;
  const makeChar = (c: CharacterSnapshot): CharView => {
    const person = buildPerson(outfitOf(c.look), c.id);
    person.root.traverse((m) => (m.castShadow = true));
    scene.add(person.root);
    const label = document.createElement("div");
    label.className = "office3d-label";
    // looks: .office3d-label / .office3d-bubble in style.css
    const labelObj = new CSS2DObject(label);
    labelObj.position.set(0, 1.55, 0);
    labelObj.visible = false;
    person.root.add(labelObj);
    const bubble = document.createElement("div");
    bubble.className = "office3d-bubble";
    bubble.style.pointerEvents = "auto";
    bubble.addEventListener("pointerup", (e) => {
      e.stopPropagation();
      const last = chars.get(c.id)?.last;
      if (last?.needsApproval) o.onApproval(c.id);
      else o.onSelect(c.id);
    });
    const bubbleObj = new CSS2DObject(bubble);
    bubbleObj.position.set(0, 1.9, 0);
    bubbleObj.visible = false;
    person.root.add(bubbleObj);
    const v: CharView = { person, label, bubble, labelObj, bubbleObj, last: null };
    chars.set(c.id, v);
    return v;
  };

  // ---------------------------------------------------------------- camera fit + zoom
  const corners = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(W, 0, 0), new THREE.Vector3(0, TALL, 0), new THREE.Vector3(W, 0, D), new THREE.Vector3(0, 0, D), new THREE.Vector3(W, TALL, 0)];
  function placeCamera() {
    const w = parent.clientWidth || 640;
    const h = parent.clientHeight || 400;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = `${w}px`;
    renderer.domElement.style.height = `${h}px`;
    labels.setSize(w, h);
    camera.position.copy(target).addScaledVector(viewDir, 120);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    // the whole office (with its tall walls) in view, with a margin
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const inv = camera.matrixWorldInverse;
    for (const c of corners) {
      const p = c.clone().applyMatrix4(inv);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const spanX = (maxX - minX) * 1.06;
    const spanY = (maxY - minY) * 1.1;
    fitZoom = Math.min(w / spanX, h / spanY);
    const z = zoom || fitZoom;
    camera.left = -w / 2 / z;
    camera.right = w / 2 / z;
    camera.top = h / 2 / z;
    camera.bottom = -h / 2 / z;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(() => placeCamera());
  ro.observe(parent);
  placeCamera();

  // ---------------------------------------------------------------- input
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const play = !!o.interactive;
  let press: Press | null = null;
  let hover: string | null = null;
  let near: string | null = null;
  const rel = (e: PointerEvent | MouseEvent) => {
    const r = renderer.domElement.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  };
  const aim = (e: PointerEvent | MouseEvent) => {
    const p = rel(e);
    ndc.set((p.x / p.w) * 2 - 1, -(p.y / p.h) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  };
  const agentAt = (e: PointerEvent | MouseEvent): string | null => {
    aim(e);
    const roots = [...chars.values()].filter((v) => v.person.root.visible && !v.last?.isMe).map((v) => v.person.root);
    const hit = raycaster.intersectObjects(roots, true)[0];
    return (hit?.object.userData.agent as string | undefined) ?? null;
  };
  const floorAt = (e: PointerEvent | MouseEvent): THREE.Vector3 | null => {
    aim(e);
    return raycaster.ray.intersectPlane(ground, new THREE.Vector3());
  };
  const canvas = renderer.domElement;
  const onDown = (e: PointerEvent) => {
    if (e.button === 1) return;
    canvas.setPointerCapture(e.pointerId);
    const agent = agentAt(e);
    const p: Press = { agent, x0: e.clientX, y0: e.clientY, carrying: false, panning: false, menu: false, timer: null, last: floorAt(e) };
    press = p;
    if (!agent || !play) return;
    if (e.button === 2) {
      p.menu = true;
      const r = rel(e);
      o.onMenu?.(agent, r.x, r.y);
      return;
    }
    p.timer = setTimeout(() => {
      if (press !== p || p.carrying || p.panning) return;
      p.menu = true;
      const r = rel(e);
      o.onMenu?.(agent, r.x, r.y);
    }, LONG_PRESS_MS);
  };
  const onMove = (e: PointerEvent) => {
    const p = press;
    if (!p) {
      const a = agentAt(e);
      hover = a;
      canvas.style.cursor = a ? "pointer" : "grab";
      return;
    }
    const moved = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
    if (p.agent && play && !p.menu) {
      if (!p.carrying && moved > DRAG_PX) {
        if (p.timer) clearTimeout(p.timer);
        p.carrying = o.world.grab(p.agent);
      }
      if (p.carrying) {
        const f = floorAt(e);
        if (f) o.world.holdAt(p.agent, f.x * T, f.z * T);
        return;
      }
      if (moved <= DRAG_PX) return;
    }
    if (!p.panning && moved <= PAN_PX) return;
    p.panning = true;
    if (p.timer) clearTimeout(p.timer);
    canvas.style.cursor = "grabbing";
    const f = floorAt(e);
    if (f && p.last) {
      target.add(p.last.clone().sub(f));
      target.x = Math.min(W, Math.max(0, target.x));
      target.z = Math.min(D, Math.max(0, target.z));
      placeCamera();
      p.last = floorAt(e);
    }
  };
  const onUp = (e: PointerEvent) => {
    const p = press;
    press = null;
    canvas.style.cursor = "grab";
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    if (p.carrying && p.agent) {
      const f = floorAt(e);
      const action = f ? o.world.drop(p.agent, f.x * T, f.z * T) : null;
      if (action) o.onAction?.(action);
      return;
    }
    if (p.panning || p.menu) return;
    if (p.agent) {
      o.onSelect(p.agent);
      if (play) o.world.poke(p.agent);
    } else {
      o.onSelect(null);
      const f = floorAt(e);
      if (play && f) o.world.meWalkTo(f.x * T, f.z * T);
    }
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1 : -1);
  };
  const onKey = (e: KeyboardEvent) => {
    const dir = KEYS[e.code];
    const el = document.activeElement as HTMLElement | null;
    if (!dir || !play || (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)))) return;
    e.preventDefault();
    o.world.meStep(dir);
  };
  const noMenu = (e: MouseEvent) => play && e.preventDefault();
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", noMenu);
  window.addEventListener("keydown", onKey);
  canvas.style.cursor = "grab";

  function zoomBy(step: number) {
    zoom = Math.min(fitZoom * 5, Math.max(fitZoom * 0.7, (zoom || fitZoom) * 1.25 ** step));
    placeCamera();
  }

  // ---------------------------------------------------------------- frame loop
  let raf = 0;
  let lastFrame = performance.now();
  let lastDraw = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (document.hidden) {
      lastFrame = now;
      return;
    }
    // an unfocused window draws at 30 fps
    if (!document.hasFocus() && now - lastDraw < 1000 / BLUR_FPS) return;
    lastDraw = now;
    // the first rAF time can be a little older than performance.now() taken at start: never a negative step
    const dtMs = Math.max(0, Math.min(now - lastFrame, 100));
    lastFrame = now;
    draw(dtMs, now);
  };

  function draw(dtMs: number, now: number) {
    const world = o.world;
    world.update(dtMs);
    const t = now / 1000;
    const selected = o.selected();
    const seen = new Set<string>();
    for (const c of world.characters()) {
      seen.add(c.id);
      const v = chars.get(c.id) ?? makeChar(c);
      v.last = c;
      v.person.root.position.set(c.x / T, 0, c.y / T);
      posePerson(v.person, c, dtMs / 1000, t);
      const showName = c.id === selected || c.id === hover || (c.isMe && !hover && !selected);
      const name = c.isMe ? `${c.name} (you)` : c.name;
      if (v.label.textContent !== name) v.label.textContent = name;
      v.labelObj.visible = showName && c.alpha > 0.1;
      const icon = c.bubble ? BUBBLE[c.bubble] : null;
      if (icon && c.alpha > 0.1) {
        if (v.bubble.textContent !== icon) v.bubble.textContent = icon;
        v.bubbleObj.visible = true;
        v.bubble.classList.toggle("needs-you", c.needsApproval);
      } else v.bubbleObj.visible = false;
      if (c.id === selected) {
        ring.position.set(c.x / T, 0.02, c.y / T);
        ring.visible = c.alpha > 0.1;
      }
    }
    for (const [id, v] of chars) {
      if (seen.has(id)) continue;
      v.person.root.removeFromParent();
      v.label.remove();
      v.bubble.remove();
      chars.delete(id);
      if (hover === id) hover = null;
    }
    if (!selected || !seen.has(selected)) ring.visible = false;
    const n = world.nearMe();
    if (n !== near) {
      near = n;
      o.onNear?.(n);
    }

    const states = world.screens();
    for (const [desk, meshes] of screens) {
      const kind = states.get(desk) ?? "off";
      const color = PALETTE.screen[kind] ?? PALETTE.screen.off!;
      for (const s of meshes) {
        const m = s.material as THREE.MeshStandardMaterial;
        m.color.set(color);
        m.emissive.set(color);
        m.emissiveIntensity = kind === "off" ? 0.15 : kind === "code" ? 0.75 + Math.sin(t * 6 + desk) * 0.15 : 0.8;
      }
    }
    const racks = world.racks();
    rackLights.forEach((l, i) => {
      const st = racks[i] ?? "off";
      const m = l.material as THREE.MeshStandardMaterial;
      const color = PALETTE.rack[st] ?? PALETTE.rack.off!;
      m.color.set(color);
      m.emissive.set(color);
      m.emissiveIntensity = st === "error" ? (Math.floor(t * 2.5) % 2 ? 1 : 0.2) : st === "on" ? 0.7 + Math.sin(t * 4 + i) * 0.2 : 0.1;
    });
    const lampState = world.lamp();
    const lampColor = lampState === "ok" ? "#7fd1a6" : lampState === "warn" ? "#f2b04f" : "#e8796b";
    lampMat.color.set(lampColor);
    lampMat.emissive.set(lampColor);
    lampMat.emissiveIntensity = lampState === "bad" ? 0.5 + Math.abs(Math.sin(t * 3)) * 0.6 : 0.8;
    const count = world.trayCount();
    tray.forEach((s, i) => (s.visible = i < count));
    const pinned = world.notesPinned();
    notes.forEach((nm, i) => (nm.visible = i < pinned));

    renderer.render(scene, camera);
    labels.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  return {
    zoomBy,
    poke(agentId) {
      o.world.poke(agentId);
    },
    recenter() {
      zoom = 0;
      target.copy(center);
      placeCamera();
    },
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", noMenu);
      window.removeEventListener("keydown", onKey);
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
      });
      renderer.dispose();
      canvas.remove();
      labels.domElement.remove();
    },
  };
}
