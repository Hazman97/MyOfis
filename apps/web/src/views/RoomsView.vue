<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { Building2, Coins, DoorOpen, LogIn, Plus, Sparkles, User, Users } from "lucide-vue-next";
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

const kindOrder = { hq: 0, room: 1, personal: 2 } as const;
const sortedRooms = computed(() => {
  return [...rooms.value].sort((a, b) => (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9));
});

const kindLabel = { hq: "HQ", room: "Room", personal: "Personal" } as const;

function kindIcon(kind: Room["kind"]) {
  if (kind === "hq") return Building2;
  if (kind === "personal") return User;
  return DoorOpen;
}

function topStripBg(kind: Room["kind"]) {
  if (kind === "hq") return "bg-accent";
  if (kind === "personal") return "bg-violet-500";
  return "bg-info";
}

function getInitials(text: string) {
  const clean = (text || "").replace(/@.*/, "").trim();
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  const first = parts[0];
  const second = parts[1];
  if (first && second) return ((first[0] ?? "") + (second[0] ?? "")).toUpperCase();
  return clean.slice(0, 2).toUpperCase() || "?";
}
</script>

<template>
  <div class="mx-auto max-w-4xl pb-10">
    <PageHeader
      sign="System"
      title="Rooms"
      description="One room per sub-business, with only the agents and projects it needs. Share a room with friends; its agents run on your AI within the room's daily limit. You can enter every room."
    />

    <p v-if="error" class="mb-4 rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger border border-danger/20" role="alert">
      {{ error }}
    </p>
    <p v-if="msg" class="mb-4 rounded-lg bg-accent-soft px-3.5 py-2.5 text-sm text-accent border border-accent/20" role="status">
      {{ msg }}
    </p>

    <!-- Create Room Form -->
    <form class="card mb-6 grid gap-3 p-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end" @submit.prevent="create">
      <label class="block">
        <span class="label">New room</span>
        <input v-model="form.name" required maxlength="60" class="input" placeholder="e.g. Sewa Baju" />
      </label>
      <label class="block">
        <span class="label">Daily limit on your AI (tokens)</span>
        <input v-model.number="form.daily_token_budget" type="number" min="1000" step="any" class="input font-mono" />
      </label>
      <button class="btn btn-primary h-9" :disabled="busy || !form.name.trim()">
        <Plus :size="15" />
        <span>Make room</span>
      </button>
    </form>

    <!-- 3-Step Empty State / Guide when no custom sub-rooms exist -->
    <div v-if="!rooms.some((r) => r.kind === 'room')" class="card mb-6 overflow-hidden border-dashed p-5">
      <div class="sign mb-1 text-accent">Getting Started</div>
      <h3 class="text-sm font-semibold text-fg">How Rooms work</h3>
      <p class="mt-1 text-xs text-muted leading-relaxed">
        Rooms let you compartmentalize sub-businesses or client workspaces. Each room holds its own agents and projects, operating under an isolated daily AI token limit.
      </p>
      <div class="mt-4 grid gap-3 sm:grid-cols-3">
        <div class="rounded-lg border border-line bg-surface-2/40 p-3">
          <div class="flex items-center gap-2 font-medium text-xs text-fg">
            <span class="flex size-5 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-accent-ink shrink-0">1</span>
            <span>Make a room</span>
          </div>
          <p class="mt-1.5 text-[11px] text-muted leading-relaxed">
            Create a room using the form above and define how many tokens it can consume daily.
          </p>
        </div>
        <div class="rounded-lg border border-line bg-surface-2/40 p-3">
          <div class="flex items-center gap-2 font-medium text-xs text-fg">
            <span class="flex size-5 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-accent-ink shrink-0">2</span>
            <span>Move agents & projects</span>
          </div>
          <p class="mt-1.5 text-[11px] text-muted leading-relaxed">
            Go to <RouterLink to="/agents" class="text-accent underline hover:opacity-80">Agents</RouterLink> or <RouterLink to="/projects" class="text-accent underline hover:opacity-80">Projects</RouterLink> and click <strong>Move to room</strong>.
          </p>
        </div>
        <div class="rounded-lg border border-line bg-surface-2/40 p-3">
          <div class="flex items-center gap-2 font-medium text-xs text-fg">
            <span class="flex size-5 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-accent-ink shrink-0">3</span>
            <span>Add members</span>
          </div>
          <p class="mt-1.5 text-[11px] text-muted leading-relaxed">
            Invite friends in <RouterLink to="/members" class="text-accent underline hover:opacity-80">Members</RouterLink>, then assign them to the room right here.
          </p>
        </div>
      </div>
    </div>

    <!-- Room Cards (Ordered: HQ -> Rooms -> Personal) -->
    <div class="space-y-4">
      <article
        v-for="r in sortedRooms"
        :key="r.id"
        class="card overflow-hidden transition-all"
        :class="r.current && 'ring-1 ring-accent/60 shadow-sm'"
      >
        <!-- Coloured top strip per kind -->
        <div class="h-1.5 w-full shrink-0" :class="topStripBg(r.kind)" />

        <div class="p-4 sm:p-5 space-y-4">
          <!-- Room Header -->
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap items-center gap-2.5">
              <span
                class="flex size-7 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2"
                :class="r.current ? 'text-accent border-accent/30' : 'text-fg'"
              >
                <component :is="kindIcon(r.kind)" :size="15" />
              </span>
              <h2 class="font-semibold text-base text-fg tracking-tight">{{ r.name }}</h2>
              <span class="chip text-xs font-medium">{{ kindLabel[r.kind] }}</span>
              <span v-if="r.current" class="chip text-xs font-semibold text-accent border-accent/40 bg-accent-soft">
                you are here
              </span>
              <span class="text-xs text-muted">
                {{ r.agents }} {{ r.agents === 1 ? 'agent' : 'agents' }} · {{ r.projects }} {{ r.projects === 1 ? 'project' : 'projects' }}
              </span>

              <!-- Member avatars in header -->
              <div v-if="r.members && r.members.length > 0" class="flex items-center gap-1.5 ml-1">
                <div class="flex -space-x-1.5 overflow-hidden">
                  <span
                    v-for="m in r.members.slice(0, 5)"
                    :key="m.id"
                    :title="m.name || m.email"
                    class="inline-flex size-6 items-center justify-center rounded-full border border-surface bg-surface-2 font-mono text-[9px] font-semibold text-fg shadow-xs ring-1 ring-line"
                  >
                    {{ getInitials(m.name || m.email) }}
                  </span>
                </div>
                <span v-if="r.members.length > 5" class="text-[11px] text-muted font-mono font-medium">
                  +{{ r.members.length - 5 }}
                </span>
              </div>
            </div>

            <button
              v-if="!r.current"
              type="button"
              class="btn btn-sm btn-ghost hover:bg-surface-2 border border-line text-xs font-medium ml-auto"
              @click="enterRoom(r.id)"
            >
              <LogIn :size="13" class="text-accent" />
              <span>Enter room</span>
            </button>
          </div>

          <!-- Token Allowance Progress Bar (for rooms with daily token budget) -->
          <div
            v-if="r.left_today !== null && r.daily_token_budget > 0"
            class="rounded-lg border border-line bg-surface-2/40 p-3 space-y-2"
          >
            <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span class="font-medium text-fg flex items-center gap-1.5">
                <Coins :size="13" class="text-accent shrink-0" />
                <span>Daily Token Budget</span>
              </span>
              <span class="font-mono text-xs tabular-nums text-muted">
                <strong class="font-semibold text-fg">{{ fmtTokens(r.left_today) }}</strong> left of {{ fmtTokens(r.daily_token_budget) }} today
                <span class="text-faint">({{ Math.round((r.left_today / r.daily_token_budget) * 100) }}%)</span>
              </span>
            </div>
            <!-- Progress Bar -->
            <div class="h-2 w-full overflow-hidden rounded-full bg-sunken">
              <div
                class="h-full rounded-full transition-all duration-300"
                :class="
                  r.left_today / r.daily_token_budget < 0.15
                    ? 'bg-danger'
                    : r.left_today / r.daily_token_budget < 0.35
                      ? 'bg-signal'
                      : 'bg-accent'
                "
                :style="{ width: `${Math.max(0, Math.min(100, (r.left_today / r.daily_token_budget) * 100))}%` }"
              />
            </div>
          </div>

          <!-- Room Configuration (Kind === 'room') -->
          <div v-if="r.kind === 'room'" class="space-y-4 pt-1 border-t border-line">
            <div class="grid gap-4 sm:grid-cols-[14rem_1fr]">
              <label class="block">
                <span class="label">Daily limit (tokens)</span>
                <input
                  v-model.number="budgets[r.id]"
                  type="number"
                  min="1000"
                  step="any"
                  class="input font-mono text-sm"
                />
                <span v-if="r.left_today !== null" class="mt-1 block text-[11px] text-muted font-mono">
                  {{ fmtTokens(r.left_today) }} left today
                </span>
              </label>

              <div>
                <div class="label flex items-center gap-1.5">
                  <Users :size="13" class="text-accent" />
                  <span>Members in this room</span>
                </div>
                <p v-if="!members.length" class="text-xs text-muted">
                  No members added yet. Add members in <RouterLink to="/members" class="text-accent underline">Settings → Members</RouterLink>.
                </p>
                <div v-else class="flex flex-wrap gap-2 pt-0.5">
                  <label
                    v-for="m in members"
                    :key="m.id"
                    class="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs cursor-pointer transition-colors hover:bg-surface-2"
                    :class="picks[r.id]?.includes(m.id) && 'border-accent/40 bg-accent-soft/30 font-medium'"
                  >
                    <input
                      type="checkbox"
                      class="size-3.5 rounded accent-accent"
                      :checked="picks[r.id]?.includes(m.id)"
                      @change="togglePick(r.id, m.id, ($event.target as HTMLInputElement).checked)"
                    />
                    <span class="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-[9px] font-semibold text-fg border border-line">
                      {{ getInitials(m.name || m.email) }}
                    </span>
                    <span class="truncate">{{ m.name || m.email }}</span>
                  </label>
                </div>
              </div>
            </div>

            <div>
              <button
                type="button"
                class="btn btn-sm btn-primary h-8 px-3"
                :disabled="busy"
                @click="save(r)"
              >
                Save changes
              </button>
            </div>
          </div>

          <!-- Personal Room Description -->
          <div v-else-if="r.kind === 'personal'" class="text-xs text-muted">
            <span class="font-medium text-fg">{{ r.members[0]?.email }}</span>'s private room. Their agents run using their own personal AI keys.
          </div>

          <!-- HQ Description -->
          <div v-else class="text-xs text-muted">
            Your primary headquarters. All original agents, projects, schedules, and tools reside here.
          </div>
        </div>
      </article>
    </div>
  </div>
</template>
