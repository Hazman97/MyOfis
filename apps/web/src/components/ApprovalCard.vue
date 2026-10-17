<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import { Check, LoaderCircle, ShieldAlert, X } from "lucide-vue-next";
import AgentAvatar from "./AgentAvatar.vue";
import StatusBadge from "./StatusBadge.vue";
import { api, type Approval } from "../api/http.ts";
import { useOffice } from "../stores/office.ts";
import { fmtDateTime } from "../format.ts";

const props = defineProps<{ approval: Approval; showRunLink?: boolean }>();
const emit = defineEmits<{ decided: [] }>();
const office = useOffice();
const busy = ref(false);
const error = ref("");

const agent = computed(() => office.agentById[props.approval.agent_id]);
const pending = computed(() => props.approval.status === "pending");
const riskStyle: Record<Approval["risk_level"], string> = {
  dangerous: "bg-danger-soft text-danger",
  review: "bg-review-soft text-review",
  safe: "bg-surface-2 text-muted",
};

async function decide(decision: "approved" | "rejected") {
  busy.value = true;
  error.value = "";
  try {
    await api.decideApproval(props.approval.id, decision);
    emit("decided");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <article
    class="card overflow-hidden"
    :class="pending ? (approval.risk_level === 'dangerous' ? 'border-danger/40 shadow-card' : 'border-signal/40 shadow-card') : 'opacity-80'"
  >
    <div class="flex flex-wrap items-center gap-2 px-4 pt-3.5">
      <AgentAvatar :name="agent?.name ?? '?'" :slug="agent?.slug" :size="26" />
      <span class="font-medium">{{ agent?.name ?? "Agent" }}</span>
      <span class="text-sm text-muted">wants to</span>
      <span class="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase" :class="riskStyle[approval.risk_level]">
        <ShieldAlert v-if="approval.risk_level === 'dangerous'" :size="12" />{{ approval.risk_level }}
      </span>
    </div>
    <p class="mx-4 mt-2.5 rounded-md border border-line bg-sunken px-3 py-2 font-mono text-[13px] break-all">{{ approval.action }}</p>
    <details v-if="approval.details.args" class="mx-4 mt-2 text-xs">
      <summary class="cursor-pointer text-muted hover:text-fg">Details · {{ approval.details.tool }}</summary>
      <pre class="mt-1.5 overflow-x-auto rounded-md bg-sunken p-2.5 font-mono">{{ JSON.stringify(approval.details.args, null, 2) }}</pre>
    </details>
    <p v-if="error" class="mx-4 mt-2 text-sm text-danger">{{ error }}</p>
    <div class="mt-3 flex flex-wrap items-center gap-2 border-t border-line bg-surface-2/50 px-4 py-2.5">
      <span class="text-xs text-faint">{{ fmtDateTime(approval.created_at) }}</span>
      <RouterLink v-if="showRunLink" :to="{ name: 'run', params: { id: approval.run_id } }" class="text-xs text-muted hover:text-fg hover:underline">Open run</RouterLink>
      <template v-if="pending">
        <button class="btn btn-danger btn-sm ml-auto" :disabled="busy" @click="decide('rejected')"><X :size="14" /> Reject</button>
        <button class="btn btn-primary btn-sm" :disabled="busy" @click="decide('approved')">
          <LoaderCircle v-if="busy" :size="14" class="motion-safe:animate-spin" />
          <Check v-else :size="14" />
          Approve
        </button>
      </template>
      <span v-else class="ml-auto inline-flex items-center gap-2 text-xs text-muted">
        <StatusBadge :status="approval.status" />
        <template v-if="approval.decided_via">via {{ approval.decided_via }}</template>
        <template v-if="approval.decided_at">· {{ fmtDateTime(approval.decided_at) }}</template>
      </span>
    </div>
  </article>
</template>
