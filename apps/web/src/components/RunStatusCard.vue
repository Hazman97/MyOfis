<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { CircleAlert, Clock, Hourglass, LoaderCircle, OctagonX, RotateCcw, ShieldQuestion, Square } from "lucide-vue-next";
import { useOffice } from "../stores/office.ts";
import { fmtDuration, runStatus } from "../runStatus.ts";

/**
 * The live status of one job (a chat reply, a studio job): queued with its place in line and why,
 * the step it is on with a timer, waiting for approval, quiet for too long, failed or stopped with
 * the reason. Logic is in runStatus.ts (pure, tested); this only shows it.
 */
const props = defineProps<{ jobId: string; compact?: boolean }>();
const emit = defineEmits<{ stop: []; retry: [] }>();
const office = useOffice();

// tick every second so the timers move
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => (timer = setInterval(() => (now.value = Date.now()), 1000)));
onBeforeUnmount(() => clearInterval(timer));

const st = computed(() => runStatus(office.state, props.jobId, now.value));
const tone = computed(
  () =>
    ({
      queued: "border-line bg-surface-2/60 text-muted",
      running: "border-accent/30 bg-accent/5 text-fg",
      waiting_approval: "border-review/40 bg-review/10 text-fg",
      quiet: "border-signal/40 bg-signal-soft text-fg",
      failed: "border-danger/40 bg-danger-soft text-danger",
      cancelled: "border-line bg-surface-2/60 text-muted",
      done: "border-line text-muted",
    })[st.value.phase],
);
</script>

<template>
  <div v-if="st.phase !== 'done'" class="rounded-lg border px-3 py-2 text-xs" :class="tone" role="status" aria-live="polite">
    <div class="flex flex-wrap items-center gap-2">
      <LoaderCircle v-if="st.phase === 'running'" :size="14" class="shrink-0 text-accent motion-safe:animate-spin" />
      <Hourglass v-else-if="st.phase === 'queued'" :size="14" class="shrink-0" />
      <ShieldQuestion v-else-if="st.phase === 'waiting_approval'" :size="14" class="shrink-0 text-review" />
      <Clock v-else-if="st.phase === 'quiet'" :size="14" class="shrink-0 text-signal" />
      <CircleAlert v-else-if="st.phase === 'failed'" :size="14" class="shrink-0" />
      <OctagonX v-else :size="14" class="shrink-0" />

      <span class="min-w-0 flex-1 font-medium">{{ st.label }}</span>

      <span v-if="st.phase === 'running' || st.phase === 'quiet' || st.phase === 'waiting_approval'" class="font-mono tabular-nums text-faint">
        {{ fmtDuration(st.seconds) }}<template v-if="st.steps"> · step {{ st.steps }}</template>
      </span>
      <span v-else-if="st.phase === 'queued'" class="font-mono tabular-nums text-faint">waiting {{ fmtDuration(st.seconds) }}</span>

      <RouterLink v-if="st.phase === 'waiting_approval'" to="/approvals" class="btn btn-sm min-h-8">Open approvals</RouterLink>
      <button v-if="st.can_stop" type="button" class="btn btn-ghost btn-sm min-h-8 text-danger" title="Stop this job" @click="emit('stop')">
        <Square :size="12" /> Stop
      </button>
      <button v-if="st.can_retry" type="button" class="btn btn-sm min-h-8" title="Send it again" @click="emit('retry')">
        <RotateCcw :size="12" /> Try again
      </button>
    </div>
    <p v-if="st.detail && !compact" class="mt-1 leading-relaxed" :class="st.phase === 'failed' ? '' : 'text-muted'">{{ st.detail }}</p>
  </div>
</template>
