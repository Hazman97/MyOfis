<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { CalendarClock, Check, CircleDot, Plus, RotateCcw } from "lucide-vue-next";
import { dayKey, type LogEntry, type LogKind, type Project } from "@agent-office/shared";
import { api } from "../api/http.ts";

/**
 * The project log (Project Assistant): decisions, action items with owner and due date, meetings,
 * risks, important dates and notes. The assistant fills it from documents and your updates; you
 * can add and tick items here too. Actions due soon are sent to Telegram every morning.
 */
const props = defineProps<{ project: Project }>();
const entries = ref<LogEntry[]>([]);
const showDone = ref(false);
const error = ref("");
const form = reactive<{ kind: LogKind; text: string; owner: string; due_date: string }>({ kind: "action", text: "", owner: "", due_date: "" });
const today = dayKey(new Date().toISOString());

async function load() {
  entries.value = (await api.log(props.project.id)).entries;
}
onMounted(load);

const KINDS: { kind: LogKind; label: string }[] = [
  { kind: "action", label: "Action items" },
  { kind: "date", label: "Important dates" },
  { kind: "decision", label: "Decisions" },
  { kind: "risk", label: "Risks" },
  { kind: "meeting", label: "Meetings" },
  { kind: "note", label: "Notes" },
];
const groups = computed(() =>
  KINDS.map((k) => ({ ...k, items: entries.value.filter((e) => e.kind === k.kind && (showDone.value || e.status === "open")) })).filter((g) => g.items.length),
);
const dueClass = (e: LogEntry) => (!e.due_date || e.status === "done" ? "text-muted" : e.due_date < today ? "text-danger" : e.due_date <= dayKey(new Date(Date.now() + 2 * 86_400_000).toISOString()) ? "text-signal" : "text-muted");

async function toggle(e: LogEntry) {
  await api.updateLog(e.id, { status: e.status === "open" ? "done" : "open" });
  await load();
}
async function add() {
  error.value = "";
  try {
    await api.addLog({ project_id: props.project.id, kind: form.kind, text: form.text, owner: form.owner, due_date: form.due_date || null });
    form.text = form.owner = form.due_date = "";
    await load();
  } catch (err) {
    error.value = (err as Error).message;
  }
}
</script>

<template>
  <div class="space-y-4">
    <form class="card grid gap-2 p-3 sm:grid-cols-[7rem_1fr_7rem_8.5rem_auto] sm:items-end" @submit.prevent="add">
      <label><span class="label">Type</span><select v-model="form.kind" class="input text-sm"><option v-for="k in KINDS" :key="k.kind" :value="k.kind">{{ k.label.replace(/s$/, "") }}</option></select></label>
      <label><span class="label">What</span><input v-model="form.text" required minlength="3" maxlength="600" class="input text-sm" placeholder="Site visit Kluang" /></label>
      <label><span class="label">Who</span><input v-model="form.owner" maxlength="80" class="input text-sm" placeholder="Irfan" /></label>
      <label><span class="label">Due</span><input v-model="form.due_date" type="date" class="input text-sm" /></label>
      <button class="btn btn-primary btn-sm" :disabled="form.text.trim().length < 3"><Plus :size="14" /> Add</button>
    </form>
    <p v-if="error" class="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{{ error }}</p>
    <label class="flex items-center gap-2 text-xs text-muted"><input v-model="showDone" type="checkbox" class="accent-accent" /> Show done items</label>

    <p v-if="!groups.length" class="text-sm text-muted">Nothing in the log yet. Send the Project Assistant your minutes or an update.</p>
    <section v-for="g in groups" :key="g.kind" class="space-y-1.5">
      <h3 class="sign">{{ g.label }} · {{ g.items.length }}</h3>
      <div v-for="e in g.items" :key="e.id" class="flex items-start gap-2 rounded-lg border border-line p-2 text-sm" :class="e.status === 'done' && 'opacity-60'">
        <button v-if="e.kind === 'action' || e.kind === 'date'" type="button" class="btn btn-ghost btn-sm mt-0.5 size-7 p-0" :aria-label="e.status === 'open' ? 'Mark done' : 'Open again'" @click="toggle(e)">
          <Check v-if="e.status === 'open'" :size="14" /><RotateCcw v-else :size="14" />
        </button>
        <CircleDot v-else :size="14" class="mt-1.5 shrink-0 text-faint" />
        <div class="min-w-0 flex-1">
          <p :class="e.status === 'done' && 'line-through'">{{ e.text }}</p>
          <p class="text-[11px] text-muted">
            <span v-if="e.owner">{{ e.owner }}</span>
            <span v-if="e.due_date" class="ml-2 inline-flex items-center gap-1" :class="dueClass(e)"><CalendarClock :size="11" /> {{ e.due_date }}</span>
          </p>
        </div>
      </div>
    </section>
  </div>
</template>
