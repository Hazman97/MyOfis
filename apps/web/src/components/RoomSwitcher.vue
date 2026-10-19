<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { DoorOpen } from "lucide-vue-next";
import { api, type Room } from "../api/http.ts";
import { enterRoom, me } from "../me.ts";

/**
 * Which room you are in (HQ, a sub-business room like "Sewa Baju", or a personal room). Agents,
 * projects, drafts and chats all belong to the room. The owner can enter every room.
 */
withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });
const rooms = ref<Room[]>([]);
onMounted(async () => {
  rooms.value = (await api.rooms().catch(() => ({ rooms: [] as Room[] }))).rooms;
});
const current = computed(() => rooms.value.find((r) => r.id === me.value?.workspace_id));
const label = (r: Room) => (r.kind === "hq" ? "🏢 HQ" : r.kind === "personal" ? `👤 ${r.name}` : `🚪 ${r.name}`);
</script>

<template>
  <label v-if="rooms.length > 1" class="flex min-w-0 items-center gap-1.5" :class="compact ? '' : 'w-full rounded-lg border border-line bg-surface-2/60 px-2 py-1.5'">
    <DoorOpen v-if="!compact" :size="14" class="shrink-0 text-accent" />
    <span class="sr-only">Room</span>
    <select
      class="min-w-0 flex-1 truncate bg-transparent text-sm font-medium outline-none"
      :class="compact && 'max-w-[9rem] rounded-md border border-line px-1.5 py-1 text-xs'"
      :value="current?.id"
      aria-label="Room"
      @change="enterRoom(($event.target as HTMLSelectElement).value)"
    >
      <option v-for="r in rooms" :key="r.id" :value="r.id">{{ label(r) }}</option>
    </select>
  </label>
</template>
