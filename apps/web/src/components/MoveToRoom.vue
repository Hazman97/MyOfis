<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, type Room } from "../api/http.ts";
import { me } from "../me.ts";

/** Owner only: move an agent or a project to another room (Rooms, 2026-10-19). */
const props = defineProps<{ kind: "agent" | "project"; id: string }>();
const rooms = ref<Room[]>([]);
const error = ref("");
onMounted(async () => {
  rooms.value = (await api.rooms().catch(() => ({ rooms: [] as Room[] }))).rooms.filter((r) => r.id !== me.value?.workspace_id && r.kind !== "personal");
});
async function move(e: Event) {
  const select = e.target as HTMLSelectElement;
  const to = select.value;
  if (!to) return;
  const room = rooms.value.find((r) => r.id === to);
  error.value = "";
  try {
    if (props.kind === "agent") await api.moveAgent(props.id, to);
    else await api.moveProject(props.id, to);
    location.reload();
  } catch (err) {
    error.value = (err as Error).message;
    select.value = "";
  }
  void room;
}
</script>

<template>
  <span v-if="rooms.length" class="inline-flex items-center gap-1">
    <select class="input h-7 w-auto py-0 text-xs" aria-label="Move to room" @change="move">
      <option value="">Move to room…</option>
      <option v-for="r in rooms" :key="r.id" :value="r.id">{{ r.kind === "hq" ? "HQ" : r.name }}</option>
    </select>
    <span v-if="error" class="text-[11px] text-danger">{{ error }}</span>
  </span>
</template>
