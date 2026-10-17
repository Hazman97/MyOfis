<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRaw, watch } from "vue";
import { LocateFixed, Minus, Plus } from "lucide-vue-next";
import type { OfficeState } from "@agent-office/shared";
import { useOffice } from "../../stores/office.ts";
import { OFFICE_ASSETS, type CharacterManifest } from "../../office/assets.ts";
import { parseOfficeMap, type TiledMap } from "../../office/map/tmj.ts";
import { OfficeWorld } from "../../office/brain/world.ts";
import type { AgentInfo } from "../../office/brain/intent.ts";
import type { OfficeGame } from "../../office/scene/game.ts";

/**
 * The pixel office. Reads the same store as the board view and never writes
 * to it: clicks are reported up as `select` / `approval`.
 */
const props = defineProps<{ selected: string | null }>();
const emit = defineEmits<{ select: [id: string | null]; approval: [id: string] }>();
const office = useOffice();
const host = ref<HTMLDivElement>();
const status = ref<"loading" | "ready" | "error">("loading");
const error = ref("");
let game: OfficeGame | null = null;
let world: OfficeWorld | null = null;
let disposed = false;

const activeCount = computed(() => office.agents.filter((a) => a.enabled).length);

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

onMounted(async () => {
  try {
    const [map, mod] = await Promise.all([getJson<TiledMap>("office.tmj"), import("../../office/scene/game.ts")]);
    const layout = parseOfficeMap(map);
    const chars = await getJson<CharacterManifest>(layout.assets.characters);
    if (disposed || !host.value) return;
    world = new OfficeWorld(layout, chars.meta.outfits);
    sync();
    game = mod.createOfficeGame(host.value, {
      map,
      layout,
      world,
      assetBase: OFFICE_ASSETS,
      onSelect: (id) => emit("select", id),
      onApproval: (id) => emit("approval", id),
      selected: () => props.selected,
    });
    status.value = "ready";
  } catch (e) {
    status.value = "error";
    error.value = (e as Error).message;
  }
});

watch(() => [office.state.last_event_id, office.agents, office.ready] as const, sync);

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
        <span class="font-mono text-xs font-semibold tracking-wide text-accent whitespace-nowrap">HQ FLOOR DECK</span>
        <span class="text-faint">·</span>
        <span class="truncate text-xs text-muted font-medium">{{ activeCount }} agents on duty</span>
      </div>
    </div>

    <!-- Canvas area -->
    <div class="relative bg-[#1b2622]">
      <div ref="host" class="h-[min(72vh,800px)] min-h-80 w-full touch-none max-sm:h-[min(60vh,420px)]" aria-label="Office view: agents at work" role="img" />

      <!-- Loading State -->
      <div v-if="status === 'loading'" class="absolute inset-0 grid place-items-center bg-[#1b2622]/80 backdrop-blur-sm">
        <div class="flex flex-col items-center gap-3">
          <div class="size-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <span class="font-mono text-xs uppercase tracking-wider text-accent">Opening HQ Deck…</span>
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
          Drag to move · scroll buttons to zoom
        </p>
      </div>
    </div>
  </div>
</template>
