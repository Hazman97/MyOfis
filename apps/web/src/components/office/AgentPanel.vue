<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { MessageSquarePlus, MessagesSquare, Pause, Play, Square } from "lucide-vue-next";
import { dayKey, type AgentEvent } from "@agent-office/shared";
import AgentAvatar from "../AgentAvatar.vue";
import ApprovalCard from "../ApprovalCard.vue";
import ConfirmButton from "../ConfirmButton.vue";
import EventTimeline from "../EventTimeline.vue";
import SidePanel from "../SidePanel.vue";
import MemoryStores from "./MemoryStores.vue";
import StatusBadge from "../StatusBadge.vue";
import { api, type Approval } from "../../api/http.ts";
import { useOffice } from "../../stores/office.ts";
import { fmtTime, fmtTokens, fmtUsd } from "../../format.ts";

/** What one agent is up to: opened by clicking a character in the office. */
const props = defineProps<{ agentId: string }>();
const emit = defineEmits<{ close: [] }>();
const office = useOffice();
const approvals = ref<Approval[]>([]);
const error = ref("");

const agent = computed(() => office.agentById[props.agentId]);
const view = computed(() => office.state.agents[props.agentId]);
const activity = computed(() => (agent.value?.enabled === false ? "away" : (view.value?.activity ?? "idle")));
const today = () => dayKey(new Date().toISOString());

/** The run being worked on, or the most recent one. */
const run = computed(() => {
  const current = view.value?.current_run_id;
  if (current && office.state.runs[current]) return office.state.runs[current];
  return Object.values(office.state.runs)
    .filter((r) => r.agent_id === props.agentId)
    .sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
});
const job = computed(() => (run.value ? office.state.jobs[run.value.job_id] : undefined));
const running = computed(() => !!run.value && run.value.status === "running");
const events = computed<AgentEvent[]>(() => (run.value ? (office.runEvents[run.value.id] ?? []) : []));
const recent = computed(() => events.value.slice(-60));
const toolCalls = computed(() =>
  events.value
    .filter((e): e is Extract<AgentEvent, { type: "agent.tool_call" }> => e.type === "agent.tool_call")
    .slice(-5)
    .reverse(),
);

const tokensToday = computed(() => view.value?.tokens_by_day[today()] ?? 0);
const budget = computed(() => agent.value?.daily_token_budget ?? 0);
const budgetPct = computed(() => (budget.value ? Math.min(100, Math.round((tokensToday.value / budget.value) * 100)) : 0));
const costToday = computed(() =>
  Object.values(office.state.runs)
    .filter((r) => r.agent_id === props.agentId && r.ended_at && dayKey(r.ended_at) === today())
    .reduce((sum, r) => sum + r.cost_usd, 0),
);

const argSummary = (args: Record<string, unknown>) => {
  const first = Object.values(args).find((v) => typeof v === "string") as string | undefined;
  return first ? first.slice(0, 80) : "";
};


async function loadApprovals() {
  try {
    approvals.value = (await api.approvals("pending")).approvals.filter((a) => a.agent_id === props.agentId);
  } catch {
    approvals.value = [];
  }
}

watch(
  () => run.value?.id,
  (id) => {
    if (id && !office.runEvents[id]) office.loadRun(id).catch(() => {});
  },
  { immediate: true },
);
// pending approvals live in the reducer state too: refetch the details when that set changes
watch(
  () => Object.values(office.state.pending_approvals).filter((a) => a.agent_id === props.agentId).length,
  loadApprovals,
  { immediate: true },
);

