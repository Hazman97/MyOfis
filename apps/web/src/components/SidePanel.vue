<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { X } from "lucide-vue-next";

/** Right-hand drawer on desktop, full-screen sheet on phones. Esc closes. */
defineProps<{ title: string; sign?: string; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const onKey = (e: KeyboardEvent) => e.key === "Escape" && emit("close");
onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <div class="fixed inset-0 z-50">
    <div class="absolute inset-0 bg-black/30 backdrop-blur-[1px]" @click="emit('close')" />
    <aside
      class="absolute inset-y-0 right-0 flex w-full flex-col border-l border-line bg-surface shadow-card"
      :class="wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
    >
      <header class="flex items-start gap-3 border-b border-line px-5 pt-[calc(1rem+env(safe-area-inset-top,0px))] pb-4">
        <div class="min-w-0 flex-1">
          <div v-if="sign" class="sign">{{ sign }}</div>
          <h2 class="truncate text-lg font-semibold">{{ title }}</h2>
        </div>
        <button class="btn btn-ghost btn-sm" aria-label="Close" title="Close" @click="emit('close')"><X :size="16" /></button>
      </header>
      <div class="flex-1 overflow-y-auto px-5 py-4"><slot /></div>
      <footer v-if="$slots.footer" class="flex items-center gap-2 border-t border-line px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
        <slot name="footer" />
      </footer>
    </aside>
  </div>
</template>
