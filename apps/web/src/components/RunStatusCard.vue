<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { CircleAlert, Clock, Hourglass, LoaderCircle, OctagonX, RotateCcw, ShieldQuestion, Square } from "lucide-vue-next";
import { useOffice } from "../stores/office.ts";
import { fmtDuration, runStatus } from "../runStatus.ts";

/**
 * The live status of one job: queued with its place in line and why, the step it is on with a timer,
 * waiting for approval, quiet for too long, failed or stopped with the reason.
 * Follows Task 019: one clear line per phase, animated bar while running, full wrap on error.
 */
const props = defineProps<{ jobId: string; compact?: boolean }>();
const emit = defineEmits<{ stop: []; retry: [] }>();
const office = useOffice();

// tick every second so timers update live
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => (timer = setInterval(() => (now.value = Date.now()), 1000)));
onBeforeUnmount(() => clearInterval(timer));

const st = computed(() => runStatus(office.state, props.jobId, now.value));

const tone = computed(
  () =>
    ({
      queued: "border-line bg-surface-2/60 text-muted",
      running: "border-accent/35 bg-accent/5 text-fg",
      waiting_approval: "border-review/40 bg-review/10 text-fg",
      quiet: "border-signal/50 bg-signal-soft/70 text-fg",
      failed: "border-danger/45 bg-danger-soft/70 text-danger",
      cancelled: "border-line bg-surface-2/60 text-muted",
      done: "border-line text-muted",
    })[st.value.phase],
);
</script>

<template>
  <div
    v-if="st.phase !== 'done'"
    class="relative overflow-hidden rounded-xl border text-xs transition-all"
    :class="[tone, compact ? 'px-2.5 py-1.5' : 'p-2.5 sm:p-3']"
    role="status"
    aria-live="polite"
  >
    <div class="flex items-center gap-1.5 sm:gap-2 min-w-0">
      <!-- Phase Icon -->
      <LoaderCircle v-if="st.phase === 'running'" :size="14" class="shrink-0 text-accent motion-safe:animate-spin" />
      <Hourglass v-else-if="st.phase === 'queued'" :size="14" class="shrink-0 text-muted" />
      <ShieldQuestion v-else-if="st.phase === 'waiting_approval'" :size="14" class="shrink-0 text-review" />
      <Clock v-else-if="st.phase === 'quiet'" :size="14" class="shrink-0 text-signal" />
      <CircleAlert v-else-if="st.phase === 'failed'" :size="14" class="shrink-0 text-danger" />
      <OctagonX v-else :size="14" class="shrink-0 text-muted" />

      <!-- Queued chip: "#2 in line" -->
      <span
        v-if="st.phase === 'queued'"
        class="chip chip-sm text-[11px] font-mono font-semibold bg-surface-2 border-line text-fg shrink-0"
      >
        #{{ st.position ?? 1 }} in line
      </span>

      <!-- Label -->
      <span
        class="min-w-0 flex-1 truncate font-medium leading-snug"
        :class="st.phase === 'failed' ? 'text-danger font-semibold' : 'text-fg'"
        :title="st.label"
      >
        {{ st.label }}
      </span>

      <!-- Timer & Step Info -->
      <span
        v-if="st.phase === 'running' || st.phase === 'quiet' || st.phase === 'waiting_approval'"
        class="font-mono tabular-nums text-faint text-[11px] shrink-0"
      >
        {{ fmtDuration(st.seconds) }}<template v-if="st.steps"> · step {{ st.steps }}</template>
      </span>
      <span
        v-else-if="st.phase === 'queued'"
        class="font-mono tabular-nums text-faint text-[11px] shrink-0"
      >
        waiting {{ fmtDuration(st.seconds) }}
      </span>
      <span
        v-else-if="st.phase === 'failed' && st.seconds"
        class="font-mono tabular-nums text-danger/80 text-[11px] shrink-0"
      >
        {{ fmtDuration(st.seconds) }}
      </span>

      <!-- Actions: min-h-10 on phone (>= 40px tap target), sm:min-h-7 on desktop -->
      <RouterLink
        v-if="st.phase === 'waiting_approval'"
        to="/approvals"
        class="btn btn-sm min-h-10 sm:min-h-7 px-2.5 font-medium shrink-0 bg-review/20 border-review/30 text-review hover:bg-review/30"
      >
        Open approvals
      </RouterLink>

      <button
        v-if="st.can_stop"
        type="button"
        class="btn btn-ghost btn-sm min-h-10 sm:min-h-7 px-2 sm:px-2.5 text-danger hover:bg-danger-soft/40 font-medium shrink-0 cursor-pointer"
        title="Stop this job"
        @click="emit('stop')"
      >
        <Square :size="12" /> Stop
      </button>

      <button
        v-if="st.can_retry"
        type="button"
        class="btn btn-sm min-h-10 sm:min-h-7 px-2 sm:px-2.5 font-medium shrink-0 bg-surface border-line hover:border-line-strong text-fg cursor-pointer"
        title="Send it again"
        @click="emit('retry')"
      >
        <RotateCcw :size="12" /> Try again
      </button>
    </div>

    <!-- Detail Lines (omitted in compact mode) -->
    <template v-if="!compact">
      <!-- Quiet: amber with detail -->
      <p
        v-if="st.phase === 'quiet' && st.detail"
        class="mt-2 rounded-lg border border-signal/25 bg-signal-soft/50 p-2 text-[11.5px] leading-relaxed text-signal"
      >
        {{ st.detail }}
      </p>

      <!-- Failed: red with full error text (wrap, no truncation) -->
      <div
        v-else-if="st.phase === 'failed' && st.detail"
        class="mt-2 rounded-lg border border-danger/25 bg-danger-soft/50 p-2.5 font-mono text-[11.5px] leading-relaxed text-danger break-words whitespace-pre-wrap select-text"
      >
        {{ st.detail }}
      </div>

      <!-- Cancelled: grey with reason -->
      <p
        v-else-if="st.phase === 'cancelled' && st.detail"
        class="mt-1.5 text-xs text-muted leading-relaxed"
      >
        {{ st.detail }}
      </p>

      <!-- Queued detail -->
      <p
        v-else-if="st.phase === 'queued' && st.detail"
        class="mt-1.5 text-xs text-muted leading-relaxed"
      >
        {{ st.detail }}
      </p>
    </template>

    <!-- Subtle animated progress bar while running -->
    <div
      v-if="st.phase === 'running'"
      class="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-accent/20"
      aria-hidden="true"
    >
      <div class="h-full w-2/5 rounded-full bg-accent motion-safe:animate-pulse" />
    </div>
  </div>
</template>
