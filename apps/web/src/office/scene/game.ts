import Phaser from "phaser";
import type { OfficeLayout, TiledMap } from "../map/tmj.ts";
import type { CharacterSnapshot, DropAction, OfficeWorld } from "../brain/world.ts";
import { bodyOffset, bubbleFrame, characterFrame, headTop, screenFrame } from "./frames.ts";

/**
 * The office view. Phaser only draws: every decision comes from OfficeWorld,
 * which the Vue side keeps in sync with the reducer state. Loaded lazily, so
 * the list/kanban views never pay for Phaser.
 */
export interface OfficeGameOptions {
  map: TiledMap;
  layout: OfficeLayout;
  world: OfficeWorld;
  /** URL prefix the map's files are served from (tileset, atlases). */
  assetBase: string;
  onSelect(agentId: string | null): void;
  onApproval(agentId: string): void;
  selected(): string | null;
  /**
   * Playing with the agents (the live office only; Replay leaves it off): tap = poke,
   * drag = carry, long-press / right-click = menu, tap the floor or arrow keys = walk your character.
   */
  interactive?: boolean;
  /** Long-press / right-click on an agent: screen position inside the canvas. */
  onMenu?(agentId: string, x: number, y: number): void;
  /** A drop that should open something (Drafts, Chat). */
  onAction?(action: NonNullable<DropAction>): void;
  /** The agent next to your character changed (null = nobody). */
  onNear?(agentId: string | null): void;
}

export interface OfficeGame {
  zoomBy(step: number): void;
  /** Make an agent hop with an emote (from the menu). */
  poke(agentId: string): void;
  /** Back to the fitted zoom, centred on the office. */
  recenter(): void;
  destroy(): void;
}

const D = { furniture: 2, props: 4, overhead: 100_000, bubble: 150_000, ui: 200_000 };
const BACKGROUND = "#1b2622";
const BLUR_FPS = 30;
/** Pointer travel (screen px) before a press on an agent becomes a carry, or on the floor a pan. */
const DRAG_PX = 6;
const PAN_PX = 4;
const LONG_PRESS_MS = 500;
const KEYS: Record<string, "up" | "down" | "left" | "right"> = {
  ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
};

/** One press of the pointer: on an agent (maybe becoming a carry or a menu) or on the floor (maybe a pan). */
interface Press {
  agent: string | null;
  onBubble: boolean;
  x0: number;
  y0: number;
  carrying: boolean;
  panning: boolean;
  menu: boolean;
  timer: Phaser.Time.TimerEvent | null;
}

interface CharSprites {
  body: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  bubble: Phaser.GameObjects.Image;
  speechText: Phaser.GameObjects.Text;
  fx: Phaser.GameObjects.Image;
  doc: Phaser.GameObjects.Image;
  last: CharacterSnapshot | null;
}

const pngFor = (json: string) => json.replace(/\.json$/i, ".png");

class OfficeScene extends Phaser.Scene {
  #o!: OfficeGameOptions;
  #chars = new Map<string, CharSprites>();
  #screens = new Map<number, Phaser.GameObjects.Image>();
  #racks: Phaser.GameObjects.Image[] = [];
  #lamp: Phaser.GameObjects.Image | null = null;
  #tray: Phaser.GameObjects.Image | null = null;
  #notes: Phaser.GameObjects.Image[] = [];
  #ring!: Phaser.GameObjects.Ellipse;
  #label!: Phaser.GameObjects.Text;
  #hover: string | null = null;
  #zoom = 0; // 0 = fit
  #fitted = false;
  #dragging = false;
  #press: Press | null = null;
  #near: string | null = null;

  constructor() {
    super("office");
  }

  init(data: OfficeGameOptions) {
    this.#o = data;
  }

  preload() {
    const { map, layout, assetBase } = this.#o;
    this.load.tilemapTiledJSON("office", map);
    this.load.image("tiles", assetBase + map.tilesets[0]!.image);
    this.load.atlas("chars", assetBase + pngFor(layout.assets.characters), assetBase + layout.assets.characters);
    this.load.atlas("props", assetBase + pngFor(layout.assets.props), assetBase + layout.assets.props);
  }

