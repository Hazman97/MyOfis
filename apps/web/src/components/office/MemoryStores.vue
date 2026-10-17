<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api, type AgentMemory, type MemoryTarget } from "../../api/http.ts";
import { NotebookPen, Pencil, Plus, UserRound, X } from "lucide-vue-next";

/**
 * The agent's two bounded memory stores (Hermes style): its own notes and the owner
 * profile every agent shares. The owner can edit, remove or add entries; the hub
 * still enforces the limit and refuses injection or secrets.
 */
const props = defineProps<{ agentId: string; reloadKey?: unknown }>();
const mem = ref<AgentMemory | null>(null);
const error = ref("");
const editing = ref<{ target: MemoryTarget; index: number | null; text: string } | null>(null);
const saving = ref(false);

async function load() {
  try {
    mem.value = await api.agentMemory(props.agentId);
  } catch {
    mem.value = null;
  }
}
watch(() => [props.agentId, props.reloadKey], load, { immediate: true });

const used = (entries: string[]) => (entries.length ? entries.join("\n§\n").length : 0);
const stores = computed(() =>
  mem.value
    ? (["memory", "user"] as const).map((target) => {
        const entries = mem.value![target];
        const limit = mem.value!.limits[target];
        const n = used(entries);
        return {
          target,
          title: target === "memory" ? "Own notes" : "About you (shared by all agents)",
          entries,
          used: n,
          limit,
          pct: Math.min(100, Math.round((n / limit) * 100)),
        };
      })
    : [],
);

async function save(target: MemoryTarget, entries: string[]) {
  error.value = "";
  saving.value = true;
  try {
    await api.setMemory(props.agentId, target, entries);
    editing.value = null;
    await load();
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    saving.value = false;
  }
}

const startEdit = (target: MemoryTarget, index: number | null) =>
  (editing.value = { target, index, text: index === null ? "" : mem.value![target][index]! });

function commitEdit() {
  const e = editing.value;
  if (!e || !mem.value) return;
  const text = e.text.trim();
  const entries = [...mem.value[e.target]];
  if (e.index === null) {
    if (text) entries.push(text);
  } else if (text) entries[e.index] = text;
  else entries.splice(e.index, 1);
  return save(e.target, entries);
}

const remove = (target: MemoryTarget, index: number) => save(target, mem.value![target].filter((_, i) => i !== index));
</script>

<template>
  <section v-if="mem" aria-labelledby="ms-title" class="space-y-3">
    <div class="space-y-0.5">
      <h3 id="ms-title" class="sign text-[10px] tracking-wider text-accent px-0.5">Memory</h3>
      <p class="text-[11px] text-muted px-0.5 leading-snug">What this agent remembers between jobs.</p>
    </div>
    <p v-if="error" class="rounded-lg border border-danger/30 bg-danger-soft px-3 py-1.5 text-xs text-danger font-medium" role="alert">{{ error }}</p>

    <div v-for="s in stores" :key="s.target" class="card overflow-hidden bg-surface/70 border-line shadow-sm">
      <div class="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1.5 text-xs">
        <div class="flex items-center gap-1.5 min-w-0">
          <component :is="s.target === 'memory' ? NotebookPen : UserRound" :size="13" class="text-accent shrink-0" />
          <span class="font-semibold text-fg tracking-tight truncate">{{ s.title }}</span>
        </div>
        <span class="font-mono text-[11px] text-muted tabular-nums shrink-0">{{ s.used }}/{{ s.limit }}</span>
      </div>
      <div class="mx-3 mb-2 h-1 overflow-hidden rounded-full bg-surface-2 border border-line/40">
        <div class="h-full rounded-full transition-all duration-300" :class="s.pct > 85 ? 'bg-signal' : 'bg-accent'" :style="{ width: `${s.pct}%` }" />
      </div>

      <ul class="divide-y divide-line border-t border-line text-xs">
        <li v-for="(entry, i) in s.entries" :key="`${s.target}-${i}`" class="group px-3 py-2 transition-colors hover:bg-surface-2/40">
          <template v-if="editing && editing.target === s.target && editing.index === i">
            <div class="w-full space-y-2">
              <textarea
                v-model="editing.text"
                class="input min-h-20 w-full font-mono text-xs leading-relaxed"
                :aria-label="`Edit entry ${i + 1}`"
                autofocus
              />
              <div class="flex items-center justify-end gap-1.5">
                <button type="button" class="btn btn-ghost btn-sm text-xs" @click="editing = null">cancel</button>
                <button type="button" class="btn btn-primary btn-sm text-xs shadow-sm" :disabled="saving" @click="commitEdit">save</button>
              </div>
            </div>
          </template>
          <div v-else class="flex items-start justify-between gap-2">
            <span class="min-w-0 flex-1 whitespace-pre-wrap leading-relaxed text-fg">{{ entry }}</span>
            <div class="entry-actions flex shrink-0 items-center gap-0.5 transition-opacity duration-150">
              <button
                type="button"
                class="btn btn-ghost btn-sm size-6 p-0 text-faint hover:text-fg"
                :aria-label="`Edit: ${entry}`"
                title="Edit"
                @click="startEdit(s.target, i)"
              >
                <Pencil :size="12" />
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-sm size-6 p-0 text-faint hover:text-danger hover:bg-danger-soft"
                :aria-label="`Remove: ${entry}`"
                title="Remove"
                :disabled="saving"
                @click="remove(s.target, i)"
              >
                <X :size="13" />
              </button>
            </div>
          </div>
        </li>

        <li v-if="!s.entries.length && !(editing && editing.target === s.target && editing.index === null)" class="px-3 py-3 text-xs text-faint italic">
          Nothing saved yet.
        </li>

        <li v-if="editing && editing.target === s.target && editing.index === null" class="px-3 py-2">
          <div class="w-full space-y-2">
            <textarea
              v-model="editing.text"
              class="input min-h-20 w-full font-mono text-xs leading-relaxed"
              aria-label="New entry"
              placeholder="One short fact"
              autofocus
            />
            <div class="flex items-center justify-end gap-1.5">
              <button type="button" class="btn btn-ghost btn-sm text-xs" @click="editing = null">cancel</button>
              <button type="button" class="btn btn-primary btn-sm text-xs shadow-sm" :disabled="saving" @click="commitEdit">add</button>
            </div>
          </div>
        </li>
      </ul>

      <button
        v-if="!editing"
        type="button"
        class="flex w-full items-center justify-center gap-1.5 border-t border-line py-2 text-xs font-medium text-muted hover:bg-surface-2/60 hover:text-fg transition-colors"
        @click="startEdit(s.target, null)"
      >
        <Plus :size="13" /> add
      </button>
    </div>
  </section>
</template>

<style scoped>
@media (hover: hover) {
  .entry-actions {
    opacity: 0;
  }
  .group:hover .entry-actions {
    opacity: 1;
  }
}
@media (hover: none) {
  .entry-actions {
    opacity: 1;
  }
}
</style>
