<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { ArrowLeft, ExternalLink, FileText, GitPullRequest, History, X } from "lucide-vue-next";
import AgentAvatar from "../components/AgentAvatar.vue";
import ApprovalCard from "../components/ApprovalCard.vue";
import EventTimeline from "../components/EventTimeline.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { api, type Approval } from "../api/http.ts";
import { useOffice } from "../stores/office.ts";
import { fmtDateTime, fmtDuration, fmtTokens, fmtUsd } from "../format.ts";

const props = defineProps<{ id: string }>();
const office = useOffice();
const error = ref("");
const now = ref(Date.now());
let tick: ReturnType<typeof setInterval> | undefined;

const run = computed(() => office.state.runs[props.id]);
const job = computed(() => (run.value ? office.state.jobs[run.value.job_id] : undefined));
const agent = computed(() => (run.value ? office.agentById[run.value.agent_id] : undefined));
const events = computed(() => office.runEvents[props.id] ?? []);
const duration = computed(() => {
  void now.value;
  return run.value ? fmtDuration(run.value.started_at, run.value.ended_at) : "";
});

/** Screenshots and reports uploaded by the runner (artifact.created with a hub storage path). */
const artifacts = computed(() =>
  events.value.flatMap((e) =>
    e.type === "artifact.created" && e.payload.path?.startsWith("artifacts/")
      ? [{ id: e.id, kind: e.payload.kind, title: e.payload.title ?? e.payload.path, url: `/api/${e.payload.path}` }]
      : [],
  ),
);
const screenshots = computed(() => artifacts.value.filter((a) => a.kind === "screenshot"));
const documents = computed(() => artifacts.value.filter((a) => a.kind !== "screenshot"));
const links = computed(() =>
  events.value.flatMap((e) => (e.type === "artifact.created" && e.payload.url ? [{ id: e.id, kind: e.payload.kind, title: e.payload.title ?? e.payload.url, url: e.payload.url }] : [])),
);
const report = ref<{ title: string; text: string } | null>(null);
async function openReport(a: { title: string; url: string }) {
  const res = await fetch(a.url, { credentials: "same-origin" });
  report.value = { title: a.title, text: res.ok ? await res.text() : `Could not load (${res.status})` };
}

const approvals = ref<Approval[]>([]);
const pendingHere = computed(() => Object.values(office.state.pending_approvals).filter((a) => a.run_id === props.id).length);
async function loadApprovals() {
  approvals.value = (await api.approvals("pending")).approvals.filter((a) => a.run_id === props.id);
}
watch(pendingHere, () => void loadApprovals());

