<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { Brain, Hand, MessagesSquare, Pause, Play, Plus } from "lucide-vue-next";
import { api } from "../../api/http.ts";
import { useOffice } from "../../stores/office.ts";

/**
 * Long-press / right-click on an agent in the office: quick actions in a ring around the
 * pointer. They are the same as the agent panel's (chat, new job, pause, memory) plus a poke.
 */
const props = defineProps<{ agentId: string; x: number; y: number }>();
const emit = defineEmits<{ close: []; memory: [id: string]; poke: [id: string] }>();
const router = useRouter();
const office = useOffice();
const agent = computed(() => office.agentById[props.agentId]);
const busy = ref(false);

const items = computed(() => [
  { key: "chat", label: "Chat", icon: MessagesSquare },
  { key: "job", label: "New job", icon: Plus },
  { key: "pause", label: agent.value?.enabled ? "Pause" : "Enable", icon: agent.value?.enabled ? Pause : Play },
  { key: "memory", label: "Memory", icon: Brain },
  { key: "poke", label: "Poke", icon: Hand },
]);

const RADIUS = 64;
const pos = (i: number) => {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / items.value.length;
  return { left: `${Math.cos(a) * RADIUS}px`, top: `${Math.sin(a) * RADIUS}px` };
};

// Keep inside viewport near screen edges: shift x/y by up to 60px if needed
const adjustedPos = computed(() => {
  if (typeof window === "undefined") return { x: props.x, y: props.y };
  const pad = 86; // radius + button half
  let shiftX = 0;
  let shiftY = 0;
  if (props.x < pad) shiftX = Math.min(60, pad - props.x);
  else if (props.x > window.innerWidth - pad) shiftX = -Math.min(60, props.x - (window.innerWidth - pad));

  if (props.y < pad) shiftY = Math.min(60, pad - props.y);
  else if (props.y > window.innerHeight - pad) shiftY = -Math.min(60, props.y - (window.innerHeight - pad));

  return { x: props.x + shiftX, y: props.y + shiftY };
});

async function pick(key: string) {
  const a = agent.value;
  if (!a) return emit("close");
  if (key === "chat") await router.push({ path: "/chat", query: { agent: a.slug } });
  else if (key === "job") await router.push({ path: "/jobs/new", query: { agent: a.slug } });
  else if (key === "memory") emit("memory", a.id);
  else if (key === "poke") emit("poke", a.id);
  else if (key === "pause" && !busy.value && !a.shared) {
    busy.value = true;
    try {
      await api.updateAgent(a.id, { enabled: !a.enabled });
      await office.loadAgents();
    } finally {
      busy.value = false;
    }
  }
  emit("close");
}

const onKey = (e: KeyboardEvent) => e.key === "Escape" && emit("close");
onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <!-- the right-click that opened the menu also fires contextmenu here: just swallow it -->
  <div class="fixed inset-0 z-40" @pointerdown.self="emit('close')" @contextmenu.prevent>
    <div
      class="fixed"
      :style="{ left: `${adjustedPos.x}px`, top: `${adjustedPos.y}px` }"
      role="menu"
      :aria-label="`Actions for ${agent?.name ?? 'agent'}`"
    >
      <!-- Center Pill: Agent Name & Status -->
      <div
        class="center-pill pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface/95 px-2.5 py-1 text-[11px] font-semibold text-fg shadow-card backdrop-blur-md ring-1 ring-black/5 dark:ring-white/5"
      >
        <span
          class="size-1.5 rounded-full shrink-0"
          :class="agent?.enabled ? 'bg-accent shadow-[0_0_6px_rgba(16,185,129,0.5)]' : 'bg-muted/50'"
        />
        <span class="truncate max-w-[90px]">{{ agent?.name ?? "Agent" }}</span>
      </div>

      <!-- Radial Action Buttons -->
      <button
        v-for="(it, i) in items"
        :key="it.key"
        type="button"
        role="menuitem"
        class="menu-item absolute flex size-11 min-w-[44px] min-h-[44px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-full border bg-surface/95 text-[9px] font-semibold shadow-card backdrop-blur-md transition-all duration-150 hover:scale-110 active:scale-95 focus-visible:ring-2 focus-visible:ring-accent"
        :class="[
          it.key === 'pause' && !agent?.enabled
            ? 'border-accent/40 text-accent bg-accent-soft/80 hover:bg-accent hover:text-accent-ink shadow-[0_0_12px_rgba(16,185,129,0.25)]'
            : it.key === 'pause'
              ? 'border-line text-signal hover:border-signal/50 hover:bg-signal-soft/30'
              : 'border-line text-fg hover:border-accent hover:text-accent hover:bg-surface-2',
        ]"
        :style="{ ...pos(i), animationDelay: `${i * 35}ms` }"
        :disabled="it.key === 'pause' && (busy || !!agent?.shared)"
        :title="it.label"
        @click="pick(it.key)"
      >
        <component :is="it.icon" :size="15" class="shrink-0" />
        <span class="leading-none tracking-tight">{{ it.label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
@keyframes radialPopIn {
  0% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.3);
  }
  65% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1.1);
  }
  100% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}

@keyframes centerFade {
  0% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.7);
  }
  100% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}

.menu-item {
  animation: radialPopIn 0.24s cubic-bezier(0.16, 1, 0.3, 1) backwards;
}

.center-pill {
  animation: centerFade 0.2s cubic-bezier(0.16, 1, 0.3, 1) backwards;
}
</style>

