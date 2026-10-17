import Phaser from "phaser";
import type { OfficeLayout, TiledMap } from "../map/tmj.ts";
import type { CharacterSnapshot, OfficeWorld } from "../brain/world.ts";
import { bubbleFrame, characterFrame, headTop, screenFrame } from "./frames.ts";

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
}

export interface OfficeGame {
  zoomBy(step: number): void;
  /** Back to the fitted zoom, centred on the office. */
  recenter(): void;
  destroy(): void;
}

const D = { furniture: 2, props: 4, overhead: 100_000, bubble: 150_000, ui: 200_000 };
const BACKGROUND = "#1b2622";
const BLUR_FPS = 30;

interface CharSprites {
  body: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  bubble: Phaser.GameObjects.Image;
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

    // empty space: deselect; drag pans when the office is bigger than the view
    this.input.on("pointerdown", (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      this.#dragging = false;
      if (!over.length) this.#o.onSelect(null);
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return;
      const cam = this.cameras.main;
      const dx = p.x - p.prevPosition.x;
      const dy = p.y - p.prevPosition.y;
      if (Math.abs(dx) + Math.abs(dy) > 0) this.#dragging = true;
      cam.scrollX -= dx / cam.zoom;
      cam.scrollY -= dy / cam.zoom;
    });

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
      if (c.id === selected || c.id === this.#hover) {
        this.#label.setText(c.name).setPosition(Math.round(c.x), Math.round(c.y - headTop(c) - (c.bubble ? 15 : 1))).setVisible(true);
      }
      if (c.id === selected) this.#ring.setPosition(Math.round(c.x), Math.round(c.y - 1)).setDepth(c.y - 0.7).setVisible(c.alpha > 0);
    }
    for (const [id, s] of this.#chars) {
      if (seen.has(id)) continue;
      for (const o of [s.body, s.shadow, s.bubble, s.fx, s.doc]) o.destroy();
      this.#chars.delete(id);
      if (this.#hover === id) this.#hover = null;
    }
    if (!selected || !seen.has(selected)) this.#ring.setVisible(false);
    if (!(selected && seen.has(selected)) && !(this.#hover && seen.has(this.#hover))) this.#label.setVisible(false);

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
    body.setInteractive({ useHandCursor: true });
    body.on("pointerover", () => (this.#hover = c.id));
    body.on("pointerout", () => this.#hover === c.id && (this.#hover = null));
    body.on("pointerup", () => !this.#dragging && this.#o.onSelect(c.id));
    const bubble = this.add.image(0, 0, "props", "bubble/think1").setOrigin(0.5, 1).setDepth(D.bubble).setVisible(false);
    bubble.setInteractive({ useHandCursor: true });
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
      fx: this.add.image(0, 0, "props", "fx/dizzy1").setOrigin(0.5, 1).setDepth(D.bubble).setVisible(false),
      doc: this.add.image(0, 0, "props", "fx/doc").setOrigin(0.5, 1).setVisible(false),
      last: null,
    };
    this.#chars.set(c.id, s);
    return s;
  }

  #drawChar(s: CharSprites, c: CharacterSnapshot, time: number) {
    s.last = c;
    const x = Math.round(c.x);
    const y = Math.round(c.y);
    s.body.setFrame(characterFrame(c, time)).setPosition(x, y).setDepth(c.y).setAlpha(c.alpha);
    s.shadow.setPosition(x, y - 1).setDepth(c.y - 0.6).setAlpha(c.alpha).setVisible(!c.seated);

    const top = y - headTop(c);
    const bubble = bubbleFrame(c, time);
    if (bubble) {
      const pulse = c.needsApproval ? Math.round(Math.abs(Math.sin(time / 220)) * 2) : 0;
      s.bubble.setFrame(bubble).setPosition(x, top - pulse).setAlpha(c.alpha).setVisible(true);
    } else s.bubble.setVisible(false);

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
    recenter() {
      (game.scene.getScene("office") as OfficeScene | null)?.recenter();
    },
    destroy() {
      game.destroy(true);
    },
  };
}
