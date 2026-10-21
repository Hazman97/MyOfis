<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRaw, watch } from "vue";
import { RouterLink } from "vue-router";
import { Bot, LocateFixed, Minus, Plus } from "lucide-vue-next";
import type { OfficeState } from "@agent-office/shared";
import { useOffice } from "../../stores/office.ts";
import { OFFICE_ASSETS, type CharacterManifest } from "../../office/assets.ts";
import { parseOfficeMap, type TiledMap } from "../../office/map/tmj.ts";
import { OfficeWorld, type DropAction } from "../../office/brain/world.ts";
import { api, type Room } from "../../api/http.ts";
import { me } from "../../me.ts";
import type { AgentInfo } from "../../office/brain/intent.ts";
import type { OfficeGame } from "../../office/scene/game.ts";

/**
 * The pixel office. Reads the same store as the board view and never writes
 * to it: clicks are reported up as `select` / `approval`.
 */
const props = defineProps<{ selected: string | null }>();
const emit = defineEmits<{
  select: [id: string | null];
  approval: [id: string];
  /** Long-press / right-click on an agent; x, y on the screen (viewport). */
  menu: [id: string, x: number, y: number];
  /** A drop that opens something (whiteboard → Drafts, your desk → Chat). */
  action: [action: NonNullable<DropAction>];
  /** The agent next to your character (null = nobody). */
  near: [id: string | null];
}>();
const office = useOffice();
const host = ref<HTMLDivElement>();
const status = ref<"loading" | "ready" | "error">("loading");
const error = ref("");
let game: OfficeGame | null = null;
let world: OfficeWorld | null = null;
let disposed = false;
let loaded: { map: TiledMap; layout: ReturnType<typeof parseOfficeMap> } | null = null;

/** 3D (Taskuary-style isometric, default) or the original pixel office; remembered per browser. */
type ViewMode = "3d" | "pixel";
const readMode = (): ViewMode => {
  try {
    return localStorage.getItem("office.view") === "pixel" ? "pixel" : "3d";
  } catch {
    return "3d";
  }
};
const mode = ref<ViewMode>(readMode());

const activeCount = computed(() => office.agents.filter((a) => a.enabled).length);

const rooms = ref<Room[]>([]);
onMounted(async () => {
  rooms.value = (await api.rooms().catch(() => ({ rooms: [] as Room[] }))).rooms;
});
const currentRoom = computed(() => rooms.value.find((r) => r.id === me.value?.workspace_id));
const isHq = computed(() => !currentRoom.value || currentRoom.value.kind === "hq");
const deckLabel = computed(() => (isHq.value ? "HQ FLOOR DECK" : `${currentRoom.value?.name.toUpperCase()} FLOOR DECK`));
const openingLabel = computed(() => (isHq.value ? "Opening HQ Deck…" : `Opening ${currentRoom.value?.name} Deck…`));

const infos = (): AgentInfo[] =>
  office.agents.map((a) => ({
    id: a.id,
    slug: a.slug,
    name: a.name,
    sprite: a.sprite,
    enabled: a.enabled,
    runner_id: a.runner_id,
    desk_x: a.desk_x,
    desk_y: a.desk_y,
  }));