async function act(fn: () => Promise<unknown>) {
  error.value = "";
  try {
    await fn();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
const cancelRun = () => run.value && act(() => api.cancelRun(run.value!.id));
const togglePause = () =>
  agent.value &&
  act(async () => {
    await api.updateAgent(agent.value!.id, { enabled: !agent.value!.enabled });
    await office.loadAgents();
  });
</script>

<template>
  <SidePanel :title="agent?.name ?? 'Agent'" sign="In the office" @close="emit('close')">
    <div v-if="agent" class="space-y-5">
      <div class="flex items-center gap-3">
        <AgentAvatar :name="agent.name" :slug="agent.slug" :size="48" />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="truncate font-medium">{{ agent.role || agent.model }}</span>
            <StatusBadge :status="activity" />
          </div>
          <p v-if="view?.thinking" class="truncate text-sm text-muted italic">“{{ view.thinking }}”</p>
          <p v-else-if="view?.last_tool_category && activity === 'working'" class="text-sm text-muted">Using {{ view.last_tool_category.replace("_", " ") }} tools</p>
        </div>
      </div>

      <section v-if="approvals.length" class="space-y-2" aria-label="Waiting for you">
        <h3 class="sign text-signal!">Waiting for you</h3>
        <ApprovalCard v-for="a in approvals" :key="a.id" :approval="a" @decided="loadApprovals" />
      </section>

      <section aria-labelledby="ap-now">
        <h3 id="ap-now" class="sign mb-1.5">{{ running ? "Working on" : "Last job" }}</h3>
        <div v-if="job && run" class="card p-3">
          <div class="flex items-start gap-2">
            <p class="min-w-0 flex-1 text-sm font-medium">{{ job.title }}</p>
            <StatusBadge :status="job.status" />
          </div>
          <div class="mt-1 flex items-center gap-2 text-xs text-muted">
            <span>started {{ fmtTime(run.started_at) }}</span>
            <RouterLink :to="{ name: 'run', params: { id: run.id } }" class="ml-auto font-medium text-accent hover:underline">Open run</RouterLink>
          </div>
          <p v-if="run.error" class="mt-2 line-clamp-3 text-xs text-danger">{{ run.error }}</p>
        </div>
        <p v-else class="text-sm text-muted">Nothing yet. Give {{ agent.name }} a job.</p>
      </section>

      <section aria-labelledby="ap-budget">
        <h3 id="ap-budget" class="sign mb-1.5">Today</h3>
        <div class="flex items-baseline justify-between text-sm">
          <span class="font-mono tabular-nums">{{ fmtTokens(tokensToday) }} / {{ fmtTokens(budget) }} tokens</span>
          <span class="font-mono text-muted tabular-nums">{{ fmtUsd(costToday) }}</span>
        </div>
        <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div class="h-full rounded-full" :class="budgetPct > 85 ? 'bg-signal' : 'bg-accent'" :style="{ width: `${budgetPct}%` }" />
        </div>
      </section>

      <MemoryStores :agent-id="agentId" :reload-key="view?.current_run_id" />

      <section v-if="toolCalls.length" aria-labelledby="ap-tools">
        <h3 id="ap-tools" class="sign mb-1.5">Last tool calls</h3>
        <ul class="divide-y divide-line rounded-md border border-line text-sm">
          <li v-for="t in toolCalls" :key="t.id" class="flex min-w-0 items-center gap-2 px-3 py-1.5">
            <span class="chip shrink-0 text-[11px]">{{ t.payload.category }}</span>
            <span class="shrink-0 font-mono text-xs">{{ t.payload.tool }}</span>
            <span class="min-w-0 flex-1 truncate font-mono text-xs text-faint">{{ argSummary(t.payload.args) }}</span>
          </li>
        </ul>
      </section>

      <section v-if="recent.length" aria-labelledby="ap-log">
        <h3 id="ap-log" class="sign mb-1.5">Live log</h3>
        <div class="max-h-80 overflow-y-auto rounded-md border border-line p-2">
          <EventTimeline :events="recent" />
        </div>
      </section>

      <p v-if="error" class="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{{ error }}</p>
    </div>

    <template #footer>
      <RouterLink v-if="agent" :to="{ path: '/chat', query: { agent: agent.slug } }" class="btn btn-primary"><MessagesSquare :size="15" /> Chat</RouterLink>
      <RouterLink v-if="agent" :to="{ path: '/jobs/new', query: { agent: agent.slug } }" class="btn"><MessageSquarePlus :size="15" /> Job</RouterLink>
      <ConfirmButton v-if="running" confirm-label="Cancel run?" @confirm="cancelRun"><Square :size="13" /> Cancel run</ConfirmButton>
      <button v-if="agent" class="btn ml-auto" @click="togglePause">
        <component :is="agent.enabled ? Pause : Play" :size="14" /> {{ agent.enabled ? "Pause agent" : "Enable" }}
      </button>
    </template>
  </SidePanel>
</template>
