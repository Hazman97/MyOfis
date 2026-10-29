<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { Building2, Plus, SquareKanban } from "lucide-vue-next";
import { dayKey, type JobStatus, type JobView } from "@agent-office/shared";
import AgentAvatar from "../components/AgentAvatar.vue";
import PageHeader from "../components/PageHeader.vue";
import StatusBadge from "../components/StatusBadge.vue";
import AgentPanel from "../components/office/AgentPanel.vue";
import AgentRadialMenu from "../components/office/AgentRadialMenu.vue";
import OfficePlayHint from "../components/office/OfficePlayHint.vue";
import WorkFeed from "../components/office/WorkFeed.vue";
import { api, type Room } from "../api/http.ts";
import { me } from "../me.ts";
import { useOffice } from "../stores/office.ts";
import { boardJobs, isChatJob } from "../jobs.ts";
import { fmtDateTime, fmtTokens, fmtUsd } from "../format.ts";

const office = useOffice();
const router = useRouter();

// Office (pixel view) or Board (cards + kanban), remembered per browser.
// The office canvas is its own chunk, so the board never loads Phaser.
const OfficeCanvas = defineAsyncComponent(() => import("../components/office/OfficeCanvas.vue"));
const VIEW_KEY = "ao:dashboard-view";
const VIEWS = [
  { key: "office", label: "Office", icon: Building2 },
  { key: "board", label: "Board", icon: SquareKanban },
] as const;
type DashView = (typeof VIEWS)[number]["key"];
const readView = (): DashView => {
  try {
    return localStorage.getItem(VIEW_KEY) === "board" ? "board" : "office";
  } catch {
    return "office";
  }
};
const view = ref<DashView>(readView());
watch(view, (v) => {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    // private mode: just do not remember
  }
});
/** Agent whose panel is open (clicked in the office). */
const inspected = ref<string | null>(null);

// playing with the agents: radial menu (long-press / right-click), drops that open pages, and the
// agent standing next to your own character
const canvas = ref<{ poke(id: string): void } | null>(null);
const menu = ref<{ id: string; x: number; y: number } | null>(null);
const nearAgent = ref<string | null>(null);
const nearName = computed(() => {
  const a = nearAgent.value ? office.agentById[nearAgent.value] : null;
  return a && !a.config.external ? a.name : null;
});
function onDrop(action: { open: "drafts" } | { open: "chat"; agent: string }) {
  if (action.open === "drafts") void router.push("/drafts");
  else {
    const a = office.agentById[action.agent];
    const slug = a && !a.config.external ? a.slug : null;
    if (slug) void router.push({ path: "/chat", query: { agent: slug } });
  }
}
function chatNear() {
  const slug = nearAgent.value ? office.agentById[nearAgent.value]?.slug : null;
  if (slug) void router.push({ path: "/chat", query: { agent: slug } });
}

const columns: { key: string; title: string; statuses: JobStatus[]; empty: string }[] = [
  { key: "queued", title: "Queued", statuses: ["queued"], empty: "Nothing waiting" },
  { key: "running", title: "In progress", statuses: ["running", "waiting_approval"], empty: "Nobody is working" },
  { key: "done", title: "Done", statuses: ["done"], empty: "Nothing finished yet" },
  { key: "ended", title: "Failed / cancelled", statuses: ["failed", "cancelled"], empty: "No failures" },
];
const COLUMN_LIMIT = 25;
const mobileColumn = ref("running");

const byColumn = computed(() => {
  const out: Record<string, JobView[]> = {};
  for (const c of columns) out[c.key] = boardJobs(office.jobsNewestFirst).filter((j) => c.statuses.includes(j.status));
  return out;
});

const today = () => dayKey(new Date().toISOString());
const stats = computed(() => {
  const d = today();
  const jobs = boardJobs(office.jobsNewestFirst);
  return {
    active: jobs.filter((j) => j.status === "running" || j.status === "waiting_approval").length,
    waiting: Object.keys(office.state.pending_approvals).length,
    doneToday: jobs.filter((j) => j.status === "done" && dayKey(j.created_at) === d).length,
    queued: jobs.filter((j) => j.status === "queued").length,
    chatToday: office.jobsNewestFirst.filter((j) => isChatJob(j) && dayKey(j.created_at) === d).length,
  };
});
const anyRunnerOnline = computed(() => Object.values(office.state.runners).some((r) => r.online));
const enabledAgents = computed(() => office.agents.filter((a) => a.enabled));