function sync() {
  // wait for the snapshot and the agent list, so the first sync places everyone without animating old news
  if (!world || !office.ready || !office.agents.length) return;
  world.sync(toRaw(office.state) as OfficeState, infos());
}

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(`${OFFICE_ASSETS}${name}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Build the view for the current mode (the brain stays: switching keeps everyone where they are). */
let startGen = 0;
async function start() {
  if (!loaded || !host.value || !world) return;
  // a quick 3D → Pixel → 3D while a chunk loads: only the newest start may keep its view
  const gen = ++startGen;
  game?.destroy();
  game = null;
  const options = {
    map: loaded.map,
    layout: loaded.layout,
    world,
    assetBase: OFFICE_ASSETS,
    onSelect: (id: string | null) => emit("select", id),
    onApproval: (id: string) => emit("approval", id),
    selected: () => props.selected,
    interactive: true,
    // screen (viewport) position, so the menu can sit exactly under the pointer
    onMenu: (id: string, x: number, y: number) => {
      const r = host.value?.getBoundingClientRect();
      emit("menu", id, (r?.left ?? 0) + x, (r?.top ?? 0) + y);
    },
    onAction: (a: NonNullable<DropAction>) => emit("action", a),
    onNear: (id: string | null) => emit("near", id),
  };
  if (mode.value === "3d") {
    const mod = await import("../../office/scene3d/office3d.ts");
    if (disposed || !host.value || gen !== startGen) return;
    game = mod.createOffice3d(host.value, options);
  } else {
    const mod = await import("../../office/scene/game.ts");
    if (disposed || !host.value || gen !== startGen) return;
    game = mod.createOfficeGame(host.value, options);
  }
}

async function setMode(m: ViewMode) {
  if (m === mode.value) return;
  mode.value = m;
  try {
    localStorage.setItem("office.view", m);
  } catch {
    /* private window: the choice lasts this visit */
  }
  status.value = "loading";
  try {
    await start();
    status.value = "ready";
  } catch (e) {
    status.value = "error";
    error.value = (e as Error).message;
  }
}

onMounted(async () => {
  try {
    const map = await getJson<TiledMap>("office.tmj");
    const layout = parseOfficeMap(map);
    const chars = await getJson<CharacterManifest>(layout.assets.characters);
    if (disposed || !host.value) return;
    loaded = { map, layout };
    world = new OfficeWorld(layout, chars.meta.outfits);
    // your own character, named after you
    world.setMe(me.value?.name || me.value?.email?.split("@")[0] || "You");
    sync();
    await start();
    status.value = "ready";
  } catch (e) {
    status.value = "error";
    error.value = (e as Error).message;
  }
});

watch(() => [office.state.last_event_id, office.agents, office.ready] as const, sync);

/** For the radial menu's "Poke". */
defineExpose({ poke: (id: string) => game?.poke(id) });

onBeforeUnmount(() => {
  disposed = true;
  game?.destroy();
  game = null;
});
</script>

<template>
  <div class="card overflow-hidden">
    <!-- Slim bar above canvas -->
    <div class="flex items-center justify-between border-b border-line bg-surface px-3 py-1.5 text-xs text-muted">
      <div class="flex min-w-0 items-center gap-2">
        <span class="relative flex size-2 shrink-0">
          <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75"></span>
          <span class="relative inline-flex size-2 rounded-full bg-accent"></span>
        </span>
        <span class="font-mono text-xs font-semibold tracking-wide text-accent whitespace-nowrap">{{ deckLabel }}</span>
        <span class="text-faint">·</span>
        <span class="truncate text-xs text-muted font-medium">{{ activeCount }} agents on duty</span>
      </div>
      <div class="inline-flex shrink-0 rounded-md border border-line p-0.5" role="group" aria-label="Office view">
        <button v-for="m in (['3d', 'pixel'] as const)" :key="m" class="rounded px-2 py-0.5 text-xs font-medium" :class="mode === m ? 'bg-accent/15 text-accent' : 'text-muted hover:text-fg'" :aria-pressed="mode === m" @click="setMode(m)">
          {{ m === "3d" ? "3D" : "Pixel" }}
        </button>
      </div>
    </div>

    <!-- Canvas area -->
    <div class="relative bg-[#1b2622]">
      <div ref="host" class="h-[min(72vh,800px)] min-h-80 w-full touch-none max-sm:h-[min(60vh,420px)]" aria-label="Office view: agents at work" role="img" />

      <!-- Loading State -->
      <div v-if="status === 'loading'" class="absolute inset-0 grid place-items-center bg-[#1b2622]/80 backdrop-blur-sm">
        <div class="flex flex-col items-center gap-3">
          <div class="size-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <span class="font-mono text-xs uppercase tracking-wider text-accent">{{ openingLabel }}</span>
        </div>
      </div>

      <!-- Error State -->
      <div v-else-if="status === 'error'" class="absolute inset-0 grid place-items-center p-6 text-center bg-[#1b2622]/95">
        <div class="max-w-sm rounded-xl border border-danger/20 bg-danger-soft p-5 text-sm text-fg">
          <p class="font-semibold text-danger">The office art did not load.</p>
          <p class="mt-1 font-mono text-xs text-muted">{{ error }}</p>
          <p class="mt-3 text-xs text-muted">Build it with <code class="bg-sunken text-fg">bun run --cwd apps/web office:assets</code>, or switch to Board view.</p>
        </div>
      </div>

      <!-- Empty Room State -->
      <div v-if="status === 'ready' && activeCount === 0" class="absolute inset-0 grid place-items-center p-6 text-center bg-[#1b2622]/65 backdrop-blur-xs pointer-events-none">
        <div class="card max-w-sm p-6 text-center space-y-3 pointer-events-auto shadow-xl bg-surface/95 border border-line">
          <div class="mx-auto flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-accent border border-line">
            <Bot :size="24" />
          </div>
          <div class="space-y-1">
            <h3 class="font-semibold text-sm text-fg">No agents in this room</h3>
            <p class="text-xs text-muted">Move or add agents to this room to see them working here.</p>
          </div>
          <RouterLink to="/agents" class="btn btn-primary btn-sm inline-flex min-h-9">Move or add agents to this room</RouterLink>
        </div>
      </div>

      <!-- Segmented zoom & center controls with hint in bottom-right corner -->
      <div v-if="status === 'ready'" class="absolute right-2.5 bottom-2.5 flex flex-col items-end gap-1">
        <div class="inline-flex rounded-md border border-white/15 bg-black/50 p-0.5 shadow-lg backdrop-blur-sm">
          <button
            class="btn btn-sm h-7 rounded-sm border-0 bg-transparent px-2 text-white hover:bg-white/15 active:bg-white/25 focus-visible:ring-1 focus-visible:ring-white/50"
            aria-label="Zoom out"
            title="Zoom out"
            @click="game?.zoomBy(-1)"
          >
            <Minus :size="14" />
          </button>
          <div class="my-1 w-px bg-white/15" />
          <button
            class="btn btn-sm h-7 rounded-sm border-0 bg-transparent px-2 text-white hover:bg-white/15 active:bg-white/25 focus-visible:ring-1 focus-visible:ring-white/50"
            aria-label="Center the office"
            title="Center the office"
            @click="game?.recenter()"
          >
            <LocateFixed :size="14" />
          </button>
          <div class="my-1 w-px bg-white/15" />
          <button
            class="btn btn-sm h-7 rounded-sm border-0 bg-transparent px-2 text-white hover:bg-white/15 active:bg-white/25 focus-visible:ring-1 focus-visible:ring-white/50"
            aria-label="Zoom in"
            title="Zoom in"
            @click="game?.zoomBy(1)"
          >
            <Plus :size="14" />
          </button>
        </div>
        <p class="text-[10px] tracking-tight text-white/40 select-none">
          Scroll or use the buttons to zoom · drag to move
        </p>
      </div>
    </div>
  </div>
</template>
