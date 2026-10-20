<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Coffee,
  FileText,
  Sparkles,
  XCircle,
} from "lucide-vue-next";
import { useOffice } from "../../stores/office.ts";
import { feedCounts, workFeed, type FeedItem, type FeedKind } from "../../workFeed.ts";
import { fmtAgo } from "../../format.ts";
import AgentAvatar from "../AgentAvatar.vue";

const office = useOffice();
const router = useRouter();
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now();
  }, 30_000);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

const items = computed(() => workFeed(office.state, now.value));
const counts = computed(() => feedCounts(office.state));

const KIND_STYLE: Record<
  FeedKind,
  {
    icon: any;
    label: string;
    badgeClass: string;
  }
> = {
  needs_you: {
    icon: AlertCircle,
    label: "Needs you",
    badgeClass: "bg-signal-soft text-signal border-signal/30",
  },
  draft: {
    icon: FileText,
    label: "Draft",
    badgeClass: "bg-review-soft text-review border-review/30",
  },
  working: {
    icon: Sparkles,
    label: "Working",
    badgeClass: "bg-accent-soft text-accent border-accent/30",
  },
  queued: {
    icon: Clock,
    label: "Queued",
    badgeClass: "bg-surface-2 text-muted border-line",
  },
  done: {
    icon: CheckCircle2,
    label: "Done",
    badgeClass: "bg-accent-soft text-accent border-accent/20",
  },
  failed: {
    icon: XCircle,
    label: "Failed",
    badgeClass: "bg-danger-soft text-danger border-danger/30",
  },
};

function onItemClick(item: FeedItem) {
  void router.push(item.to);
}
</script>

<template>
  <div class="card flex flex-col h-full overflow-hidden bg-surface shadow-sm">
    <!-- Header -->
    <div class="flex flex-col gap-2 border-b border-line px-3.5 py-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="sign">Work Feed</span>
          <span class="size-1.5 rounded-full bg-accent animate-pulse" />
        </div>
        <span class="font-mono text-[11px] text-faint tabular-nums">{{ items.length }} recent</span>
      </div>

      <!-- Count chips -->
      <div class="flex flex-wrap items-center gap-1.5" aria-label="Work status summary">
        <span
          v-if="counts.needs_you > 0"
          class="chip border-signal/40 bg-signal-soft font-semibold text-signal text-[11px] py-0.5 px-2"
        >
          <span class="size-1.5 rounded-full bg-signal animate-ping" />
          {{ counts.needs_you }} needs you
        </span>

        <span
          v-if="counts.working > 0"
          class="chip border-accent/30 bg-accent-soft font-medium text-accent text-[11px] py-0.5 px-2"
        >
          <span class="size-1.5 rounded-full bg-accent animate-pulse" />
          {{ counts.working }} working
        </span>

        <span
          v-if="counts.queued > 0"
          class="chip border-line bg-surface-2 text-muted text-[11px] py-0.5 px-2"
        >
          {{ counts.queued }} queued
        </span>

        <span
          v-if="counts.needs_you === 0 && counts.working === 0 && counts.queued === 0"
          class="chip border-line bg-surface-2 text-faint text-[11px] py-0.5 px-2"
        >
          All quiet
        </span>
      </div>
    </div>

    <!-- Feed list -->
    <div v-if="items.length > 0" class="flex-1 overflow-y-auto divide-y divide-line min-h-60 max-h-125 xl:max-h-none" role="feed" aria-label="Live work items">
      <div
        v-for="item in items"
        :key="item.key"
        role="button"
        tabindex="0"
        class="group flex items-start gap-3 p-3 transition-colors hover:bg-surface-2/60 cursor-pointer min-h-12 focus-visible:outline-none focus-visible:bg-surface-2"
        @click="onItemClick(item)"
        @keydown.enter="onItemClick(item)"
        @keydown.space.prevent="onItemClick(item)"
      >
        <!-- Kind icon / indicator -->
        <div class="relative shrink-0 mt-0.5">
          <span
            class="flex size-7 items-center justify-center rounded-lg border shadow-2xs transition-transform group-hover:scale-105"
            :class="KIND_STYLE[item.kind].badgeClass"
          >
            <component :is="KIND_STYLE[item.kind].icon" :size="14" />
          </span>
        </div>

        <!-- Content -->
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline justify-between gap-2">
            <span class="font-medium text-xs text-fg group-hover:text-accent transition-colors line-clamp-1">
              {{ item.title }}
            </span>
            <span class="shrink-0 font-mono text-[10px] text-faint whitespace-nowrap">
              {{ fmtAgo(item.at, now) }}
            </span>
          </div>

          <!-- Agent attribution -->
          <div class="mt-1 flex items-center gap-1.5">
            <template v-if="item.agent_id && office.agentById[item.agent_id]">
              <AgentAvatar
                :name="office.agentById[item.agent_id]!.name"
                :slug="office.agentById[item.agent_id]!.slug"
                :size="16"
              />
              <span class="truncate text-[11px] text-muted font-medium">
                {{ office.agentById[item.agent_id]!.name }}
              </span>
            </template>
            <span v-else class="text-[11px] text-faint italic">System</span>

            <span class="text-faint text-[10px]">·</span>
            <span class="text-[10px] font-medium capitalize text-muted">
              {{ KIND_STYLE[item.kind].label }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="flex flex-1 flex-col items-center justify-center p-8 text-center min-h-60" aria-live="polite">
      <div class="flex size-11 items-center justify-center rounded-full bg-surface-2 text-faint mb-3 shadow-inner">
        <Coffee :size="20" class="text-muted" />
      </div>
      <p class="font-semibold text-sm text-fg">All quiet</p>
      <p class="mt-1 text-xs text-muted max-w-48 leading-relaxed">
        No approvals waiting and no active jobs in the queue.
      </p>
    </div>
  </div>
</template>