const lastRun = (j: JobView) => {
  const id = j.run_ids.at(-1);
  return id ? office.state.runs[id] : undefined;
};
const agentName = (id: string) => office.agentById[id]?.name ?? "Unknown agent";
const agentSlug = (id: string) => office.agentById[id]?.slug;
const tokensToday = (id: string) => office.state.agents[id]?.tokens_by_day[today()] ?? 0;
const budgetPct = (id: string) => {
  const b = office.agentById[id]?.daily_token_budget ?? 0;
  return b ? Math.min(100, Math.round((tokensToday(id) / b) * 100)) : 0;
};
const activityOf = (id: string) => (office.agentById[id]?.enabled === false ? "away" : (office.state.agents[id]?.activity ?? "idle"));

function openJob(j: JobView) {
  const id = j.run_ids.at(-1);
  if (id && !j.parent_job_id) void router.push({ name: "run", params: { id } });
  else void router.push({ name: "job", params: { id: j.id } });
}
async function cancel(j: JobView) {
  await api.cancelJob(j.id);
}

const rooms = ref<Room[]>([]);
onMounted(async () => {
  rooms.value = (await api.rooms().catch(() => ({ rooms: [] as Room[] }))).rooms;
});
const currentRoom = computed(() => rooms.value.find((r) => r.id === me.value?.workspace_id));
const isHq = computed(() => !currentRoom.value || currentRoom.value.kind === "hq");
const roomSign = computed(() => (isHq.value ? "HQ Workspace" : `${currentRoom.value?.name || "Room"} Workspace`));
</script>

