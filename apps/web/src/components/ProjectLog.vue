<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronDown,
  CircleDot,
  Clock,
  FileText,
  ListTodo,
  Plus,
  RotateCcw,
  Sparkles,
  Users,
} from "lucide-vue-next";
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
const formOpen = ref(false);
const error = ref("");
const form = reactive<{ kind: LogKind; text: string; owner: string; due_date: string }>({
  kind: "action",
  text: "",
  owner: "",
  due_date: "",
});
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

const KIND_META: Record<LogKind, { icon: any; color: string; badgeColor: string }> = {
  action: { icon: ListTodo, color: "text-accent", badgeColor: "bg-accent-soft text-accent border-accent/20" },
  date: { icon: CalendarClock, color: "text-info", badgeColor: "bg-info-soft text-info border-info/20" },
  decision: { icon: Sparkles, color: "text-purple-600 dark:text-purple-400", badgeColor: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20" },
  risk: { icon: AlertTriangle, color: "text-danger", badgeColor: "bg-danger-soft text-danger border-danger/20" },
  meeting: { icon: Users, color: "text-sky-600 dark:text-sky-400", badgeColor: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20" },
  note: { icon: FileText, color: "text-muted", badgeColor: "bg-surface-2 text-muted border-line" },
};

const groups = computed(() =>
  KINDS.map((k) => ({
    ...k,
    items: entries.value.filter((e) => e.kind === k.kind && (showDone.value || e.status === "open")),
  })).filter((g) => g.items.length),
);

const upcomingItems = computed(() =>
  entries.value
    .filter((e) => e.status === "open" && e.due_date && (e.kind === "action" || e.kind === "date"))
    .sort((a, b) => a.due_date!.localeCompare(b.due_date!))
    .slice(0, 5),
);

const dueClass = (e: LogEntry) =>
  !e.due_date || e.status === "done"
    ? "text-muted"
    : e.due_date < today
      ? "text-danger"
      : e.due_date <= dayKey(new Date(Date.now() + 2 * 86_400_000).toISOString())
        ? "text-signal"
        : "text-muted";

function relativeDue(due: string | null): { label: string; badgeClass: string } {
  if (!due) return { label: "", badgeClass: "" };
  const dToday = new Date(today + "T00:00:00");
  const dDue = new Date(due + "T00:00:00");
  const diffDays = Math.round((dDue.getTime() - dToday.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    const abs = Math.abs(diffDays);
    return {
      label: `overdue ${abs} ${abs === 1 ? "day" : "days"}`,
      badgeClass: "bg-danger-soft text-danger border-danger/30 font-semibold",
    };
  }
  if (diffDays === 0) {
    return {
      label: "today",
      badgeClass: "bg-signal-soft text-signal border-signal/30 font-semibold",
    };
  }
  if (diffDays === 1) {
    return {
      label: "tomorrow",
      badgeClass: "bg-signal-soft/60 text-signal border-signal/20 font-medium",
    };
  }
  return {
    label: `in ${diffDays} days`,
    badgeClass:
      diffDays <= 3
        ? "bg-signal-soft/40 text-signal border-signal/20 font-medium"
        : "bg-surface-2 text-muted border-line",
  };
}

function getInitials(name: string): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const first = parts[0] ?? "";
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? "";
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}

async function toggle(e: LogEntry) {
  await api.updateLog(e.id, { status: e.status === "open" ? "done" : "open" });
  await load();
}

async function add() {
  error.value = "";
  try {
    await api.addLog({
      project_id: props.project.id,
      kind: form.kind,
      text: form.text,
      owner: form.owner,
      due_date: form.due_date || null,
    });
    form.text = form.owner = form.due_date = "";
    await load();
  } catch (err) {
    error.value = (err as Error).message;
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Upcoming Deadlines Strip (Next 5 Open Actions & Dates) -->
    <section v-if="upcomingItems.length" aria-label="Upcoming Deadlines" class="card p-3.5 space-y-2.5 bg-surface-2/30 border-line-strong">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1.5 sign text-accent">
          <Clock :size="12" />
          <span>Upcoming Deadlines</span>
        </div>
        <span class="chip text-[10px] font-mono font-medium">
          {{ upcomingItems.length }} next due
        </span>
      </div>

      <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="it in upcomingItems"
          :key="`up-${it.id}`"
          class="flex items-start gap-2.5 rounded-lg border border-line bg-surface p-2.5 shadow-xs transition-all hover:border-line-strong"
        >
          <button
            type="button"
            class="btn btn-ghost btn-sm mt-0.5 size-7 shrink-0 rounded-md p-0 hover:bg-surface-2 hover:text-accent transition-colors"
            :aria-label="it.status === 'open' ? 'Mark done' : 'Open again'"
            :title="it.status === 'open' ? 'Mark done' : 'Open again'"
            @click="toggle(it)"
          >
            <Check :size="14" />
          </button>

          <div class="min-w-0 flex-1 space-y-1">
            <p class="text-xs font-semibold text-fg leading-tight truncate" :title="it.text">
              {{ it.text }}
            </p>
            <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
              <!-- Relative due badge -->
              <span
                class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] border leading-none"
                :class="relativeDue(it.due_date).badgeClass"
              >
                <CalendarClock :size="10" />
                <span>{{ relativeDue(it.due_date).label }}</span>
              </span>

              <!-- Owner initials chip -->
              <span
                v-if="it.owner"
                class="inline-flex items-center gap-1 rounded-full bg-surface-2 px-1.5 py-0.2 text-[10px] font-medium text-fg border border-line"
                :title="it.owner"
              >
                <span class="size-3.5 rounded-full bg-accent/20 text-accent font-mono text-[8px] font-bold inline-flex items-center justify-center">
                  {{ getInitials(it.owner) }}
                </span>
                <span class="truncate max-w-[70px]">{{ it.owner }}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Mobile Add Form Toggle Button -->
    <div class="sm:hidden flex items-center justify-between">
      <button
        type="button"
        class="btn btn-sm btn-primary min-h-[40px] px-3.5 w-full justify-between"
        @click="formOpen = !formOpen"
      >
        <span class="flex items-center gap-1.5">
          <Plus :size="14" />
          <span>{{ formOpen ? "Close Add Form" : "+ Add log item" }}</span>
        </span>
        <ChevronDown :size="14" class="transition-transform duration-200" :class="formOpen && 'rotate-180'" />
      </button>
    </div>

    <!-- Add Form (Always visible on desktop, toggleable on mobile) -->
    <form
      class="card gap-2.5 p-3.5 transition-all"
      :class="[!formOpen ? 'hidden sm:grid' : 'grid', 'sm:grid-cols-[8rem_1fr_7.5rem_8.5rem_auto] sm:items-end']"
      @submit.prevent="add"
    >
      <label class="block">
        <span class="label text-xs">Type</span>
        <select v-model="form.kind" class="input text-xs sm:text-sm min-h-[40px]">
          <option v-for="k in KINDS" :key="k.kind" :value="k.kind">
            {{ k.label.replace(/s$/, "") }}
          </option>
        </select>
      </label>

      <label class="block min-w-0">
        <span class="label text-xs">What</span>
        <input
          v-model="form.text"
          required
          minlength="3"
          maxlength="600"
          class="input text-xs sm:text-sm min-h-[40px]"
          placeholder="e.g. Site visit Kluang / Approved layout"
        />
      </label>

      <label class="block">
        <span class="label text-xs">Who</span>
        <input
          v-model="form.owner"
          maxlength="80"
          class="input text-xs sm:text-sm min-h-[40px]"
          placeholder="e.g. Irfan / MARDI"
        />
      </label>

      <label class="block">
        <span class="label text-xs">Due</span>
        <input
          v-model="form.due_date"
          type="date"
          class="input text-xs sm:text-sm min-h-[40px]"
        />
      </label>

      <button
        type="submit"
        class="btn btn-primary btn-sm min-h-[40px] px-4 font-semibold"
        :disabled="form.text.trim().length < 3"
      >
        <Plus :size="14" />
        <span>Add</span>
      </button>
    </form>

    <!-- Error Alert -->
    <p v-if="error" class="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger font-medium" role="alert">
      {{ error }}
    </p>

    <!-- Filter & Options Controls -->
    <div class="flex items-center justify-between border-b border-line pb-2 text-xs">
      <label class="flex items-center gap-2 text-muted hover:text-fg cursor-pointer select-none">
        <input v-model="showDone" type="checkbox" class="accent-accent size-4 rounded" />
        <span>Show done items</span>
      </label>
      <span class="text-[11px] text-faint">
        Actions due soon are notified to Telegram daily
      </span>
    </div>

    <!-- Empty State -->
    <div v-if="!groups.length" class="card p-6 text-center space-y-2 border-dashed">
      <div class="mx-auto flex size-10 items-center justify-center rounded-full bg-surface-2 text-muted">
        <ListTodo :size="20" />
      </div>
      <p class="text-sm font-semibold text-fg">Nothing in the log yet</p>
      <p class="text-xs text-muted max-w-sm mx-auto">
        Add an action or decision above, or send minutes to the <b>Project Assistant</b> in Chat or Telegram.
      </p>
    </div>

    <!-- Log Groups -->
    <section v-for="g in groups" :key="g.kind" class="space-y-2">
      <!-- Group Header with Coloured Kind Icon & Count Badge -->
      <div class="flex items-center gap-2 pt-1">
        <component :is="KIND_META[g.kind].icon" :size="14" :class="KIND_META[g.kind].color" />
        <h3 class="sign text-fg">{{ g.label }}</h3>
        <span class="chip text-[10px] font-mono py-0 px-1.5 h-4 leading-none">
          {{ g.items.length }}
        </span>
      </div>

      <!-- Item Rows -->
      <div class="space-y-1.5">
        <div
          v-for="e in g.items"
          :key="e.id"
          class="group flex items-start gap-2.5 rounded-lg border border-line bg-surface p-2.5 text-xs sm:text-sm transition-all hover:border-line-strong hover:bg-surface-2/30"
          :class="e.status === 'done' && 'opacity-60 bg-surface/50'"
        >
          <!-- Action & Date: Tick toggle button (Min 40px tap target on mobile) -->
          <button
            v-if="e.kind === 'action' || e.kind === 'date'"
            type="button"
            class="btn btn-ghost btn-sm mt-0.5 size-8 min-w-[32px] sm:size-7 sm:min-w-[28px] rounded-md p-0 transition-colors"
            :class="e.status === 'done' ? 'text-accent hover:bg-accent-soft' : 'text-faint hover:text-accent hover:bg-surface-2'"
            :aria-label="e.status === 'open' ? 'Mark done' : 'Open again'"
            :title="e.status === 'open' ? 'Mark done' : 'Open again'"
            @click="toggle(e)"
          >
            <Check v-if="e.status === 'open'" :size="15" />
            <RotateCcw v-else :size="13" />
          </button>

          <!-- Other kinds: Coloured Kind Icon -->
          <div v-else class="mt-1 shrink-0 p-1">
            <CircleDot :size="13" class="text-faint" />
          </div>

          <!-- Item Text & Metadata -->
          <div class="min-w-0 flex-1 space-y-1">
            <p
              class="text-xs sm:text-sm font-medium text-fg leading-snug break-words"
              :class="e.status === 'done' && 'line-through text-muted'"
            >
              {{ e.text }}
            </p>

            <div class="flex flex-wrap items-center gap-2 text-[11px] text-muted">
              <!-- Owner Initial Badge -->
              <span
                v-if="e.owner"
                class="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-fg border border-line"
              >
                <span class="size-3.5 rounded-full bg-accent/20 text-accent font-mono text-[8px] font-bold inline-flex items-center justify-center">
                  {{ getInitials(e.owner) }}
                </span>
                <span>{{ e.owner }}</span>
              </span>

              <!-- Due Date with relative badge -->
              <span
                v-if="e.due_date"
                class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] border leading-none font-medium"
                :class="[dueClass(e), relativeDue(e.due_date).badgeClass]"
              >
                <CalendarClock :size="11" />
                <span>{{ e.due_date }} ({{ relativeDue(e.due_date).label }})</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

