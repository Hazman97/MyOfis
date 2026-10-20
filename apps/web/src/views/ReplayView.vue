<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { useRoute } from "vue-router";
import { History, Pause, Play, RotateCcw } from "lucide-vue-next";
import type { AgentEvent } from "@agent-office/shared";
import EventTimeline from "../components/EventTimeline.vue";
import PageHeader from "../components/PageHeader.vue";
import { api } from "../api/http.ts";
import { useOffice } from "../stores/office.ts";
import { OFFICE_ASSETS, type CharacterManifest } from "../office/assets.ts";
import { parseOfficeMap, type OfficeLayout, type TiledMap } from "../office/map/tmj.ts";
import { OfficeWorld } from "../office/brain/world.ts";
import type { AgentInfo } from "../office/brain/intent.ts";
import type { OfficeGame } from "../office/scene/game.ts";
import { Replay, SPEEDS, idsForTimeRange, windowOf, type Speed } from "../office/replay.ts";
import { fmtDateTime } from "../format.ts";

/**
 * Replay mode (spec §10.7): rebuild the office as it was, then let the
 * characters re-enact a past run or time range at 1x / 4x / 16x.
 * Uses its own world and reducer state: the live office is untouched.
 */
const office = useOffice();
const route = useRoute();

const source = ref<"run" | "range">("run");
const runId = ref(typeof route.query.run === "string" ? route.query.run : "");
const from = ref("");
const to = ref("");
const speed = ref<Speed>(4);
const playing = ref(false);
const loading = ref(false);
const error = ref("");
const replay = shallowRef<Replay | null>(null);
const position = ref(0);
const applied = ref<AgentEvent[]>([]);
const host = ref<HTMLDivElement>();

let game: OfficeGame | null = null;
let world: OfficeWorld | null = null;
let assets: { map: TiledMap; layout: OfficeLayout; looks: string[] } | null = null;
let raf = 0;
let last = 0;

const runs = computed(() =>
  Object.values(office.state.runs)
    .filter((r) => r.status !== "running")
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, 100),
);
const runLabel = (id: string) => {
  const r = office.state.runs[id];
  if (!r) return id;
  const job = office.state.jobs[r.job_id];
  return `${office.agentById[r.agent_id]?.name ?? "Agent"} · ${job?.title ?? "job"} · ${fmtDateTime(r.started_at)}`;
};
const infos = (): AgentInfo[] =>
  office.agents.map((a) => ({ id: a.id, slug: a.slug, name: a.name, sprite: a.sprite, enabled: a.enabled, runner_id: a.runner_id, desk_x: a.desk_x, desk_y: a.desk_y }));