  create() {
    const { map: tmj, layout } = this.#o;
    const map = this.make.tilemap({ key: "office" });
    const tileset = map.addTilesetImage(tmj.tilesets[0]!.name, "tiles");
    if (!tileset) throw new Error("tileset failed to load");
    ["floor", "walls", "furniture"].forEach((name, i) => map.createLayer(name, tileset, 0, 0)?.setDepth(i));
    map.createLayer("overhead", tileset, 0, 0)?.setDepth(D.overhead);

    const meta = (this.textures.get("props").customData as { meta?: { noticeSlots?: { x: number; y: number }[] } }).meta;
    for (const p of layout.props) {
      const img = (frame: string) => this.add.image(p.x, p.y, "props", frame).setOrigin(0, 0).setDepth(D.props);
      if (p.type === "screen") this.#screens.set(Number(p.props.desk), img("screen/off"));
      else if (p.type === "rack") this.#racks[Number(p.props.rack) - 1] = img("rack/off");
      else if (p.type === "lamp") this.#lamp = img("lamp/warn");
      else if (p.type === "tray") this.#tray = img("tray/0");
      else if (p.type === "notice_board")
        for (const [i, s] of (meta?.noticeSlots ?? []).entries())
          this.#notes.push(img(["note/yellow", "note/green", "note/pink", "note/blue"][i % 4]!).setPosition(p.x + s.x, p.y + s.y).setVisible(false));
      else if (p.type === "decor") this.add.image(p.x, p.y, "props", String(p.props.frame)).setOrigin(0.5, 1).setDepth(p.y - 1);
    }
    for (const place of layout.places) {
      if (place.chair !== "none") this.add.image(place.x, place.y, "props", `chair/${place.chair}`).setOrigin(0.5, 1).setDepth(place.y - 1);
    }

    this.#ring = this.add.ellipse(0, 0, 14, 6).setStrokeStyle(1, 0x3fc296).setVisible(false);
    this.#label = this.add
      .text(0, 0, "", { fontFamily: "Silkscreen, monospace", fontSize: "8px", color: "#ffffff", backgroundColor: "#1d2a25dd", padding: { x: 2, y: 1 } })
      .setOrigin(0.5, 1)
      .setDepth(D.ui)
      .setVisible(false);

    // pointer: a press on an agent can become a poke (tap), a carry (drag) or a menu (long-press /
    // right-click); a press on the floor deselects and walks your character there, or pans the view
    const play = !!this.#o.interactive;
    if (play) this.input.mouse?.disableContextMenu();
    this.input.on("pointerdown", (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      this.#dragging = false;
      const hit = over.find((o) => o.getData("agent"));
      const agent = (hit?.getData("agent") as string | undefined) ?? null;
      const press: Press = { agent, onBubble: !!hit?.getData("bubble"), x0: p.x, y0: p.y, carrying: false, panning: false, menu: false, timer: null };
      this.#press = press;
      if (!agent) {
        if (!over.length) this.#o.onSelect(null);
        return;
      }
      if (!play || press.onBubble) return;
      if (p.rightButtonDown()) {
        press.menu = true;
        this.#o.onMenu?.(agent, p.x, p.y);
        return;
      }
      press.timer = this.time.delayedCall(LONG_PRESS_MS, () => {
        if (this.#press !== press || press.carrying) return;
        press.menu = true;
        this.#o.onMenu?.(agent, p.x, p.y);
      });
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      const press = this.#press;
      if (!p.isDown || !press) return;
      const moved = Math.hypot(p.x - press.x0, p.y - press.y0);
      if (press.agent && play && !press.onBubble && !press.menu) {
        if (!press.carrying && moved > DRAG_PX) {
          press.timer?.remove();
          press.carrying = this.#o.world.grab(press.agent);
        }
        if (press.carrying) {
          const w = this.cameras.main.getWorldPoint(p.x, p.y);
          this.#o.world.holdAt(press.agent, w.x, w.y + 10); // the feet hang under the pointer
          this.#dragging = true;
          return;
        }
        if (moved <= DRAG_PX) return;
      }
      if (!press.panning && moved <= PAN_PX) return;
      press.panning = true;
      this.#dragging = true;
      press.timer?.remove();
      const cam = this.cameras.main;
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      const press = this.#press;
      this.#press = null;
      if (!press) return;
      press.timer?.remove();
      const w = this.cameras.main.getWorldPoint(p.x, p.y);
      if (press.carrying && press.agent) {
        const action = this.#o.world.drop(press.agent, w.x, w.y + 10);
        if (action) this.#o.onAction?.(action);
        return;
      }
      if (press.panning || press.menu || press.onBubble) return;
      if (press.agent) {
        this.#o.onSelect(press.agent);
        if (play) this.#o.world.poke(press.agent);
      } else if (play) this.#o.world.meWalkTo(w.x, w.y);
    });
    // arrow keys / WASD walk your character (not while typing in a field)
    if (play) {
      this.input.keyboard?.on("keydown", (e: KeyboardEvent) => {
        const dir = KEYS[e.code];
        const el = document.activeElement as HTMLElement | null;
        if (!dir || (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)))) return;
        e.preventDefault();
        this.#o.world.meStep(dir);
      });
    }

    this.#fit();
    this.scale.on("resize", () => this.#fit());
  }

  recenter() {
    this.#zoom = 0;
    this.#fitted = false;
    this.#fit();
  }

