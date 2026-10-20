<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { Building2, Check, ChevronDown, DoorOpen, User } from "lucide-vue-next";
import { api, type Room } from "../api/http.ts";
import { enterRoom, me } from "../me.ts";

/**
 * Which room you are in (HQ, a sub-business room like "Sewa Baju", or a personal room). Agents,
 * projects, drafts and chats all belong to the room. The owner can enter every room.
 */
const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });

const rooms = ref<Room[]>([]);
const isOpen = ref(false);
const highlightedIndex = ref(-1);
const containerRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);

onMounted(async () => {
  rooms.value = (await api.rooms().catch(() => ({ rooms: [] as Room[] }))).rooms;
  document.addEventListener("click", onClickOutside);
  document.addEventListener("keydown", onGlobalKeydown);
});

onUnmounted(() => {
  document.removeEventListener("click", onClickOutside);
  document.removeEventListener("keydown", onGlobalKeydown);
});

const current = computed(() => rooms.value.find((r) => r.id === me.value?.workspace_id));

function kindIcon(kind: Room["kind"]) {
  if (kind === "hq") return Building2;
  if (kind === "personal") return User;
  return DoorOpen;
}

function kindColor(kind: Room["kind"]) {
  if (kind === "hq") return "text-accent";
  if (kind === "personal") return "text-violet-500";
  return "text-info";
}

function roomLabel(r: Room) {
  if (r.kind === "hq") return r.name || "HQ";
  return r.name;
}

function toggleDropdown() {
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    const idx = rooms.value.findIndex((r) => r.id === current.value?.id);
    highlightedIndex.value = idx >= 0 ? idx : 0;
  }
}

function closeDropdown() {
  isOpen.value = false;
  highlightedIndex.value = -1;
}

function selectRoom(r: Room) {
  closeDropdown();
  if (r.id !== current.value?.id) {
    enterRoom(r.id);
  }
}

function onClickOutside(e: MouseEvent) {
  if (containerRef.value && !containerRef.value.contains(e.target as Node)) {
    closeDropdown();
  }
}

function onTriggerKeydown(e: KeyboardEvent) {
  if (e.key === "ArrowDown" || e.key === "Down") {
    e.preventDefault();
    if (!isOpen.value) {
      toggleDropdown();
    } else {
      highlightedIndex.value = (highlightedIndex.value + 1) % rooms.value.length;
    }
  } else if (e.key === "ArrowUp" || e.key === "Up") {
    e.preventDefault();
    if (!isOpen.value) {
      toggleDropdown();
    } else {
      highlightedIndex.value = (highlightedIndex.value - 1 + rooms.value.length) % rooms.value.length;
    }
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (!isOpen.value) {
      toggleDropdown();
    } else if (highlightedIndex.value >= 0) {
      const target = rooms.value[highlightedIndex.value];
      if (target) selectRoom(target);
    }
  } else if (e.key === "Escape" || e.key === "Esc") {
    if (isOpen.value) {
      e.preventDefault();
      closeDropdown();
    }
  }
}

function onGlobalKeydown(e: KeyboardEvent) {
  if (isOpen.value && (e.key === "Escape" || e.key === "Esc")) {
    closeDropdown();
    triggerRef.value?.focus();
  }
}
</script>

<template>
  <div v-if="rooms.length > 1" ref="containerRef" class="relative inline-block text-left" :class="!compact && 'w-full'">
    <!-- Trigger Button -->
    <button
      ref="triggerRef"
      type="button"
      class="flex items-center gap-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      :class="
        compact
          ? 'h-9 max-w-32.5 sm:max-w-40 rounded-lg border border-line bg-surface-2/70 px-2 py-1 text-xs font-medium text-fg hover:border-line-strong hover:bg-surface-2'
          : 'w-full justify-between rounded-lg border border-line bg-surface-2/60 px-2.5 py-2 text-sm font-medium text-fg hover:border-line-strong hover:bg-surface-2'
      "
      aria-haspopup="listbox"
      :aria-expanded="isOpen"
      aria-label="Switch room"
      @click="toggleDropdown"
      @keydown="onTriggerKeydown"
    >
      <div class="flex min-w-0 items-center gap-2">
        <component
          :is="kindIcon(current?.kind ?? 'room')"
          :size="compact ? 13 : 15"
          class="shrink-0"
          :class="kindColor(current?.kind ?? 'room')"
        />
        <span class="truncate font-medium text-fg" :class="compact ? 'text-xs max-w-20 sm:max-w-27.5' : 'text-sm'">
          {{ current ? roomLabel(current) : "Select room" }}
        </span>
      </div>
      <ChevronDown
        :size="compact ? 12 : 14"
        class="shrink-0 text-muted transition-transform duration-200"
        :class="isOpen && 'rotate-180'"
      />
    </button>

    <!-- Dropdown Menu -->
    <div
      v-if="isOpen"
      class="absolute z-50 mt-1.5 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-card backdrop-blur-md"
      :class="compact ? 'left-0 w-64 max-w-[calc(100vw-2rem)]' : 'left-0 right-0 w-full'"
      role="listbox"
      aria-label="Rooms"
    >
      <div class="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-faint">
        Switch Room
      </div>
      <div class="max-h-72 overflow-y-auto space-y-0.5">
        <button
          v-for="(r, idx) in rooms"
          :key="r.id"
          type="button"
          role="option"
          :aria-selected="r.id === current?.id"
          class="flex w-full items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors focus:outline-none"
          :class="[
            r.id === current?.id
              ? 'bg-accent-soft/40 font-semibold text-accent'
              : highlightedIndex === idx
                ? 'bg-surface-2 text-fg'
                : 'text-fg hover:bg-surface-2',
          ]"
          @click="selectRoom(r)"
          @mouseenter="highlightedIndex = idx"
        >
          <div class="flex min-w-0 items-center gap-2">
            <span
              class="flex size-6 shrink-0 items-center justify-center rounded-md border border-line bg-surface"
              :class="r.id === current?.id ? 'border-accent/30 text-accent' : 'text-muted'"
            >
              <component :is="kindIcon(r.kind)" :size="13" :class="kindColor(r.kind)" />
            </span>
            <div class="min-w-0">
              <div class="truncate font-medium leading-tight">
                {{ roomLabel(r) }}
              </div>
              <div v-if="r.kind === 'room'" class="text-[11px] font-normal text-muted">
                {{ r.members?.length ?? 0 }} {{ (r.members?.length ?? 0) === 1 ? 'member' : 'members' }}
              </div>
              <div v-else-if="r.kind === 'personal'" class="text-[11px] font-normal text-muted truncate">
                Personal
              </div>
            </div>
          </div>

          <div class="flex items-center gap-1.5 shrink-0">
            <span
              v-if="r.id === current?.id"
              class="flex size-4 items-center justify-center rounded-full bg-accent text-accent-ink"
              title="Current room"
            >
              <Check :size="10" stroke-width="3" />
            </span>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>
