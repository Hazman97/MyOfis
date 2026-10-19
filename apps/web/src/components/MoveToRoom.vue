<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { DoorOpen, X } from "lucide-vue-next";
import { api, type Room } from "../api/http.ts";
import { me } from "../me.ts";
import { useOffice } from "../stores/office.ts";

/** Owner only: move an agent or a project to another room (Rooms, 2026-10-19). */
const props = defineProps<{ kind: "agent" | "project"; id: string; name?: string }>();

const office = useOffice();
const rooms = ref<Room[]>([]);
const projectName = ref("");
const error = ref("");
const busy = ref(false);
const isOpen = ref(false);
const selectedRoomId = ref("");
const containerRef = ref<HTMLElement | null>(null);

onMounted(async () => {
  try {
    const [roomsRes, projectsRes] = await Promise.all([
      api.rooms().catch(() => ({ rooms: [] as Room[] })),
      props.kind === "project" ? api.projects().catch(() => ({ projects: [] })) : Promise.resolve(null),
    ]);
    rooms.value = roomsRes.rooms.filter((r) => r.id !== me.value?.workspace_id && r.kind !== "personal");
    if (projectsRes) {
      const p = projectsRes.projects.find((item: any) => item.id === props.id);
      if (p) projectName.value = p.name;
    }
  } catch {
    // ignore
  }
  document.addEventListener("click", onClickOutside);
  document.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  document.removeEventListener("click", onClickOutside);
  document.removeEventListener("keydown", onKeydown);
});

const targetName = computed(() => {
  if (props.name) return props.name;
  if (props.kind === "agent") {
    return office.agents.find((a) => a.id === props.id)?.name || "Agent";
  }
  return projectName.value || "Project";
});

const targetRoom = computed(() => rooms.value.find((r) => r.id === selectedRoomId.value));

function open() {
  isOpen.value = true;
  selectedRoomId.value = "";
  error.value = "";
}

function close() {
  isOpen.value = false;
  selectedRoomId.value = "";
  error.value = "";
}

function onClickOutside(e: MouseEvent) {
  if (containerRef.value && !containerRef.value.contains(e.target as Node)) {
    close();
  }
}

function onKeydown(e: KeyboardEvent) {
  if (isOpen.value && (e.key === "Escape" || e.key === "Esc")) {
    close();
  }
}

async function confirmMove() {
  if (!selectedRoomId.value) return;
  busy.value = true;
  error.value = "";
  try {
    if (props.kind === "agent") await api.moveAgent(props.id, selectedRoomId.value);
    else await api.moveProject(props.id, selectedRoomId.value);
    location.reload();
  } catch (err) {
    error.value = (err as Error).message;
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="rooms.length" ref="containerRef" class="relative inline-block text-left">
    <!-- Small, quiet icon button -->
    <button
      type="button"
      class="btn btn-ghost btn-sm h-7 gap-1 px-2 text-xs text-muted hover:text-fg hover:bg-surface-2 transition-colors"
      :title="`Move ${targetName} to another room`"
      aria-label="Move to room"
      @click="isOpen ? close() : open()"
    >
      <DoorOpen :size="13" class="shrink-0 text-muted" />
      <span>Move to room</span>
    </button>

    <!-- Confirmation Popover -->
    <div
      v-if="isOpen"
      class="absolute left-0 z-50 mt-1.5 w-72 rounded-xl border border-line bg-surface p-3.5 shadow-card backdrop-blur-md"
    >
      <div class="flex items-center justify-between pb-2 border-b border-line mb-3">
        <div class="flex items-center gap-1.5 font-medium text-xs text-fg">
          <DoorOpen :size="13" class="text-accent" />
          <span>Move {{ targetName }}</span>
        </div>
        <button
          type="button"
          class="text-faint hover:text-fg transition-colors p-0.5 rounded"
          aria-label="Close"
          @click="close"
        >
          <X :size="14" />
        </button>
      </div>

      <div class="space-y-3">
        <label class="block">
          <span class="label text-[11px]">Select destination room</span>
          <select
            v-model="selectedRoomId"
            class="input h-8 text-xs py-1"
            aria-label="Destination room"
          >
            <option value="" disabled>Choose room…</option>
            <option v-for="r in rooms" :key="r.id" :value="r.id">
              {{ r.kind === "hq" ? "🏢 HQ" : `🚪 ${r.name}` }}
            </option>
          </select>
        </label>

        <!-- Confirmation Prompt -->
        <div v-if="targetRoom" class="rounded-lg border border-accent/20 bg-accent-soft/40 p-2.5 text-xs">
          <p class="font-medium text-fg">
            Move <span class="font-semibold text-accent">{{ targetName }}</span> to
            <span class="font-semibold text-accent">{{ targetRoom.kind === "hq" ? "HQ" : targetRoom.name }}</span>?
          </p>
          <p class="mt-1 text-[11px] text-muted">
            It will only be accessible within that room's workspace.
          </p>
        </div>

        <p v-if="error" class="text-[11px] text-danger bg-danger-soft/50 rounded p-1.5 leading-tight">
          {{ error }}
        </p>

        <div class="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            class="btn btn-ghost btn-sm h-7 text-xs"
            :disabled="busy"
            @click="close"
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm h-7 text-xs"
            :disabled="busy || !selectedRoomId"
            @click="confirmMove"
          >
            {{ busy ? "Moving…" : "Confirm Move" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
