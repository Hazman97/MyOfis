import { dayKey, type OfficeState } from "@agent-office/shared";
import { hashString, outfitFor } from "../art/characters.ts";
import type { Facing, OfficeLayout, Place } from "../map/tmj.ts";
import { Pathfinder } from "./path.ts";
import {
  busyFamilies,
  intentStep,
  momentSteps,
  steadyIntent,
  whereKey,
  type AgentInfo,
  type BubbleKind,
  type Intent,
  type Pose,
  type ScreenKind,
  type Step,
} from "./intent.ts";

/**
 * The office "director": turns reducer output into characters that walk,
 * sit and react. Pure and deterministic (own clock, advanced by update()), so
 * the Phaser scene only draws `characters()` and tests can drive it without a
 * browser.
 *
 * Catch-up rule (spec §10.5): every change starts a new plan whose first step
 * must arrive within CATCH_UP_MS. Older moments still queued are dropped,
 * and walking speeds up as needed.
 */
export const BASE_SPEED = 56; // px/s, about 3.5 tiles a second
export const CATCH_UP_MS = 2000;
const DEADLINE_MARGIN_MS = 300;
const FADE_MS = 350;
const RECONCILE_MS = 250;
const MEETING_DEBOUNCE_MS = 3000;
const CHAT_EVERY_MS = 7000;
const CHAT_FOR_MS = 2600;

export interface CharacterSnapshot {
  id: string;
  name: string;
  look: string;
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
  seated: boolean;
  pose: Pose;
  bubble: BubbleKind | null;
  carrying: boolean;
  effect: "dizzy" | null;
  alpha: number;
  needsApproval: boolean;
}

export type RackState = "on" | "off" | "error";
export type LampState = "ok" | "warn" | "bad";

interface Char {
  id: string;
  name: string;
  look: string;
  x: number;
  y: number;
  facing: Facing;
  path: { x: number; y: number }[];
  speed: number;
  step: Step | null;
  queue: Step[];
  arrived: boolean;
  holdLeft: number;
  place: Place | null;
  claimed: string | null;
  alpha: number;
  phase: "in" | "leaving" | "gone";
  intent: Intent;
  where: string;
  momentId: number;
  /** When the current plan started, and when its first step arrived (catch-up check). */
  planAt: number;
  planStep: number;
  firstArrivedAt: number | null;
}

const T = 16;
const tileOf = (x: number, y: number) => ({ x: Math.floor(x / T), y: Math.floor((y - 1) / T) });

export class OfficeWorld {
  readonly layout: OfficeLayout;
  #path: Pathfinder;
  #places = new Map<string, Place>();
  #byZone = new Map<string, Place[]>();
  #chars = new Map<string, Char>();
  #claims = new Map<string, string>(); // place id -> char id
  #t = 0;
  #lastReconcile = -Infinity;
  #state: OfficeState | null = null;
  #placed = false;
  #agents: AgentInfo[] = [];
  #looks: readonly string[] | undefined;
  #desks = new Map<string, string>(); // agent id -> desk place id
  #familySince = new Map<string, number>();
  #trayBase = -1;
  #trayDrops = 0;
  #notes = 0;
  #racks: RackState[] = [];
  #lamp: LampState = "warn";