  zoomBy(step: number) {
    const fit = this.#fitZoom();
    this.#zoom = Phaser.Math.Clamp((this.#zoom || fit) + step, 1, 6);
    if (this.#zoom === fit) this.#zoom = 0;
    this.#fit();
  }

  /** Integer zoom that (nearly) fits: rounds up once the next step is 60% there, the rest can be panned. */
  #fitZoom() {
    const { width, height } = this.scale;
    const mw = this.#o.layout.width * this.#o.layout.tileSize;
    const mh = this.#o.layout.height * this.#o.layout.tileSize;
    const fit = Math.min(width / mw, height / mh);
    const z = Math.floor(fit);
    return Math.max(1, fit - z >= 0.6 ? z + 1 : z);
  }

  /**
   * Zoom + pan bounds. Only the first fit centres the map; after that (window resize, zoom
   * buttons) the spot the owner was looking at stays in the middle, so panning is never undone.
   */
  #fit() {
    const cam = this.cameras.main;
    const mw = this.#o.layout.width * this.#o.layout.tileSize;
    const mh = this.#o.layout.height * this.#o.layout.tileSize;
    const keep = this.#fitted ? { x: cam.midPoint.x, y: cam.midPoint.y } : { x: mw / 2, y: mh / 2 };
    cam.setBackgroundColor(BACKGROUND);
    cam.setZoom(this.#zoom || this.#fitZoom());
    // Pan inside the map; on an axis where the map is smaller than the view, the bounds are the view itself, centred.
    const vw = this.scale.width / cam.zoom;
    const vh = this.scale.height / cam.zoom;
    cam.setBounds(Math.min(0, (mw - vw) / 2), Math.min(0, (mh - vh) / 2), Math.max(mw, vw), Math.max(mh, vh));
    cam.centerOn(keep.x, keep.y);
    this.#fitted = true;
  }