const progress = computed(() => (replay.value?.duration ? Math.min(100, (position.value / replay.value.duration) * 100) : 0));
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(`${OFFICE_ASSETS}${name}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Every event from the start up to `toId` (the starting picture needs all history). */
async function eventsUpTo(toId: number): Promise<AgentEvent[]> {
  const all: AgentEvent[] = [];
  let since = 0;
  for (;;) {
    const page = (await api.events(since, 5000)).events;
    all.push(...page);
    if (!page.length || page.at(-1)!.id >= toId || page.length < 5000) return all;
    since = page.at(-1)!.id;
  }
}

async function load() {
  error.value = "";
  stop();
  loading.value = true;
  try {
    let window: { fromId: number; toId: number } | null;
    let all: AgentEvent[];
    if (source.value === "run") {
      if (!runId.value) throw new Error("Pick a run first.");
      const { events } = await api.run(runId.value);
      if (!events.length) throw new Error("This run has no events.");
      // a little after the run ends, so the walk to your desk or the next handoff is included
      window = { fromId: events[0]!.id, toId: events.at(-1)!.id + 30 };
      all = await eventsUpTo(window.toId);
      // only the few seconds after the run (the walk back), not the next job's events
      const end = events.at(-1)!;
      const tailUntil = Date.parse(end.ts) + 5000;
      window.toId = all.filter((e) => e.id <= window!.toId && (e.id <= end.id || Date.parse(e.ts) <= tailUntil)).reduce((m, e) => Math.max(m, e.id), end.id);
    } else {
      if (!from.value || !to.value) throw new Error("Pick a start and an end time.");
      all = await eventsUpTo(Number.MAX_SAFE_INTEGER);
      window = idsForTimeRange(all, new Date(from.value).toISOString(), new Date(to.value).toISOString());
      if (!window) throw new Error("Nothing happened in that time range.");
    }
    const { before, events } = windowOf(all, window.fromId, window.toId);
    replay.value = new Replay(before, events);
    position.value = 0;
    applied.value = [];
    await nextTick(); // the replay section (and its canvas host) renders once a replay exists
    await mountWorld();
    play();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

async function mountWorld() {
  if (!host.value || !replay.value) return;
  if (!assets) {
    const [map, chars] = await Promise.all([getJson<TiledMap>("office.tmj"), getJson<CharacterManifest>("characters.json")]);
    assets = { map, layout: parseOfficeMap(map), looks: chars.meta.outfits };
  }
  game?.destroy();
  world = new OfficeWorld(assets.layout, assets.looks);
  world.sync(replay.value.state, infos()); // the starting picture, placed instantly
  const { createOfficeGame } = await import("../office/scene/game.ts");
  game = createOfficeGame(host.value, { map: assets.map, layout: assets.layout, world, assetBase: OFFICE_ASSETS, onSelect: () => {}, onApproval: () => {}, selected: () => null });
}

function tick(now: number) {
  const r = replay.value;
  if (!r || !playing.value) return;
  position.value = Math.min(r.duration, position.value + (now - last) * speed.value);
  last = now;
  const fresh = r.advanceTo(position.value);
  if (fresh.length) {
    applied.value = [...applied.value, ...fresh].slice(-200);
    world?.sync(r.state, infos());
  }
  if (r.done) {
    playing.value = false;
    return;
  }
  raf = requestAnimationFrame(tick);
}

function play() {
  if (!replay.value || replay.value.done) return;
  playing.value = true;
  last = performance.now();
  raf = requestAnimationFrame(tick);
}
function stop() {
  playing.value = false;
  cancelAnimationFrame(raf);
}

onMounted(() => {
  if (runId.value) void load();
});
onBeforeUnmount(() => {
  stop();
  game?.destroy();
});
</script>

<template>
  <div class="space-y-4">
    <PageHeader sign="Office" title="Replay" description="Watch the office re-enact a past run or a stretch of time. Long waits are shortened so nothing stalls." />

    <!-- Configuration Card -->
    <section class="card p-4 space-y-3 sm:space-y-0 sm:flex sm:flex-wrap sm:items-end sm:gap-3">
      <div class="inline-flex rounded-xl border border-line bg-surface-2/60 p-1" role="tablist" aria-label="Replay source">
        <button
          role="tab"
          class="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150"
          :class="source === 'run' ? 'bg-accent text-accent-ink shadow-sm' : 'text-muted hover:text-fg hover:bg-surface-2'"
          :aria-selected="source === 'run'"
          @click="source = 'run'"
        >
          A run
        </button>
        <button
          role="tab"
          class="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150"
          :class="source === 'range' ? 'bg-accent text-accent-ink shadow-sm' : 'text-muted hover:text-fg hover:bg-surface-2'"
          :aria-selected="source === 'range'"
          @click="source = 'range'"
        >
          Time range
        </button>
      </div>

      <div v-if="source === 'run'" class="min-w-0 sm:min-w-64 flex-1 w-full sm:w-auto">
        <label class="label" for="rp-run">Run</label>
        <select id="rp-run" v-model="runId" class="input truncate">
          <option value="">Pick a finished run…</option>
          <option v-for="r in runs" :key="r.id" :value="r.id">{{ runLabel(r.id) }}</option>
        </select>
      </div>

      <template v-else>
        <div class="min-w-0 flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3 w-full sm:w-auto">
          <div>
            <label class="label" for="rp-from">From</label>
            <input id="rp-from" v-model="from" type="datetime-local" class="input" />
          </div>
          <div>
            <label class="label" for="rp-to">To</label>
            <input id="rp-to" v-model="to" type="datetime-local" class="input" />
          </div>
        </div>
      </template>

      <button class="btn btn-primary w-full sm:w-auto shadow-sm" :disabled="loading" @click="load">
        <RotateCcw :size="14" :class="loading ? 'motion-safe:animate-spin' : ''" /> {{ loading ? "Loading…" : "Load replay" }}
      </button>
    </section>

    <!-- Error notice -->
    <p v-if="error" class="rounded-xl border border-danger/30 bg-danger-soft px-4 py-2.5 text-xs font-medium text-danger">
      {{ error }}
    </p>

    <!-- Empty state when no replay loaded -->
    <section v-if="!replay" class="card flex flex-col items-center justify-center p-12 text-center">
      <div class="mb-3 flex size-12 items-center justify-center rounded-2xl border border-line bg-surface-2 text-muted shadow-sm">
        <History :size="24" class="text-faint" />
      </div>
      <h3 class="font-semibold text-sm tracking-tight text-fg">No replay loaded</h3>
      <p class="mt-1 max-w-sm text-xs text-muted">
        Pick a finished run above and press Load replay.
      </p>
    </section>

    <!-- Replay View Mode -->
    <section v-if="replay" class="space-y-3">
      <!-- Playback Controls -->
      <div class="card p-3 sm:p-4 flex flex-wrap items-center gap-2.5 sm:gap-3">
        <button class="btn shadow-sm" :disabled="!replay || replay.done" :aria-label="playing ? 'Pause' : 'Play'" @click="playing ? stop() : play()">
          <component :is="playing ? Pause : Play" :size="14" /> {{ playing ? "Pause" : replay?.done ? "Finished" : "Play" }}
        </button>
        <div class="inline-flex rounded-xl border border-line bg-surface-2/60 p-0.5" role="group" aria-label="Speed">
          <button
            v-for="s in SPEEDS"
            :key="s"
            class="rounded-lg px-2.5 py-1 font-mono text-xs font-semibold transition-all duration-150"
            :class="speed === s ? 'bg-accent text-accent-ink shadow-sm' : 'text-muted hover:text-fg'"
            :aria-pressed="speed === s"
            @click="speed = s"
          >
            {{ s }}x
          </button>
        </div>
        <div class="flex min-w-45 flex-1 items-center gap-2 sm:gap-3">
          <div class="h-2 flex-1 overflow-hidden rounded-full bg-surface-2 border border-line/40">
            <div class="h-full rounded-full bg-accent transition-all duration-75" :style="{ width: `${progress}%` }" />
          </div>
          <span class="font-mono text-xs text-muted tabular-nums whitespace-nowrap">{{ clock(position) }} / {{ clock(replay?.duration ?? 0) }}</span>
        </div>
        <span class="font-mono text-xs text-faint whitespace-nowrap">{{ applied.length }} / {{ replay?.events.length ?? 0 }} events</span>
      </div>

      <!-- Main Layout: Canvas on left/top, EventTimeline on right/bottom -->
      <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div class="card overflow-hidden bg-[#1b2622]">
          <div ref="host" class="h-[min(68vh,720px)] min-h-80 w-full touch-none max-sm:h-[min(55vh,420px)]" aria-label="Office replay" role="img" />
        </div>
        <div class="card max-h-[min(68vh,720px)] overflow-y-auto p-3">
          <div class="sign mb-2 px-1 text-[10px] tracking-wider">Events</div>
          <EventTimeline :events="applied.slice(-60)" />
          <p v-if="!applied.length" class="p-3 text-xs text-muted">Events show here as they replay.</p>
        </div>
      </div>
    </section>
  </div>
</template>
