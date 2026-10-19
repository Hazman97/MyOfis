<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { DoorOpen, LogIn, Plus, Users } from "lucide-vue-next";
import PageHeader from "../components/PageHeader.vue";
import { api, type Member, type Room } from "../api/http.ts";
import { enterRoom } from "../me.ts";
import { fmtTokens } from "../format.ts";

/**
 * Rooms (owner request, 2026-10-19): one room per sub-business ("Sewa Baju", "SmashPoint") with
 * only the agents and projects it needs. Share a room with friends: they can use and edit its
 * agents, which run on your AI within the room's daily limit. You (admin) can enter every room.
 * Move agents and projects into a room from the Agents and Projects pages ("Move to room").
 */
const rooms = ref<Room[]>([]);
const members = ref<Member[]>([]);
const error = ref("");
const msg = ref("");
const busy = ref(false);
const form = reactive({ name: "", daily_token_budget: 200_000 });
/** room id → chosen member ids, while editing */
const picks = reactive<Record<string, string[]>>({});
const budgets = reactive<Record<string, number>>({});

async function load() {
  try {
    [rooms.value, members.value] = await Promise.all([api.rooms().then((r) => r.rooms), api.members().then((r) => r.members)]);
    for (const r of rooms.value) {
      picks[r.id] = r.members.map((m) => m.id);
      budgets[r.id] = r.daily_token_budget;
    }
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

async function run(fn: () => Promise<unknown>, ok: string) {
  busy.value = true;
  error.value = msg.value = "";
  try {
    await fn();
    msg.value = ok;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const create = () =>
  run(async () => {
    await api.createRoom({ name: form.name.trim(), daily_token_budget: form.daily_token_budget });
    form.name = "";
  }, "Room made. Enter it, then move agents and projects into it (Agents / Projects → Move to room).");
const save = (r: Room) =>
  run(async () => {
    await api.updateRoom(r.id, { daily_token_budget: budgets[r.id] });
    if (r.kind === "room") await api.setRoomMembers(r.id, picks[r.id] ?? []);
  }, "Saved.");
function togglePick(roomId: string, userId: string, on: boolean) {
  const list = (picks[roomId] ??= []);
  picks[roomId] = on ? [...new Set([...list, userId])] : list.filter((x) => x !== userId);
}
const kindLabel = { hq: "HQ", room: "Room", personal: "Personal" } as const;
</script>

<template>
  <div class="mx-auto max-w-4xl">
    <PageHeader sign="System" title="Rooms" description="One room per sub-business, with only the agents and projects it needs. Share a room with friends; its agents run on your AI within the room's daily limit. You can enter every room." />

    <p v-if="error" class="mb-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{{ error }}</p>
    <p v-if="msg" class="mb-3 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent" role="status">{{ msg }}</p>

    <form class="card mb-5 grid gap-3 p-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end" @submit.prevent="create">
      <label><span class="label">New room</span><input v-model="form.name" required maxlength="60" class="input" placeholder="Sewa Baju" /></label>
      <label><span class="label">Daily limit on your AI (tokens)</span><input v-model.number="form.daily_token_budget" type="number" min="1000" step="10000" class="input" /></label>
      <button class="btn btn-primary" :disabled="busy || !form.name.trim()"><Plus :size="15" /> Make room</button>
    </form>

    <article v-for="r in rooms" :key="r.id" class="card mb-4 space-y-3 p-4" :class="r.current && 'ring-1 ring-accent/50'">
      <div class="flex flex-wrap items-center gap-2">
        <DoorOpen :size="16" class="text-accent" />
        <span class="font-medium">{{ r.name }}</span>
        <span class="chip text-[11px]">{{ kindLabel[r.kind] }}</span>
        <span v-if="r.current" class="chip text-[11px] text-accent">you are here</span>
        <span class="text-xs text-muted">{{ r.agents }} agents · {{ r.projects }} projects</span>
        <button v-if="!r.current" type="button" class="btn btn-sm ml-auto" @click="enterRoom(r.id)"><LogIn :size="14" /> Enter</button>
      </div>

      <div v-if="r.kind === 'room'" class="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <label>
          <span class="label">Daily limit (tokens)</span>
          <input v-model.number="budgets[r.id]" type="number" min="1000" step="10000" class="input text-sm" />
          <span v-if="r.left_today !== null" class="mt-1 block text-[11px] text-muted">{{ fmtTokens(r.left_today) }} left today</span>
        </label>
        <div>
          <div class="label flex items-center gap-1.5"><Users :size="13" /> Members in this room</div>
          <p v-if="!members.length" class="text-xs text-muted">Add members first (Settings → Members).</p>
          <div class="flex flex-wrap gap-2">
            <label v-for="m in members" :key="m.id" class="chip cursor-pointer gap-1.5 text-xs">
              <input type="checkbox" class="accent-accent" :checked="picks[r.id]?.includes(m.id)" @change="togglePick(r.id, m.id, ($event.target as HTMLInputElement).checked)" />
              {{ m.name || m.email }}
            </label>
          </div>
        </div>
      </div>
      <p v-else-if="r.kind === 'personal'" class="text-xs text-muted">{{ r.members[0]?.email }}'s own room: their agents use their own AI keys.</p>
      <p v-else class="text-xs text-muted">Your main room: everything from before lives here.</p>
      <button v-if="r.kind === 'room'" type="button" class="btn btn-sm" :disabled="busy" @click="save(r)">Save</button>
    </article>
  </div>
</template>
