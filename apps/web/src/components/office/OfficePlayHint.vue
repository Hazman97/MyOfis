<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ChevronDown, Gamepad2, X } from "lucide-vue-next";

const STORAGE_KEY = "myofis-play-hint";
const dismissed = ref(false);
const collapsed = ref(false);

onMounted(() => {
  try {
    dismissed.value = localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // LocalStorage blocked in private mode
  }
  // Auto-collapse on small screens initially so it stays out of the way
  if (typeof window !== "undefined" && window.innerWidth < 640) {
    collapsed.value = true;
  }
});

function dismiss() {
  dismissed.value = true;
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // LocalStorage blocked
  }
}

function toggleCollapse() {
  collapsed.value = !collapsed.value;
}
</script>

<template>
  <aside
    v-if="!dismissed"
    class="absolute left-3 top-3 z-10 select-none transition-all duration-200"
    aria-label="Office play controls guide"
  >
    <!-- Collapsed Pill (mobile friendly) -->
    <div
      v-if="collapsed"
      class="flex items-center gap-1.5 rounded-full border border-line bg-surface/90 px-2.5 py-1 text-[11px] font-medium text-fg shadow-card backdrop-blur-md"
    >
      <button
        type="button"
        class="flex items-center gap-1.5 text-muted hover:text-fg transition-colors"
        title="Show play controls"
        @click="toggleCollapse"
      >
        <Gamepad2 :size="13" class="text-accent shrink-0" />
        <span class="font-semibold text-fg">How to play</span>
        <ChevronDown :size="12" class="text-muted" />
      </button>
      <button
        type="button"
        class="ml-1 rounded p-0.5 text-faint hover:text-fg transition-colors"
        title="Don't show again"
        aria-label="Dismiss guide"
        @click="dismiss"
      >
        <X :size="12" />
      </button>
    </div>

    <!-- Expanded Card -->
    <div
      v-else
      class="card w-64 border border-line bg-surface/95 p-3 shadow-card backdrop-blur-md text-xs sm:w-72"
    >
      <!-- Header -->
      <div class="flex items-center justify-between pb-2 border-b border-line mb-2">
        <div class="flex items-center gap-1.5 font-semibold text-fg text-xs">
          <Gamepad2 :size="14" class="text-accent shrink-0" />
          <span>Office Play Controls</span>
        </div>
        <div class="flex items-center gap-1">
          <!-- Collapse button -->
          <button
            type="button"
            class="rounded p-1 text-muted hover:text-fg hover:bg-surface-2 transition-colors sm:hidden"
            title="Collapse"
            @click="toggleCollapse"
          >
            <ChevronDown :size="13" class="rotate-180" />
          </button>
          <!-- Dismiss button -->
          <button
            type="button"
            class="rounded p-1 text-faint hover:text-fg hover:bg-surface-2 transition-colors"
            title="Don't show again"
            aria-label="Dismiss guide"
            @click="dismiss"
          >
            <X :size="13" />
          </button>
        </div>
      </div>

      <!-- 4 lines -->
      <ul class="space-y-1.5 text-[11px] leading-relaxed">
        <li class="flex items-start gap-2">
          <span class="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent">Tap</span>
          <span class="text-muted">Poke agent & see reactions</span>
        </li>
        <li class="flex items-start gap-2">
          <span class="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent">Drag</span>
          <span class="text-muted">Move (pantry · meeting · whiteboard · your desk)</span>
        </li>
        <li class="flex items-start gap-2">
          <span class="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent">Hold / R-click</span>
          <span class="text-muted">Open quick action ring menu</span>
        </li>
        <li class="flex items-start gap-2">
          <span class="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent">Floor / arrows</span>
          <span class="text-muted">Walk your character (WASD)</span>
        </li>
      </ul>
    </div>
  </aside>
</template>
