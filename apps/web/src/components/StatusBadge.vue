<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ status: string }>();

const tone: Record<string, string> = {
  queued: "bg-surface-2 text-muted",
  running: "bg-info-soft text-info",
  working: "bg-info-soft text-info",
  waiting_approval: "bg-signal-soft text-signal",
  done: "bg-accent-soft text-accent",
  online: "bg-accent-soft text-accent",
  failed: "bg-danger-soft text-danger",
  cancelled: "bg-surface-2 text-faint",
  offline: "bg-surface-2 text-faint",
  idle: "bg-surface-2 text-muted",
  away: "bg-surface-2 text-faint",
  pending: "bg-signal-soft text-signal",
  approved: "bg-accent-soft text-accent",
  rejected: "bg-danger-soft text-danger",
  expired: "bg-surface-2 text-faint",
  draft: "bg-signal-soft text-signal",
  edited: "bg-review-soft text-review",
  published: "bg-accent-soft text-accent",
};
const label = computed(() => (props.status === "waiting_approval" ? "needs you" : props.status));
const live = computed(() => ["running", "working", "waiting_approval"].includes(props.status));
</script>

<template>
  <span class="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-px text-[11px] leading-4.5 font-medium" :class="tone[status] ?? tone.queued">
    <span v-if="live" class="size-1.5 animate-pulse rounded-full bg-current" />
    {{ label }}
  </span>
</template>
