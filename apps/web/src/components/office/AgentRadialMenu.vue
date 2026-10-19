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
const RADIUS = 52;
const pos = (i: number) => {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / items.value.length;
  return { left: `${Math.cos(a) * RADIUS}px`, top: `${Math.sin(a) * RADIUS}px` };
};

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
    <div class="fixed" :style="{ left: `${x}px`, top: `${y}px` }" role="menu" :aria-label="`Actions for ${agent?.name ?? 'agent'}`">
      <div class="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-surface/95 px-2 py-0.5 text-xs font-medium shadow-card">{{ agent?.name }}</div>
      <button
        v-for="(it, i) in items"
        :key="it.key"
        type="button"
        role="menuitem"
        class="absolute flex size-11 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-full border border-line bg-surface text-[9px] font-medium shadow-card transition-transform hover:scale-110 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent"
        :style="pos(i)"
        :disabled="it.key === 'pause' && (busy || !!agent?.shared)"
        :title="it.label"
        @click="pick(it.key)"
      >
        <component :is="it.icon" :size="15" />
        {{ it.label }}
      </button>
    </div>
  </div>
</template>
