<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { Building2, Plus, SquareKanban } from "lucide-vue-next";
import { dayKey, type JobStatus, type JobView } from "@agent-office/shared";
import AgentAvatar from "../components/AgentAvatar.vue";
import PageHeader from "../components/PageHeader.vue";
import StatusBadge from "../components/StatusBadge.vue";
import AgentPanel from "../components/office/AgentPanel.vue";
import { api } from "../api/http.ts";
import { useOffice } from "../stores/office.ts";
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
  for (const c of columns) out[c.key] = office.jobsNewestFirst.filter((j) => c.statuses.includes(j.status));
  return out;
});

const today = () => dayKey(new Date().toISOString());
const stats = computed(() => {
  const d = today();
  const jobs = office.jobsNewestFirst;
  return {
    active: jobs.filter((j) => j.status === "running" || j.status === "waiting_approval").length,
    waiting: Object.keys(office.state.pending_approvals).length,
    doneToday: jobs.filter((j) => j.status === "done" && dayKey(j.created_at) === d).length,
    queued: jobs.filter((j) => j.status === "queued").length,
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
</script>

<template>
  <div class="space-y-6">
    <PageHeader sign="Office" title="Today in the office">
      <RouterLink to="/jobs/new" class="btn btn-primary"><Plus :size="16" /> New job</RouterLink>
    </PageHeader>

    <div v-if="office.ready && !anyRunnerOnline" class="rounded-lg border border-signal/40 bg-signal-soft px-4 py-3 text-sm text-signal">
      No runner is online, so jobs wait in the queue.
      <RouterLink to="/runners" class="font-semibold underline">Connect a runner</RouterLink>
    </div>

    <!-- At a glance -->
    <section class="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="At a glance">
      <div class="card px-4 py-3">
        <div class="sign">In progress</div>
        <div class="mt-1 font-mono text-2xl font-medium tabular-nums">{{ stats.active }}</div>
      </div>
      <RouterLink to="/approvals" class="card px-4 py-3 transition-colors" :class="stats.waiting ? 'border-signal/50 bg-signal-soft' : 'hover:bg-surface-2'">
        <div class="sign" :class="stats.waiting ? 'text-signal!' : ''">Waiting for you</div>
        <div class="mt-1 font-mono text-2xl font-medium tabular-nums" :class="stats.waiting ? 'text-signal' : ''">{{ stats.waiting }}</div>
      </RouterLink>
      <div class="card px-4 py-3">
        <div class="sign">Done today</div>
        <div class="mt-1 font-mono text-2xl font-medium tabular-nums">{{ stats.doneToday }}</div>
      </div>
      <div class="card px-4 py-3">
        <div class="sign">Spent today</div>
        <div class="mt-1 font-mono text-2xl font-medium tabular-nums">{{ fmtUsd(office.costToday) }}</div>
      </div>
    </section>

    <div class="flex items-center gap-3">
      <div class="flex rounded-lg border border-line bg-surface p-0.5" role="tablist" aria-label="Dashboard view">
        <button
          v-for="v in VIEWS"
          :key="v.key"
          role="tab"
          class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium"
          :class="view === v.key ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg'"
          :aria-selected="view === v.key"
          @click="view = v.key"
        >
          <component :is="v.icon" :size="15" /> {{ v.label }}
        </button>
      </div>
      <p v-if="view === 'office'" class="text-xs text-faint max-sm:hidden">
        Click someone to see what they are doing. A <span class="font-pixel text-signal">!</span> means they need you.
      </p>
    </div>

    <section v-if="view === 'office'" aria-label="Office">
      <OfficeCanvas :selected="inspected" @select="inspected = $event" @approval="inspected = $event" />
    </section>

    <!-- Team -->
    <section v-if="view === 'board'" aria-labelledby="team-h">
      <div class="mb-2 flex items-baseline gap-2">
        <h2 id="team-h" class="text-sm font-semibold">Team</h2>
        <RouterLink to="/agents" class="text-xs text-muted hover:text-fg">Manage</RouterLink>
      </div>
      <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <RouterLink v-for="a in enabledAgents" :key="a.id" :to="`/agents#${a.slug}`" class="card flex min-w-0 items-center gap-3 p-3 transition-colors hover:bg-surface-2">
          <AgentAvatar :name="a.name" :slug="a.slug" />
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-2">
              <span class="truncate font-medium">{{ a.name }}</span>
              <StatusBadge :status="activityOf(a.id)" />
            </div>
            <p class="truncate text-xs text-muted">{{ office.state.agents[a.id]?.last_message || a.role || a.model }}</p>
            <div class="mt-1.5 flex items-center gap-2" :title="`${tokensToday(a.id)} of ${a.daily_token_budget} tokens today`">
              <div class="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
                <div class="h-full rounded-full" :class="budgetPct(a.id) > 85 ? 'bg-signal' : 'bg-accent'" :style="{ width: `${budgetPct(a.id)}%` }" />
              </div>
              <span class="font-mono text-[10px] text-faint tabular-nums">{{ fmtTokens(tokensToday(a.id)) }}</span>
            </div>
          </div>
        </RouterLink>
      </div>
    </section>

    <!-- Board -->
    <section v-if="view === 'board'" aria-labelledby="board-h">
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <h2 id="board-h" class="text-sm font-semibold">Jobs</h2>
        <div class="ml-auto flex rounded-lg border border-line bg-surface p-0.5 md:hidden" role="tablist">
          <button
            v-for="c in columns"
            :key="c.key"
            role="tab"
            class="rounded-md px-2 py-1 text-xs font-medium"
            :class="mobileColumn === c.key ? 'bg-surface-2 text-fg' : 'text-muted'"
            :aria-selected="mobileColumn === c.key"
            @click="mobileColumn = c.key"
          >
            {{ c.title.split(" ")[0] }} <span class="font-mono text-faint">{{ byColumn[c.key]?.length }}</span>
          </button>
        </div>
      </div>
      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div v-for="c in columns" :key="c.key" class="min-w-0" :class="mobileColumn !== c.key && 'max-md:hidden'">
          <h3 class="mb-2 hidden items-center gap-2 text-xs font-medium text-muted md:flex">
            {{ c.title }} <span class="font-mono text-faint">{{ byColumn[c.key]?.length }}</span>
          </h3>
          <div class="space-y-2">
            <article
              v-for="j in byColumn[c.key]?.slice(0, COLUMN_LIMIT)"
              :key="j.id"
              class="card cursor-pointer p-3 transition-colors hover:border-line-strong"
              :class="j.status === 'waiting_approval' && 'border-signal/50'"
              tabindex="0"
              @click="openJob(j)"
              @keydown.enter="openJob(j)"
            >
              <div class="flex min-w-0 items-start gap-2">
                <h4 class="min-w-0 flex-1 text-sm leading-snug font-medium">{{ j.title }}</h4>
                <StatusBadge :status="j.status" />
              </div>
              <div class="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-muted">
                <AgentAvatar :name="agentName(j.agent_id)" :slug="agentSlug(j.agent_id)" :size="18" />
                <span class="truncate">{{ agentName(j.agent_id) }}</span>
                <span class="text-faint">·</span>
                <span class="shrink-0">{{ j.trigger }}</span>
                <span class="text-faint">·</span>
                <span class="shrink-0">{{ fmtDateTime(j.created_at) }}</span>
              </div>
              <p v-if="lastRun(j)?.error" class="mt-2 line-clamp-2 text-xs wrap-break-word text-danger">{{ lastRun(j)!.error }}</p>
              <p v-else-if="lastRun(j)?.output" class="mt-2 line-clamp-2 text-xs wrap-break-word text-muted">{{ lastRun(j)!.output }}</p>
              <div class="mt-2 flex items-center gap-2 text-[11px]">
                <span v-if="lastRun(j) && lastRun(j)!.status !== 'running'" class="font-mono text-faint tabular-nums">
                  {{ fmtTokens(lastRun(j)!.tokens_in + lastRun(j)!.tokens_out) }} tok · {{ fmtUsd(lastRun(j)!.cost_usd) }}{{ lastRun(j)!.cost_unknown ? "?" : "" }}
                </span>
                <button v-if="['queued', 'running', 'waiting_approval'].includes(j.status)" class="btn btn-danger btn-sm ml-auto" @click.stop="cancel(j)">Cancel</button>
              </div>
            </article>
            <p v-if="!byColumn[c.key]?.length" class="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-faint">{{ c.empty }}</p>
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
