<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { ArrowLeft, ArrowRight, CornerDownRight } from "lucide-vue-next";
import AgentAvatar from "../components/AgentAvatar.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { api } from "../api/http.ts";
import { useOffice } from "../stores/office.ts";
import { fmtDateTime, fmtDuration, fmtTokens, fmtUsd } from "../format.ts";

const props = defineProps<{ id: string }>();
const office = useOffice();

const job = computed(() => office.state.jobs[props.id]);
const parent = computed(() => (job.value?.parent_job_id ? office.state.jobs[job.value.parent_job_id] : undefined));
const children = computed(() => Object.values(office.state.jobs).filter((j) => j.parent_job_id === props.id));
const runs = computed(() => (job.value?.run_ids ?? []).map((id) => office.state.runs[id]).filter((r) => !!r).reverse());
const agent = (id: string) => office.agentById[id];
const active = computed(() => job.value && ["queued", "running", "waiting_approval"].includes(job.value.status));
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-5">
    <RouterLink to="/" class="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft :size="15" /> Office</RouterLink>
    <template v-if="job">
      <header class="flex flex-wrap items-start gap-3">
        <AgentAvatar :name="agent(job.agent_id)?.name ?? '?'" :slug="agent(job.agent_id)?.slug" :size="44" />
        <div class="min-w-0 flex-1">
          <div class="sign">{{ agent(job.agent_id)?.name ?? "Agent" }} · job · {{ job.trigger }}</div>
          <h1 class="text-xl leading-snug font-semibold tracking-tight sm:text-2xl">{{ job.title }}</h1>
          <p class="mt-0.5 text-sm text-muted">Created {{ fmtDateTime(job.created_at) }}</p>
        </div>
        <div class="flex items-center gap-2">
          <StatusBadge :status="job.status" />
          <button v-if="active" class="btn btn-danger btn-sm" @click="api.cancelJob(job.id)">Cancel job</button>
        </div>
      </header>

      <section v-if="parent || children.length" class="card divide-y divide-line">
        <RouterLink v-if="parent" :to="{ name: 'job', params: { id: parent.id } }" class="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
          <span class="sign w-24 shrink-0">From</span>
          <AgentAvatar :name="agent(parent.agent_id)?.name ?? '?'" :slug="agent(parent.agent_id)?.slug" :size="24" />
          <span class="min-w-0 flex-1 truncate text-sm"><span class="font-medium">{{ agent(parent.agent_id)?.name }}</span> · {{ parent.title }}</span>
          <ArrowRight :size="15" class="text-faint" />
        </RouterLink>
        <RouterLink v-for="c in children" :key="c.id" :to="{ name: 'job', params: { id: c.id } }" class="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
          <span class="sign flex w-24 shrink-0 items-center gap-1"><CornerDownRight :size="12" />Handed to</span>
          <AgentAvatar :name="agent(c.agent_id)?.name ?? '?'" :slug="agent(c.agent_id)?.slug" :size="24" />
          <span class="min-w-0 flex-1 truncate text-sm"><span class="font-medium">{{ agent(c.agent_id)?.name }}</span> · {{ c.title }}</span>
          <StatusBadge :status="c.status" />
        </RouterLink>
      </section>

      <section class="card overflow-hidden">
        <h2 class="border-b border-line px-4 py-2.5"><span class="sign">Runs</span></h2>
        <RouterLink v-for="r in runs" :key="r!.id" :to="{ name: 'run', params: { id: r!.id } }" class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-3 last:border-0 hover:bg-surface-2">
          <StatusBadge :status="r!.status" />
          <span class="text-sm">{{ fmtDateTime(r!.started_at) }}</span>
          <span class="font-mono text-xs text-muted tabular-nums">{{ fmtDuration(r!.started_at, r!.ended_at) }}</span>
          <span class="ml-auto font-mono text-xs text-muted tabular-nums">{{ fmtTokens(r!.tokens_in + r!.tokens_out) }} tok · {{ fmtUsd(r!.cost_usd) }}</span>
        </RouterLink>
        <p v-if="!runs.length" class="px-4 py-4 text-sm text-muted">Not started yet. It waits for a free runner.</p>
      </section>
    </template>
    <p v-else-if="office.ready" class="text-sm text-muted">Job not found.</p>
  </div>
</template>