async function load() {
  error.value = "";
  try {
    await Promise.all([office.loadRun(props.id), loadApprovals()]);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

watch(() => props.id, load);
onMounted(() => {
  void load();
  tick = setInterval(() => (now.value = Date.now()), 1000);
});
onUnmounted(() => clearInterval(tick));

async function cancel() {
  await api.cancelRun(props.id);
}
</script>

<template>
  <div class="space-y-5">
    <RouterLink to="/" class="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft :size="15" /> Office</RouterLink>
    <p v-if="error" class="text-sm text-danger">{{ error }}</p>

    <template v-if="run">
      <header class="flex flex-wrap items-start gap-3">
        <AgentAvatar :name="agent?.name ?? '?'" :slug="agent?.slug" :size="44" />
        <div class="min-w-0 flex-1">
          <div class="sign">{{ agent?.name ?? "Agent" }} · run</div>
          <h1 class="text-xl leading-snug font-semibold tracking-tight sm:text-2xl">
            <RouterLink v-if="job" :to="{ name: 'job', params: { id: job.id } }" class="hover:underline">{{ job.title }}</RouterLink>
            <template v-else>Run</template>
          </h1>
        </div>
        <div class="flex items-center gap-2">
          <StatusBadge :status="run.status" />
          <button v-if="run.status === 'running'" class="btn btn-danger btn-sm" @click="cancel">Cancel run</button>
          <RouterLink v-else :to="{ path: '/replay', query: { run: run.id } }" class="btn btn-sm"><History :size="14" /> Replay in the office</RouterLink>
        </div>
      </header>

      <dl class="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line text-sm sm:grid-cols-3 lg:grid-cols-6">
        <div class="bg-surface px-3 py-2.5"><dt class="sign">Model</dt><dd class="mt-0.5 truncate font-mono text-xs">{{ agent ? `${agent.provider}:${agent.model}` : "—" }}</dd></div>
        <div class="bg-surface px-3 py-2.5"><dt class="sign">Engine</dt><dd class="mt-0.5 text-xs">{{ agent?.config.runtime === "opencode" ? "OpenCode" : "Agent Office" }}</dd></div>
        <div class="bg-surface px-3 py-2.5"><dt class="sign">Started</dt><dd class="mt-0.5 text-xs">{{ fmtDateTime(run.started_at) }}</dd></div>
        <div class="bg-surface px-3 py-2.5"><dt class="sign">Duration</dt><dd class="mt-0.5 font-mono text-xs tabular-nums">{{ duration }}</dd></div>
        <div class="bg-surface px-3 py-2.5"><dt class="sign">Tokens</dt><dd class="mt-0.5 font-mono text-xs tabular-nums">{{ fmtTokens(run.tokens_in) }} in · {{ fmtTokens(run.tokens_out) }} out</dd></div>
        <div class="bg-surface px-3 py-2.5">
          <dt class="sign">Cost</dt>
          <dd class="mt-0.5 font-mono text-xs tabular-nums">
            {{ fmtUsd(run.cost_usd) }}<span v-if="run.cost_unknown" class="text-faint" title="Set a price for this model in Settings"> · no price</span>
          </dd>
        </div>
      </dl>

      <p v-if="run.error" class="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm wrap-break-word text-danger">{{ run.error }}</p>

      <section v-if="approvals.length" class="space-y-2" aria-label="Waiting for your approval">
        <h2 class="sign text-signal!">Waiting for you</h2>
        <ApprovalCard v-for="a in approvals" :key="a.id" :approval="a" @decided="loadApprovals" />
      </section>

      <div class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div class="min-w-0 space-y-5">
          <section v-if="run.output" class="card p-4 sm:p-5">
            <h2 class="sign mb-2">Output</h2>
            <p class="text-sm leading-relaxed wrap-break-word whitespace-pre-wrap">{{ run.output }}<span v-if="run.status === 'running'" class="animate-pulse text-accent">▍</span></p>
          </section>

          <section v-if="artifacts.length || links.length" class="card space-y-3 p-4 sm:p-5">
            <h2 class="sign">Results</h2>
            <div v-if="screenshots.length" class="grid gap-3 sm:grid-cols-2">
              <figure v-for="a in screenshots" :key="a.id" class="min-w-0 space-y-1">
                <a :href="a.url" target="_blank" rel="noopener" class="block overflow-hidden rounded-md border border-line bg-sunken">
                  <img :src="a.url" :alt="`Screenshot of ${a.title}`" loading="lazy" class="w-full" />
                </a>
                <figcaption class="truncate font-mono text-[11px] text-faint">{{ a.url.split("/").pop() }}</figcaption>
              </figure>
            </div>
            <div v-if="documents.length || links.length" class="flex flex-wrap gap-2">
              <button v-for="a in documents" :key="a.id" class="btn btn-sm" @click="openReport(a)"><FileText :size="14" /> {{ a.title }}</button>
              <a v-for="l in links" :key="l.id" :href="l.url" target="_blank" rel="noopener noreferrer" class="btn btn-sm">
                <GitPullRequest v-if="l.kind === 'pr'" :size="14" /><ExternalLink v-else :size="14" /> {{ l.title }}
              </a>
            </div>
            <div v-if="report" class="rounded-md border border-line bg-sunken p-4">
              <div class="mb-2 flex items-center gap-2">
                <h3 class="text-sm font-semibold">{{ report.title }}</h3>
                <button class="btn btn-ghost btn-sm ml-auto" aria-label="Close report" title="Close report" @click="report = null"><X :size="14" /></button>
              </div>
              <pre class="font-sans text-sm leading-relaxed wrap-break-word whitespace-pre-wrap">{{ report.text }}</pre>
            </div>
          </section>
        </div>

        <section class="card min-w-0 self-start overflow-hidden">
          <h2 class="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <span class="sign">Event log</span><span class="font-mono text-[11px] text-faint">{{ run.event_count }}</span>
          </h2>
          <EventTimeline :events="events" />
        </section>
      </div>
    </template>
    <p v-else-if="office.ready && !error" class="text-sm text-muted">Run not found.</p>
  </div>
</template>