<template>
  <div class="space-y-6">
    <PageHeader :sign="roomSign" title="Today in the office">
      <RouterLink to="/jobs/new" class="btn btn-primary"><Plus :size="16" /> New job</RouterLink>
    </PageHeader>

    <div v-if="office.ready && !anyRunnerOnline" class="rounded-xl border border-signal/40 bg-signal-soft px-4 py-3 text-sm text-signal flex items-center justify-between gap-3 shadow-sm">
      <span>No runner is online, so jobs wait in the queue.</span>
      <RouterLink to="/runners" class="btn btn-sm btn-signal font-semibold">Connect a runner</RouterLink>
    </div>

    <!-- At a glance -->
    <section class="grid grid-cols-2 gap-3.5 md:grid-cols-4" aria-label="At a glance">
      <div class="card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card">
        <div class="flex items-center justify-between">
          <div class="sign">In progress</div>
          <span class="flex size-2 rounded-full" :class="stats.active ? 'bg-emerald-500 animate-pulse' : 'bg-muted/40'" />
        </div>
        <div class="mt-2 font-mono text-2xl font-semibold tabular-nums tracking-tight">{{ stats.active }}</div>
        <div class="mt-1 text-xs text-muted">Active agent runs</div>
      </div>

      <RouterLink
        to="/approvals"
        class="card p-4 transition-all duration-200 hover:-translate-y-0.5"
        :class="stats.waiting ? 'border-signal/50 bg-signal-soft/40 shadow-[0_0_20px_-5px_rgba(245,158,11,0.2)]' : 'hover:bg-surface-2'"
      >
        <div class="flex items-center justify-between">
          <div class="sign" :class="stats.waiting ? 'text-signal font-bold' : ''">Waiting for you</div>
          <span v-if="stats.waiting" class="rounded-full bg-signal px-1.5 py-0.5 font-mono text-[10px] font-bold text-white leading-none">ACTION</span>
        </div>
        <div class="mt-2 font-mono text-2xl font-semibold tabular-nums tracking-tight" :class="stats.waiting ? 'text-signal' : ''">{{ stats.waiting }}</div>
        <div class="mt-1 text-xs" :class="stats.waiting ? 'text-signal/90 font-medium' : 'text-muted'">Pending permissions</div>
      </RouterLink>

      <div class="card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card">
        <div class="flex items-center justify-between">
          <div class="sign">Done today</div>
          <span class="flex size-2 rounded-full bg-accent/60" />
        </div>
        <div class="mt-2 font-mono text-2xl font-semibold tabular-nums tracking-tight">{{ stats.doneToday }}</div>
        <div class="mt-1 text-xs text-muted">
          Completed jobs<RouterLink v-if="stats.chatToday" to="/chat" class="hover:text-fg"> · + {{ stats.chatToday }} chat message{{ stats.chatToday === 1 ? "" : "s" }}</RouterLink>
        </div>
      </div>

      <div class="card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card">
        <div class="flex items-center justify-between">
          <div class="sign">Spent today</div>
          <span class="text-xs font-mono text-muted">USD</span>
        </div>
        <div class="mt-2 font-mono text-2xl font-semibold tabular-nums tracking-tight">{{ fmtUsd(office.costToday) }}</div>
        <div class="mt-1 text-xs text-muted">Token compute cost</div>
      </div>
    </section>

    <!-- View Switcher -->
    <div class="flex items-center justify-between gap-3">
      <div class="inline-flex rounded-xl border border-line bg-surface p-1 shadow-sm" role="tablist" aria-label="Dashboard view">
        <button
          v-for="v in VIEWS"
          :key="v.key"
          role="tab"
          class="inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all duration-150"
          :class="view === v.key ? 'bg-accent text-accent-ink shadow-sm' : 'text-muted hover:text-fg hover:bg-surface-2'"
          :aria-selected="view === v.key"
          @click="view = v.key"
        >
          <component :is="v.icon" :size="14" /> {{ v.label }}
        </button>
      </div>
      <p v-if="view === 'office'" class="text-xs text-muted flex items-center gap-1.5 max-sm:hidden">
        <span class="size-1.5 rounded-full bg-accent animate-pulse" /> Tap an agent (poke) · drag to move · hold for menu · tap the floor to walk · <span class="font-pixel text-signal">!</span> needs you
      </p>
    </div>

    <!-- Office View -->
    <section v-if="view === 'office'" aria-label="Office" class="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:items-stretch">
      <div class="relative min-w-0 xl:col-span-2">
        <OfficePlayHint />
        <OfficeCanvas
          ref="canvas"
          :selected="inspected"
          @select="inspected = $event"
          @approval="inspected = $event"
          @menu="(id, x, y) => (menu = { id, x, y })"
          @action="onDrop"
          @near="nearAgent = $event"
        />
        <AgentRadialMenu
          v-if="menu"
          :agent-id="menu.id"
          :x="menu.x"
          :y="menu.y"
          @close="menu = null"
          @memory="(id) => (inspected = id)"
          @poke="(id) => canvas?.poke(id)"
        />
        <Transition
          enter-active-class="transition-all duration-300 ease-out"
          enter-from-class="opacity-0 translate-y-3 scale-90"
          enter-to-class="opacity-100 translate-y-0 scale-100"
          leave-active-class="transition-all duration-200 ease-in"
          leave-from-class="opacity-100 translate-y-0 scale-100"
          leave-to-class="opacity-0 translate-y-2 scale-95"
        >
          <button
            v-if="nearName"
            type="button"
            class="group absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line-strong bg-surface/95 px-3.5 py-1.5 text-xs font-semibold text-fg shadow-card backdrop-blur-md transition-all duration-150 hover:scale-105 hover:border-accent hover:shadow-lg active:scale-95"
            @click="chatNear"
          >
            <span class="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-[10px] font-bold text-accent-ink shadow-xs">
              {{ nearName.charAt(0).toUpperCase() }}
            </span>
            <span class="flex items-center gap-1.5 whitespace-nowrap">
              <span>Chat with <strong class="font-bold text-accent group-hover:underline">{{ nearName }}</strong></span>
              <span class="text-xs">💬</span>
            </span>
          </button>
        </Transition>
      </div>

      <div class="min-w-0 xl:col-span-1 flex flex-col">
        <WorkFeed class="h-full" />
      </div>
    </section>

    <!-- Team (Board View) -->
    <section v-if="view === 'board'" aria-labelledby="team-h">
      <div class="mb-3 flex items-baseline justify-between">
        <h2 id="team-h" class="text-sm font-semibold tracking-tight">Active Team</h2>
        <RouterLink to="/agents" class="text-xs font-medium text-accent hover:underline">Manage agents →</RouterLink>
      </div>
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <RouterLink v-for="a in enabledAgents" :key="a.id" :to="`/agents#${a.slug}`" class="card flex min-w-0 items-center gap-3 p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-card">
          <AgentAvatar :name="a.name" :slug="a.slug" />
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-2">
              <span class="truncate font-semibold text-sm">{{ a.name }}</span>
              <StatusBadge :status="activityOf(a.id)" />
            </div>
            <p class="truncate text-xs text-muted mt-0.5">{{ office.state.agents[a.id]?.last_message || a.role || a.model }}</p>
            <div class="mt-2 flex items-center gap-2" :title="`${tokensToday(a.id)} of ${a.daily_token_budget} tokens today`">
              <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <div class="h-full rounded-full transition-all" :class="budgetPct(a.id) > 85 ? 'bg-signal' : 'bg-accent'" :style="{ width: `${budgetPct(a.id)}%` }" />
              </div>
              <span class="font-mono text-[10px] text-faint tabular-nums">{{ fmtTokens(tokensToday(a.id)) }}</span>
            </div>
          </div>
        </RouterLink>
      </div>
    </section>

    <!-- Board (Kanban) -->
    <section v-if="view === 'board'" aria-labelledby="board-h">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="board-h" class="text-sm font-semibold tracking-tight">Job Pipelines</h2>
        <div class="ml-auto flex rounded-lg border border-line bg-surface p-0.5 md:hidden" role="tablist">
          <button
            v-for="c in columns"
            :key="c.key"
            role="tab"
            class="rounded-md px-2.5 py-1 text-xs font-medium"
            :class="mobileColumn === c.key ? 'bg-surface-2 text-fg font-semibold' : 'text-muted'"
            :aria-selected="mobileColumn === c.key"
            @click="mobileColumn = c.key"
          >
            {{ c.title.split(" ")[0] }} <span class="font-mono text-faint">({{ byColumn[c.key]?.length ?? 0 }})</span>
          </button>
        </div>
      </div>
      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div v-for="c in columns" :key="c.key" class="min-w-0" :class="mobileColumn !== c.key && 'max-md:hidden'">
          <div class="mb-2.5 hidden items-center justify-between text-xs font-semibold text-muted md:flex">
            <span>{{ c.title }}</span>
            <span class="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-faint">{{ byColumn[c.key]?.length ?? 0 }}</span>
          </div>
          <div class="space-y-2.5">
            <article
              v-for="j in byColumn[c.key]?.slice(0, COLUMN_LIMIT)"
              :key="j.id"
              class="card cursor-pointer p-3.5 transition-all duration-150 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-card"
              :class="j.status === 'waiting_approval' && 'border-signal/50 bg-signal-soft/10'"
              tabindex="0"
              @click="openJob(j)"
              @keydown.enter="openJob(j)"
            >
              <div class="flex min-w-0 items-start gap-2">
                <h4 class="min-w-0 flex-1 text-sm leading-snug font-semibold text-fg">{{ j.title }}</h4>
                <StatusBadge :status="j.status" />
              </div>
              <div class="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-muted">
                <AgentAvatar :name="agentName(j.agent_id)" :slug="agentSlug(j.agent_id)" :size="20" />
                <span class="truncate font-medium text-fg/90">{{ agentName(j.agent_id) }}</span>
                <span class="text-faint">·</span>
                <span class="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-mono text-muted">{{ j.trigger }}</span>
                <span v-if="j.created_by === 'assistant'" class="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">🤖 Claude</span>
                <span class="text-faint">·</span>
                <span class="shrink-0 text-faint">{{ fmtDateTime(j.created_at) }}</span>
              </div>
              <p v-if="lastRun(j)?.error" class="mt-2.5 rounded-lg border border-danger/20 bg-danger-soft/40 p-2 line-clamp-2 text-xs font-mono text-danger">{{ lastRun(j)!.error }}</p>
              <p v-else-if="lastRun(j)?.output" class="mt-2 line-clamp-2 text-xs text-muted leading-relaxed">{{ lastRun(j)!.output }}</p>
              <div class="mt-2.5 flex items-center gap-2 border-t border-line/60 pt-2 text-[11px]">
                <span v-if="lastRun(j) && lastRun(j)!.status !== 'running'" class="font-mono text-faint tabular-nums">
                  {{ fmtTokens(lastRun(j)!.tokens_in + lastRun(j)!.tokens_out) }} tok · {{ fmtUsd(lastRun(j)!.cost_usd) }}{{ lastRun(j)!.cost_unknown ? "?" : "" }}
                </span>
                <button v-if="['queued', 'running', 'waiting_approval'].includes(j.status)" class="btn btn-danger btn-sm ml-auto" @click.stop="cancel(j)">Cancel</button>
              </div>
            </article>
            <p v-if="!byColumn[c.key]?.length" class="rounded-xl border border-dashed border-line px-3 py-8 text-center text-xs text-faint">{{ c.empty }}</p>
            <p v-else-if="(byColumn[c.key]?.length ?? 0) > COLUMN_LIMIT" class="text-center text-xs text-faint">
              + {{ byColumn[c.key]!.length - COLUMN_LIMIT }} older
            </p>
          </div>
        </div>
      </div>
    </section>

    <AgentPanel v-if="inspected" :key="inspected" :agent-id="inspected" @close="inspected = null" />
  </div>
</template>