  constructor(layout: OfficeLayout, looks?: readonly string[]) {
    this.layout = layout;
    this.#looks = looks;
    this.#path = new Pathfinder(layout);
    for (const p of layout.places) {
      this.#places.set(p.id, p);
      if (!this.#byZone.has(p.zone)) this.#byZone.set(p.zone, []);
      this.#byZone.get(p.zone)!.push(p);
    }
  }

  get time(): number {
    return this.#t;
  }

  /**
   * Feed the latest reducer state and agent list. The first call that has
   * agents places everyone instantly and does not replay old moments.
   */
  sync(state: OfficeState, agents: AgentInfo[]): void {
    const first = !this.#placed;
    this.#state = state;
    this.#agents = agents;
    this.#reconcile(first);
    if (agents.length) this.#placed = true;
  }

  update(dtMs: number): void {
    this.#t += dtMs;
    if (this.#state && this.#t - this.#lastReconcile >= RECONCILE_MS) this.#reconcile(false);
    for (const ch of this.#chars.values()) this.#tick(ch, dtMs);
    for (const [id, ch] of this.#chars) if (ch.phase === "gone") this.#chars.delete(id);
  }

  characters(): CharacterSnapshot[] {
    const chatting = this.#chatters();
    return [...this.#chars.values()].map((ch) => {
      const step = ch.step;
      const at = ch.arrived && step;
      const seated = !!(at && ch.place && ch.place.kind !== "spot");
      let pose: Pose = at ? step.pose : "stand";
      if (seated && pose === "stand") pose = "sit";
      if (!seated && pose !== "hand") pose = "stand";
      return {
        id: ch.id,
        name: ch.name,
        look: ch.look,
        x: ch.x,
        y: ch.y,
        facing: ch.facing,
        moving: !ch.arrived,
        seated,
        pose,
        bubble: at ? (chatting.has(ch.id) && !step.bubble ? "chat" : step.bubble) : null,
        carrying: !!step?.carrying && !ch.arrived,
        effect: at ? step.effect : null,
        alpha: ch.alpha,
        needsApproval: ch.intent.bubble === "alert",
      };
    });
  }

  /** Desk number (1-based, from "desk-N") -> what its monitor shows. */
  screens(): Map<number, ScreenKind> {
    const out = new Map<number, ScreenKind>();
    for (const [agentId, placeId] of this.#desks) {
      const ch = this.#chars.get(agentId);
      const n = Number(placeId.replace(/^desk-/, ""));
      if (Number.isFinite(n)) out.set(n, ch && ch.phase === "in" ? ch.intent.screen : "off");
    }
    return out;
  }

  racks(): RackState[] {
    return this.#racks;
  }

  lamp(): LampState {
    return this.#lamp;
  }

  trayCount(): number {
    return Math.min(3, Math.max(0, this.#trayBase) + this.#trayDrops);
  }

  notesPinned(): number {
    return this.#notes;
  }

  deskOf(agentId: string): string | null {
    return this.#desks.get(agentId) ?? null;
  }

  /** For tests and the debug overlay. */
  debug(agentId: string) {
    const ch = this.#chars.get(agentId);
    if (!ch) return null;
    return {
      stepKind: ch.step?.kind ?? null,
      arrived: ch.arrived,
      place: ch.place?.id ?? null,
      x: ch.x,
      y: ch.y,
      queued: ch.queue.length,
      phase: ch.phase,
      planAt: ch.planAt,
      firstArrivedAt: ch.firstArrivedAt,
    };
  }

  // ------------------------------------------------------------------ planning

  #reconcile(first: boolean): void {
    const state = this.#state!;
    this.#lastReconcile = this.#t;
    this.#desks = assignDesks(this.#agents, this.layout);
    const slugToId = new Map(this.#agents.map((a) => [a.slug, a.id]));

    // runners -> racks and the server-room lamp
    const runners = Object.values(state.runners).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    this.#racks = runners.map((r) => (r.online ? "on" : "error"));
    this.#lamp = runners.length === 0 ? "warn" : runners.some((r) => !r.online) ? "bad" : "ok";
    const anyOnline = runners.some((r) => r.online);

    if (this.#trayBase < 0) {
      const today = dayKey(new Date().toISOString());
      this.#trayBase = Object.values(state.runs).filter((r) => r.status === "done" && r.ended_at && dayKey(r.ended_at) === today).length;
    }

    // a handoff chain with both ends busy for a while -> meeting room
    const families = busyFamilies(state);
    for (const root of [...this.#familySince.keys()]) if (!families.has(root)) this.#familySince.delete(root);
    const inMeeting = new Set<string>();
    for (const [root, ids] of families) {
      if (!this.#familySince.has(root)) this.#familySince.set(root, this.#t);
      if (first || this.#t - this.#familySince.get(root)! >= MEETING_DEBOUNCE_MS) for (const id of ids) inMeeting.add(id);
    }

    const queued = new Set(Object.values(state.jobs).filter((j) => j.status === "queued").map((j) => j.agent_id));
    const seen = new Set<string>();
    for (const agent of this.#agents) {
      seen.add(agent.id);
      const view = state.agents[agent.id];
      const runnerOnline = agent.runner_id ? !!state.runners[agent.runner_id]?.online : anyOnline;
      const intent = steadyIntent(agent, view, {
        desk: this.#desks.get(agent.id) ?? null,
        runnerOnline,
        inMeeting: inMeeting.has(agent.id),
        hasQueuedJob: queued.has(agent.id),
        paused: state.paused,
      });
      const look = outfitFor(agent, this.#looks);
      let ch = this.#chars.get(agent.id);
      if (!ch || ch.phase === "gone") {
        if (intent.present) this.#spawn(agent, look, intent, first, view?.moment?.event_id ?? 0);
        continue;
      }
      ch.name = agent.name;
      ch.look = look;
      const moment = view?.moment;
      const where = whereKey(intent);
      if (moment && moment.event_id > ch.momentId) {
        ch.momentId = moment.event_id;
        const steps = first ? [] : momentSteps(moment, (slug) => this.#desks.get(slugToId.get(slug) ?? "") ?? null);
        if (steps.length || where !== ch.where) this.#plan(ch, [...steps, intentStep(intent)]);
      } else if (where !== ch.where) {
        this.#plan(ch, [intentStep(intent)]);
      } else {
        // same place, new look (bubble, pose): change it where they stand
        const last = ch.queue.length ? ch.queue[ch.queue.length - 1]! : ch.step;
        if (last && last.kind !== "moment") {
          last.pose = intent.pose;
          last.bubble = intent.bubble;
        }
      }
      ch.intent = intent;
      ch.where = where;
      if (ch.phase === "leaving" && intent.present) ch.phase = "in";
    }
    // agents deleted from the config walk out
    for (const ch of this.#chars.values()) {
      if (seen.has(ch.id) || ch.step?.kind === "leave") continue;
      ch.intent = { ...ch.intent, present: false, screen: "off", bubble: null };
      this.#plan(ch, [intentStep(ch.intent)]);
    }
  }

  #spawn(agent: AgentInfo, look: string, intent: Intent, instant: boolean, momentId: number): Char {
    const door = this.#byZone.get("entrance")?.[0];
    const ch: Char = {
      id: agent.id,
      name: agent.name,
      look,
      x: door?.x ?? 0,
      y: door?.y ?? 0,
      facing: "up",
      path: [],
      speed: BASE_SPEED,
      step: null,
      queue: [],
      arrived: true,
      holdLeft: 0,
      place: null,
      claimed: null,
      alpha: instant ? 1 : 0,
      phase: "in",
      intent,
      where: whereKey(intent),
      momentId,
      planAt: this.#t,
      planStep: 0,
      firstArrivedAt: this.#t,
    };
    this.#chars.set(agent.id, ch);
    if (instant) {
      ch.step = intentStep(intent);
      const place = this.#resolve(ch, ch.step);
      if (place) {
        ch.x = place.x;
        ch.y = place.y;
        ch.facing = place.facing;
        ch.place = place;
      }
      ch.arrived = true;
    } else {
      this.#plan(ch, [intentStep(intent)]);
    }
    return ch;
  }

  /** Replace whatever the character was doing with `steps`; the first must land within the catch-up window. */
  #plan(ch: Char, steps: Step[]): void {
    ch.queue = steps;
    ch.planAt = this.#t;
    ch.planStep = 0;
    ch.firstArrivedAt = null;
    this.#next(ch, this.#t + CATCH_UP_MS - DEADLINE_MARGIN_MS);
  }

  #next(ch: Char, deadline: number | null): void {
    const step = ch.queue.shift() ?? null;
    if (!step) return;
    ch.step = step;
    ch.planStep++;
    ch.holdLeft = step.hold;
    const place = "here" in step.target ? ch.place : this.#resolve(ch, step);
    ch.place = place;
    ch.path = place ? this.#route(ch, place) : [];
    const dist = pathLength(ch.x, ch.y, ch.path);
    const secondsLeft = deadline === null ? Infinity : Math.max(0.25, (deadline - this.#t) / 1000);
    ch.speed = Math.max(BASE_SPEED, dist / secondsLeft);
    ch.arrived = false;
    if (dist === 0) this.#arrive(ch);
  }

  #resolve(ch: Char, step: Step): Place | null {
    const t = step.target;
    let place: Place | null = null;
    if ("place" in t) place = this.#places.get(t.place) ?? null;
    else if ("zone" in t) place = this.#pick(ch, t.zone);
    else if ("visit" in t) place = this.#visitSpot(t.visit);
    // leaving frees the old spot; a short visit keeps it (they come back)
    if (step.kind === "leave") this.#release(ch);
    else if (place && !("visit" in t)) this.#claim(ch, place);
    return place;
  }

  #pick(ch: Char, zone: string): Place | null {
    const options = this.#byZone.get(zone);
    if (!options?.length) return null;
    // keep the current spot when already in that zone
    if (ch.place && ch.place.zone === zone && this.#claims.get(ch.place.id) === ch.id) return ch.place;
    const ranked = [...options].sort((a, b) => hashString(ch.id + a.id) - hashString(ch.id + b.id));
    return ranked.find((p) => !this.#claims.has(p.id) || this.#claims.get(p.id) === ch.id) ?? ranked[0]!;
  }

  #claim(ch: Char, place: Place): void {
    if (ch.claimed && ch.claimed !== place.id && this.#claims.get(ch.claimed) === ch.id) this.#claims.delete(ch.claimed);
    this.#claims.set(place.id, ch.id);
    ch.claimed = place.id;
  }

  #release(ch: Char): void {
    if (ch.claimed && this.#claims.get(ch.claimed) === ch.id) this.#claims.delete(ch.claimed);
    ch.claimed = null;
  }

  /** A standing spot beside a desk, for visitors (handoffs). */
  #visitSpot(deskId: string): Place | null {
    const desk = this.#places.get(deskId);
    if (!desk) return null;
    const options: [number, number, Facing][] = [
      [desk.tx - 1, desk.ty, "right"],
      [desk.tx + 2, desk.ty, "left"],
      [desk.tx, desk.ty + 1, "up"],
    ];
    const free = options.find(([x, y]) => this.#path.isFree(x, y));
    if (!free) return null;
    const [tx, ty, facing] = free;
    return { id: `visit-${deskId}`, kind: "spot", zone: "desks", facing, chair: "none", x: tx * T + T / 2, y: (ty + 1) * T, tx, ty };
  }

  #route(ch: Char, place: Place): { x: number; y: number }[] {
    const from = tileOf(ch.x, ch.y);
    const tiles = this.#path.find(from.x, from.y, place.tx, place.ty);
    if (!tiles) {
      // unreachable (map edited mid-walk?): appear there rather than get stuck
      ch.x = place.x;
      ch.y = place.y;
      return [];
    }
    const pts = tiles.slice(1).map((p) => ({ x: p.x * T + T / 2, y: (p.y + 1) * T }));
    pts.pop();
    pts.push({ x: place.x, y: place.y });
    return pts;
  }

  // ------------------------------------------------------------------ motion

  #tick(ch: Char, dt: number): void {
    if (ch.phase === "in" && ch.alpha < 1) ch.alpha = Math.min(1, ch.alpha + dt / FADE_MS);
    if (ch.phase === "leaving") {
      ch.alpha = Math.max(0, ch.alpha - dt / FADE_MS);
      if (ch.alpha === 0) {
        ch.phase = "gone";
        this.#release(ch);
      }
      return;
    }
    if (!ch.step) return;
    if (!ch.arrived) {
      let budget = (ch.speed * dt) / 1000;
      while (budget > 0 && ch.path.length) {
        const wp = ch.path[0]!;
        const dx = wp.x - ch.x;
        const dy = wp.y - ch.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.01) ch.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
        if (d <= budget) {
          ch.x = wp.x;
          ch.y = wp.y;
          ch.path.shift();
          budget -= d;
        } else {
          ch.x += (dx / d) * budget;
          ch.y += (dy / d) * budget;
          budget = 0;
        }
      }
      if (!ch.path.length) this.#arrive(ch);
      return;
    }
    if (ch.step.hold > 0) {
      ch.holdLeft -= dt;
      if (ch.holdLeft <= 0) this.#next(ch, null);
    }
  }

  #arrive(ch: Char): void {
    ch.arrived = true;
    if (ch.planStep === 1 && ch.firstArrivedAt === null) ch.firstArrivedAt = this.#t;
    if (ch.place) ch.facing = ch.place.facing;
    const step = ch.step!;
    if (step.onArrive === "drop_tray") this.#trayDrops++;
    if (step.onArrive === "pin_note") this.#notes = Math.min(6, this.#notes + 1);
    if (step.kind === "leave") ch.phase = "leaving";
    else if (step.hold === 0 && ch.queue.length) this.#next(ch, null);
  }

  /** Idle agents standing around in the pantry chat now and then. */
  #chatters(): Set<string> {
    const out = new Set<string>();
    if (this.#t % CHAT_EVERY_MS > CHAT_FOR_MS) return out;
    const idle = [...this.#chars.values()].filter((c) => c.arrived && c.phase === "in" && c.step?.kind === "steady" && c.place?.zone === "pantry");
    if (idle.length < 2) return out;
    // a different pair each round
    const round = Math.floor(this.#t / CHAT_EVERY_MS);
    const sorted = idle.sort((a, b) => a.id.localeCompare(b.id));
    const i = round % sorted.length;
    out.add(sorted[i]!.id);
    out.add(sorted[(i + 1) % sorted.length]!.id);
    return out;
  }
}

function pathLength(x: number, y: number, path: { x: number; y: number }[]): number {
  let d = 0;
  for (const p of path) {
    d += Math.hypot(p.x - x, p.y - y);
    x = p.x;
    y = p.y;
  }
  return d;
}

/**
 * Desk per agent, stable: agents with desk_x/desk_y set get the nearest free
 * desk to that tile, everyone else the first free desk in list order.
 */
export function assignDesks(agents: AgentInfo[], layout: OfficeLayout): Map<string, string> {
  const desks = layout.places.filter((p) => p.kind === "desk");
  const free = new Set(desks.map((d) => d.id));
  const out = new Map<string, string>();
  for (const a of agents.filter((x) => x.desk_x || x.desk_y)) {
    const best = desks.filter((d) => free.has(d.id)).sort((p, q) => Math.hypot(p.tx - a.desk_x, p.ty - a.desk_y) - Math.hypot(q.tx - a.desk_x, q.ty - a.desk_y))[0];
    if (best) {
      out.set(a.id, best.id);
      free.delete(best.id);
    }
  }
  for (const a of agents) {
    if (out.has(a.id)) continue;
    const d = desks.find((x) => free.has(x.id));
    if (!d) continue;
    out.set(a.id, d.id);
    free.delete(d.id);
  }
  return out;
}
