import { apply, initialState, type AgentEvent, type OfficeState } from "@agent-office/shared";

/**
 * Replay mode (spec §10.7): rebuild the office as it was at the start of a
 * window, then feed the window's events back in at 1x/4x/16x. Pure: no timers,
 * the view advances `Replay.seek(ms)`.
 */
export const SPEEDS = [1, 4, 16] as const;
export type Speed = (typeof SPEEDS)[number];

/** Long quiet stretches (e.g. waiting for an approval) are shortened so a replay never stalls. */
export const MAX_GAP_MS = 4000;

/** Playback offset (ms at 1x) of every event: real time between events, gaps capped. */
export function offsets(events: AgentEvent[]): number[] {
  const out: number[] = [];
  let t = 0;
  let prev: number | null = null;
  for (const e of events) {
    const at = Date.parse(e.ts);
    if (prev !== null) t += Math.min(MAX_GAP_MS, Math.max(0, at - prev));
    out.push(t);
    prev = at;
  }
  return out;
}

export class Replay {
  readonly state: OfficeState;
  readonly duration: number;
  #at = 0;
  #next = 0;
  readonly #offsets: number[];

  /** `before`: every event before the window (builds the starting picture). `events`: the window, oldest first. */
  constructor(
    before: Iterable<AgentEvent>,
    readonly events: AgentEvent[],
  ) {
    this.state = initialState();
    for (const e of before) apply(this.state, e);
    this.#offsets = offsets(events);
    this.duration = this.#offsets.at(-1) ?? 0;
  }

  /** Playback position in ms (1x timeline). */
  get position(): number {
    return this.#at;
  }

  get done(): boolean {
    return this.#next >= this.events.length;
  }

  /** Index of the last applied event, or -1. */
  get applied(): number {
    return this.#next - 1;
  }

  /** Move forward to `ms` (1x timeline), applying every event up to it. Returns the events applied. */
  advanceTo(ms: number): AgentEvent[] {
    const out: AgentEvent[] = [];
    this.#at = Math.max(this.#at, Math.min(ms, this.duration));
    while (this.#next < this.events.length && this.#offsets[this.#next]! <= this.#at) {
      const e = this.events[this.#next++]!;
      apply(this.state, e);
      out.push(e);
    }
    return out;
  }
}

/** Split a full event list into "before the window" and "the window" (both by event id, inclusive). */
export function windowOf(all: AgentEvent[], fromId: number, toId: number): { before: AgentEvent[]; events: AgentEvent[] } {
  return { before: all.filter((e) => e.id < fromId), events: all.filter((e) => e.id >= fromId && e.id <= toId) };
}

/** Event ids covering a time range [from, to] (ISO strings). Null when no event falls inside. */
export function idsForTimeRange(all: AgentEvent[], from: string, to: string): { fromId: number; toId: number } | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  const inside = all.filter((e) => {
    const t = Date.parse(e.ts);
    return t >= a && t <= b;
  });
  return inside.length ? { fromId: inside[0]!.id, toId: inside.at(-1)!.id } : null;
}