  update(time: number, delta: number) {
    const world = this.#o.world;
    world.update(Math.min(delta, 100));
    const selected = this.#o.selected();
    const seen = new Set<string>();

    for (const c of world.characters()) {
      seen.add(c.id);
      const s = this.#chars.get(c.id) ?? this.#makeChar(c);
      this.#drawChar(s, c, time);
      if (c.id === selected || c.id === this.#hover || (c.isMe && !this.#hover && !selected)) {
        this.#label.setText(c.isMe ? `${c.name} (you)` : c.name).setPosition(Math.round(c.x), Math.round(c.y - headTop(c) - (c.bubble ? 15 : 1))).setVisible(true);
      }
      if (c.id === selected) this.#ring.setPosition(Math.round(c.x), Math.round(c.y - 1)).setDepth(c.y - 0.7).setVisible(c.alpha > 0);
    }
    for (const [id, s] of this.#chars) {
      if (seen.has(id)) continue;
      for (const o of [s.body, s.shadow, s.bubble, s.speechText, s.fx, s.doc]) o.destroy();
      this.#chars.delete(id);
      if (this.#hover === id) this.#hover = null;
    }
    if (!selected || !seen.has(selected)) this.#ring.setVisible(false);
    const near = world.nearMe();
    if (near !== this.#near) {
      this.#near = near;
      this.#o.onNear?.(near);
    }
    if (!(selected && seen.has(selected)) && !(this.#hover && seen.has(this.#hover)) && !seen.has("me")) this.#label.setVisible(false);

    const screens = world.screens();
    for (const [desk, img] of this.#screens) img.setFrame(screenFrame(screens.get(desk) ?? "off", time, desk));
    const racks = world.racks();
    this.#racks.forEach((img, i) => {
      const st = racks[i] ?? "off";
      if (st === "on") img.setFrame((Math.floor(time / 500) + i) % 2 ? "rack/on1" : "rack/on2").setAlpha(1);
      else if (st === "error") img.setFrame("rack/error").setAlpha(Math.floor(time / 400) % 2 ? 1 : 0.35);
      else img.setFrame("rack/off").setAlpha(1);
    });
    const lamp = world.lamp();
    this.#lamp?.setFrame(`lamp/${lamp}`).setAlpha(lamp === "bad" ? 0.55 + 0.45 * Math.abs(Math.sin(time / 300)) : 1);
    this.#tray?.setFrame(`tray/${world.trayCount()}`);
    this.#notes.forEach((n, i) => n.setVisible(i < world.notesPinned()));
  }

  #makeChar(c: CharacterSnapshot): CharSprites {
    const body = this.add.image(c.x, c.y, "chars", characterFrame(c, 0)).setOrigin(0.5, 1);
    body.on("pointerover", () => (this.#hover = c.id));
    body.on("pointerout", () => this.#hover === c.id && (this.#hover = null));
    // agents: taps, carries and menus are handled by the scene's pointer handlers (data "agent")
    if (!c.isMe) body.setInteractive({ useHandCursor: true }).setData("agent", c.id);
    else body.setInteractive();
    const bubble = this.add.image(0, 0, "props", "bubble/think1").setOrigin(0.5, 1).setDepth(D.bubble).setVisible(false);
    bubble.setInteractive({ useHandCursor: true }).setData("agent", c.id).setData("bubble", true);
    bubble.on("pointerup", () => {
      if (this.#dragging) return;
      const last = this.#chars.get(c.id)?.last;
      if (last?.needsApproval) this.#o.onApproval(c.id);
      else this.#o.onSelect(c.id);
    });
    const s: CharSprites = {
      body,
      shadow: this.add.image(0, 0, "props", "fx/shadow").setOrigin(0.5, 0.5),
      bubble,
      speechText: this.add
        .text(0, 0, "", {
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: "9px",
          color: "#ffffff",
          backgroundColor: "#101613f0",
          padding: { x: 5, y: 3 },
          wordWrap: { width: 140 },
          align: "center",
        })
        .setOrigin(0.5, 1)
        .setDepth(D.bubble + 10)
        .setVisible(false),
      fx: this.add.image(0, 0, "props", "fx/dizzy1").setOrigin(0.5, 1).setDepth(D.bubble).setVisible(false),
      doc: this.add.image(0, 0, "props", "fx/doc").setOrigin(0.5, 1).setVisible(false),
      last: null,
    };
    this.#chars.set(c.id, s);
    return s;
  }

  #drawChar(s: CharSprites, c: CharacterSnapshot, time: number) {
    s.last = c;
    const off = bodyOffset(c, time);
    const x = Math.round(c.x);
    const floorY = Math.round(c.y);
    const y = floorY + off.y;
    // carried agents float above everything; the shadow stays on the floor
    s.body.setFrame(characterFrame(c, time)).setPosition(x + off.x, y).setDepth(c.held ? D.ui - 1 : c.y).setAlpha(c.alpha);
    s.shadow.setPosition(x, floorY - 1).setDepth(c.y - 0.6).setAlpha(c.alpha * (c.held ? 0.6 : 1)).setVisible(!c.seated);

    const top = y - headTop(c);
    const bubble = bubbleFrame(c, time);
    if (bubble) {
      const pulse = c.needsApproval ? Math.round(Math.abs(Math.sin(time / 220)) * 2) : 0;
      s.bubble.setFrame(bubble).setPosition(x, top - pulse).setAlpha(c.alpha).setVisible(true);
    } else s.bubble.setVisible(false);

    if (c.speechText && c.alpha > 0.1) {
      s.speechText.setText(c.speechText).setPosition(x, top - (bubble ? 16 : 4)).setAlpha(c.alpha).setVisible(true);
    } else {
      s.speechText.setVisible(false);
    }

    if (c.effect === "dizzy") s.fx.setFrame(Math.floor(time / 250) % 2 ? "fx/dizzy1" : "fx/dizzy2").setPosition(x, top + 3).setVisible(true);
    else s.fx.setVisible(false);

    if (c.carrying) {
      const side = c.facing === "right" ? 6 : c.facing === "left" ? -6 : 3;
      // held in front; hidden behind the body when walking away from the viewer
      s.doc.setPosition(x + side, y - 6).setDepth(c.facing === "up" ? c.y - 0.5 : c.y + 0.5).setAlpha(c.alpha).setVisible(true);
    } else s.doc.setVisible(false);
  }
}

export function createOfficeGame(parent: HTMLElement, options: OfficeGameOptions): OfficeGame {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: BACKGROUND,
    pixelArt: true,
    roundPixels: true,
    banner: false,
    audio: { noAudio: true },
    // a limit makes Phaser use its limiting step; we lift it while focused (rate 0) and cap at 30 fps when blurred
    fps: { limit: 60 },
    scale: { mode: Phaser.Scale.RESIZE, width: parent.clientWidth || 640, height: parent.clientHeight || 384 },
    scene: [],
  });
  const loop = game.loop as unknown as { _limitRate: number };
  const setFps = (fps: number) => (loop._limitRate = fps ? 1000 / fps : 0);
  game.events.once(Phaser.Core.Events.READY, () => {
    setFps(0);
    game.scene.add("office", OfficeScene, true, options);
  });
  // hidden tabs are paused by Phaser itself; an unfocused window drops to 30 fps
  game.events.on(Phaser.Core.Events.BLUR, () => setFps(BLUR_FPS));
  game.events.on(Phaser.Core.Events.FOCUS, () => setFps(0));

  return {
    zoomBy(step) {
      (game.scene.getScene("office") as OfficeScene | null)?.zoomBy(step);
    },
    poke(agentId) {
      options.world.poke(agentId);
    },
    recenter() {
      (game.scene.getScene("office") as OfficeScene | null)?.recenter();
    },
    destroy() {
      game.destroy(true);
    },
  };
}
