<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { MemoryOp } from "@agent-office/shared";
import PageHeader from "../components/PageHeader.vue";
import AgentAvatar from "../components/AgentAvatar.vue";
import SkillCatalog from "../components/SkillCatalog.vue";
import SkillAgents from "../components/SkillAgents.vue";
import AgentSkillsMatrix from "../components/AgentSkillsMatrix.vue";
import { api, type Proposal, type Skill, type SkillAssignments } from "../api/http.ts";
import { compactDiff, lineDiff } from "../diff.ts";
import { useOffice } from "../stores/office.ts";
import { fmtTime } from "../format.ts";
import { isOwner } from "../me.ts";
import { AlertTriangle, BookOpen, ChevronRight, Clock, Sparkles, Trash2, Upload } from "lucide-vue-next";

/**
 * Hermes-style learning, owner side: agents propose skills (SKILL.md) and, when write
 * approval is on, memory changes. Nothing lands until the owner approves it here.
 */
const office = useOffice();
const tab = ref<"inbox" | "skills" | "history" | "browse">("inbox");
const proposals = ref<Proposal[]>([]);
const skills = ref<Skill[]>([]);
const writeApproval = ref(false);
const error = ref("");
const busy = ref<string | null>(null);
const open = ref<string | null>(null); // skill name shown in full
const importText = ref("");
const importOpen = ref(false);
const assignments = ref<SkillAssignments | null>(null);

const pending = computed(() => proposals.value.filter((p) => p.status === "pending"));
const decided = computed(() => proposals.value.filter((p) => p.status !== "pending"));
const agentName = (id: string) => office.agentById[id]?.name ?? "Agent";

async function loadAssignments() {
  if (!isOwner.value) return;
  try {
    assignments.value = await api.skillAssignments();
  } catch (e) {
    console.warn("Failed to load skill assignments", e);
  }
}

async function load() {
  error.value = "";
  try {
    const [p, s, m] = await Promise.all([api.proposals(), api.skills(), api.memorySettings()]);
    proposals.value = p.proposals;
    skills.value = s.skills;
    writeApproval.value = m.write_approval;
    await loadAssignments();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
// live: a new proposal or a decision made elsewhere (e.g. another tab)
watch(() => Object.keys(office.state.pending_skills ?? {}).join(","), load);

async function run(key: string, fn: () => Promise<unknown>) {
  error.value = "";
  busy.value = key;
  try {
    await fn();
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = null;
  }
}

const decide = (p: Proposal, decision: "approve" | "reject") => run(p.id, () => api.decideProposal(p.id, decision));
const removeSkill = (name: string) => run(`skill:${name}`, () => api.deleteSkill(name));
const toggleApproval = () => run("approval", () => api.setMemoryApproval(!writeApproval.value));
const importSkill = () =>
  run("import", async () => {
    await api.importSkill(importText.value);
    importText.value = "";
    importOpen.value = false;
    tab.value = "skills";
  });

/** What the proposal changes, ready to render. */
function changeOf(p: Proposal) {
  if (p.kind === "memory") {
    try {
      const ops = MemoryOp.array().parse(JSON.parse(p.content));
      return { type: "ops" as const, ops };
    } catch {
      return { type: "text" as const, text: p.content };
    }
  }
  if (p.action === "delete") return { type: "text" as const, text: p.previous ?? "" };
  if (p.action === "patch" && p.previous) return { type: "diff" as const, lines: compactDiff(lineDiff(p.previous, p.content)) };
  return { type: "text" as const, text: p.content };
}

const title = (p: Proposal) =>
  p.kind === "memory"
    ? `Memory change (${p.name === "user" ? "about you" : "own notes"})`
    : `${p.action === "create" ? "New skill" : p.action === "patch" ? "Improve skill" : "Delete skill"}: ${p.name}`;
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <PageHeader
      sign="Library"
      title="Skills"
      description="Procedures your agents learned (SKILL.md, the format Hermes Agent uses). Agents propose new skills and improvements; nothing is saved until you approve it."
    >
      <button class="btn btn-primary btn-sm shadow-sm inline-flex items-center gap-1.5" @click="importOpen = !importOpen">
        <Upload :size="14" />
        <span>Import SKILL.md</span>
      </button>
    </PageHeader>

    <p v-if="error" class="mb-3 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-xs font-medium text-danger" role="alert">{{ error }}</p>

    <!-- Import Form / Paste Box -->
    <form v-if="importOpen" class="card mb-4 space-y-3 p-4 bg-surface/80 border-line shadow-card" @submit.prevent="importSkill">
      <div class="flex items-center justify-between">
        <label for="sk-import" class="text-xs font-semibold text-fg tracking-tight">Paste a SKILL.md</label>
        <span class="sign text-[10px] text-accent tracking-wider">Hermes Format</span>
      </div>
      <p class="text-xs text-muted leading-relaxed">
        It must start with frontmatter: <code class="font-mono text-fg bg-surface px-1.5 py-0.5 rounded border border-line text-[11px]">name</code> (lowercase-with-dashes) and <code class="font-mono text-fg bg-surface px-1.5 py-0.5 rounded border border-line text-[11px]">description</code> (when to use it). A skill with the same name is replaced.
      </p>
      <textarea
        id="sk-import"
        v-model="importText"
        class="input min-h-52 font-mono text-xs bg-sunken/80 border-line focus:bg-surface leading-relaxed p-3.5 shadow-inner"
        placeholder="---&#10;name: my-skill&#10;description: When to use this skill&#10;---&#10;&#10;## Procedure&#10;1. …"
      />
      <div class="flex items-center justify-end gap-2 pt-1">
        <button type="button" class="btn btn-sm" @click="importOpen = false">Cancel</button>
        <button type="submit" class="btn btn-primary btn-sm shadow-sm" :disabled="importText.trim().length < 10 || busy === 'import'">Save skill</button>
      </div>
    </form>

    <!-- Tabs and Memory Approval Switch -->
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div class="inline-flex rounded-xl border border-line bg-surface-2/60 p-1" role="tablist" aria-label="Skills view">
        <button
          v-for="t in [
            { id: 'inbox', label: 'Waiting' },
            { id: 'skills', label: 'Skills' },
            { id: 'history', label: 'History' },
            { id: 'browse', label: 'Browse' },
          ] as const"
          :key="t.id"
          role="tab"
          class="inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all duration-150"
          :class="tab === t.id ? 'bg-accent text-accent-ink shadow-sm' : 'text-muted hover:text-fg hover:bg-surface-2'"
          :aria-selected="tab === t.id"
          @click="tab = t.id"
        >
          {{ t.label }}
          <span
            v-if="t.id === 'inbox' && pending.length"
            class="rounded-full px-1.5 font-mono text-[10px] leading-4 font-bold"
            :class="tab === t.id ? 'bg-black/20 text-accent-ink' : 'bg-signal text-white'"
          >
            {{ pending.length }}
          </span>
          <span
            v-if="t.id === 'skills'"
            class="font-mono text-[10px] rounded-full px-1.5 leading-4"
            :class="tab === t.id ? 'bg-black/15 text-accent-ink' : 'text-faint bg-surface/50'"
          >
            {{ skills.length }}
          </span>
        </button>
      </div>

      <!-- Styled Switch -->
      <div class="flex flex-col gap-1 sm:items-end">
        <label
          class="group inline-flex cursor-pointer items-center gap-2.5 select-none"
          :class="busy === 'approval' ? 'opacity-50 pointer-events-none' : ''"
        >
          <span class="relative inline-flex items-center">
            <input
              type="checkbox"
              class="peer sr-only"
              :checked="writeApproval"
              :disabled="busy === 'approval'"
              @change="toggleApproval"
            />
            <div class="h-5 w-9 rounded-full bg-surface-2 border border-line peer-checked:bg-accent peer-checked:border-accent transition-colors duration-200" />
            <div class="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-fg peer-checked:bg-accent-ink peer-checked:translate-x-4 transition-transform duration-200 shadow-sm" />
          </span>
          <span class="text-xs font-medium text-fg">Ask me before agents change their memory</span>
        </label>
        <p class="text-[11px] text-faint">Off: agents save notes right away. On: you approve each change here.</p>
      </div>
    </div>

    <!-- Waiting / History: proposals -->
    <div v-if="tab === 'inbox' || tab === 'history'" class="space-y-3">
      <article
        v-for="p in tab === 'inbox' ? pending : decided"
        :key="p.id"
        class="card p-4 transition-all duration-150"
        :class="p.status !== 'pending' ? 'opacity-85 hover:opacity-100 bg-surface/80' : 'shadow-card'"
      >
        <header class="mb-3 flex flex-wrap items-center gap-2.5">
          <AgentAvatar
            v-if="office.agentById[p.agent_id]"
            :name="office.agentById[p.agent_id]!.name"
            :slug="office.agentById[p.agent_id]!.slug"
            :size="36"
            class="shrink-0"
          />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h4 class="text-sm font-semibold text-fg tracking-tight truncate">{{ title(p) }}</h4>
              <span
                class="chip text-[10px] font-semibold"
                :class="
                  p.kind === 'memory'
                    ? 'border-signal/30 bg-signal-soft text-signal'
                    : p.action === 'create'
                      ? 'border-info/30 bg-info-soft text-info'
                      : p.action === 'patch'
                        ? 'border-accent/40 bg-accent/10 text-accent'
                        : 'border-danger/30 bg-danger-soft text-danger'
                "
              >
                {{
                  p.kind === "memory"
                    ? "Memory change"
                    : p.action === "create"
                      ? "New skill"
                      : p.action === "patch"
                        ? "Improve skill"
                        : "Delete skill"
                }}
              </span>
            </div>
            <div class="text-[11px] text-muted mt-0.5">
              <span>{{ agentName(p.agent_id) }}</span>
              <span class="text-faint"> · </span>
              <span class="font-mono text-faint">{{ fmtTime(p.created_at) }}</span>
            </div>
          </div>
          <span
            v-if="p.status !== 'pending'"
            class="chip text-[10px] font-semibold uppercase shrink-0"
            :class="p.status === 'approved' ? 'border-accent/40 bg-accent/10 text-accent' : 'border-danger/30 bg-danger-soft text-danger'"
          >
            {{ p.status }}
          </span>
        </header>

        <!-- Why quote -->
        <div v-if="p.reason" class="mb-3 border-l-2 border-line pl-3 py-0.5 text-xs text-muted leading-relaxed">
          <span class="font-semibold text-fg/80 not-italic">Why:</span> {{ p.reason }}
        </div>

        <!-- Warnings in amber -->
        <ul v-if="p.warnings.length" class="mb-3 space-y-1.5">
          <li
            v-for="w in p.warnings"
            :key="w"
            class="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-500 leading-relaxed font-medium"
          >
            <AlertTriangle :size="14" class="shrink-0 mt-0.5" />
            <span>{{ w }}</span>
          </li>
        </ul>

        <p v-if="p.error" class="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-1.5 text-xs text-danger font-medium">
          Could not apply: {{ p.error }}
        </p>

        <!-- Changes: ops / diff / text -->
        <template v-for="c in [changeOf(p)]" :key="c.type">
          <ul v-if="c.type === 'ops'" class="divide-y divide-line rounded-xl border border-line bg-surface-2/40 text-xs overflow-hidden">
            <li v-for="(op, i) in c.ops" :key="i" class="flex flex-wrap items-baseline gap-2 px-3 py-2 leading-relaxed">
              <span
                class="chip text-[10px] font-mono px-1.5 py-0 capitalize"
                :class="
                  op.action === 'add'
                    ? 'border-info/30 bg-info-soft text-info'
                    : op.action === 'patch'
                      ? 'border-accent/40 bg-accent/10 text-accent'
                      : 'border-danger/30 bg-danger-soft text-danger'
                "
              >
                {{ op.action }}
              </span>
              <span v-if="op.action !== 'add'" class="text-danger line-through opacity-80 wrap-break-word">{{ op.old_text }}</span>
              <span v-if="op.action !== 'remove'" class="text-info font-medium wrap-break-word">{{ op.content }}</span>
            </li>
          </ul>
          <pre v-else-if="c.type === 'diff'" class="max-h-96 overflow-auto rounded-xl border border-line bg-surface-2/80 p-3 font-mono text-xs leading-relaxed"><template v-for="(l, i) in c.lines" :key="i"><span v-if="l.kind === 'gap'" class="block py-0.5 text-faint select-none">  ⋯ {{ l.count }} unchanged lines</span><span v-else class="block whitespace-pre-wrap px-1 rounded-sm" :class="l.kind === 'add' ? 'bg-info-soft text-info' : l.kind === 'del' ? 'bg-danger-soft text-danger' : 'text-muted'">{{ l.kind === "add" ? "+ " : l.kind === "del" ? "- " : "  " }}{{ l.text }}</span></template></pre>
          <pre v-else class="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-surface-2/80 p-3 font-mono text-xs leading-relaxed" :class="p.action === 'delete' ? 'line-through opacity-70 bg-danger-soft/20 text-danger' : 'text-fg'">{{ c.text }}</pre>
        </template>

        <footer v-if="p.status === 'pending'" class="mt-3.5 flex items-center justify-between border-t border-line/60 pt-3">
          <button class="btn btn-sm text-danger hover:bg-danger-soft" :disabled="busy === p.id" @click="decide(p, 'reject')">
            Reject
          </button>
          <button class="btn btn-primary btn-sm shadow-sm" :disabled="busy === p.id" @click="decide(p, 'approve')">
            Approve
          </button>
        </footer>
      </article>

      <!-- Empty state: Waiting / History -->
      <div v-if="!(tab === 'inbox' ? pending : decided).length" class="card border-dashed p-12 text-center flex flex-col items-center justify-center">
        <div class="mb-3 flex size-12 items-center justify-center rounded-2xl border border-line bg-surface-2 text-muted shadow-sm">
          <component :is="tab === 'inbox' ? Sparkles : Clock" :size="20" class="text-faint" />
        </div>
        <h3 class="text-sm font-semibold tracking-tight text-fg">{{ tab === "inbox" ? "Nothing waiting" : "No decisions yet" }}</h3>
        <p class="mx-auto mt-1 max-w-sm text-xs text-muted leading-relaxed">
          After a big job or a long chat, agents look back and may propose a skill. It shows up here for you to approve.
        </p>
      </div>
    </div>

    <!-- Popular public skills -->
    <SkillCatalog v-else-if="tab === 'browse'" :installed="skills.map((s) => s.name)" @installed="load" />

    <!-- Skills library -->
    <div v-else class="space-y-4">
      <!-- Skills per agent matrix (collapsible) -->
      <AgentSkillsMatrix
        v-if="isOwner && assignments"
        :assignments="assignments"
        @updated="loadAssignments"
      />

      <div class="space-y-2.5">
        <article v-for="s in skills" :key="s.name" class="card p-4 transition-all">
          <div class="flex items-start gap-3">
            <button
              class="min-w-0 flex-1 text-left flex items-start gap-2.5 group cursor-pointer"
              :aria-expanded="open === s.name"
              @click="open = open === s.name ? null : s.name"
            >
              <ChevronRight
                :size="15"
                class="shrink-0 text-faint transition-transform duration-200 mt-1"
                :class="open === s.name ? 'rotate-90 text-accent' : 'group-hover:text-muted'"
              />
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-mono text-xs font-semibold text-fg tracking-tight group-hover:text-accent transition-colors">
                    {{ s.name }}
                  </span>
                  <span
                    v-if="s.usage?.stale"
                    class="chip border-amber-500/40 bg-amber-500/10 text-amber-500 font-semibold text-[10px]"
                    :title="s.usage.stale"
                  >
                    Stale
                  </span>
                  <span v-if="s.usage?.stale" class="text-[11px] text-amber-500 font-medium">
                    {{ s.usage.stale }}
                  </span>
                </div>
                <div class="text-xs text-muted mt-0.5 leading-relaxed">{{ s.description }}</div>
                <div v-if="s.usage" class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <span>Used in {{ s.usage.runs }} runs</span>
                  <span v-if="s.usage.last_used_at">· last used {{ fmtTime(s.usage.last_used_at) }}</span>
                  <span v-else>· never used</span>
                  <span
                    v-if="s.usage.bad_runs > 0"
                    class="chip border-amber-500/40 bg-amber-500/10 text-amber-500 font-semibold text-[10px] py-0 px-1.5"
                  >
                    {{ s.usage.bad_runs }} went badly
                  </span>
                </div>
              </div>
            </button>
            <button
              class="btn btn-ghost btn-sm size-7 p-0 text-faint hover:text-danger hover:bg-danger-soft opacity-60 hover:opacity-100 transition-all shrink-0"
              :disabled="busy === `skill:${s.name}`"
              :aria-label="`Delete skill ${s.name}`"
              title="Delete skill"
              @click="removeSkill(s.name)"
            >
              <Trash2 :size="13" />
            </button>
          </div>

          <!-- Per-skill agent assignment -->
          <div v-if="isOwner && assignments" class="mt-3.5 pt-3 border-t border-line/60">
            <SkillAgents
              :skill-name="s.name"
              :assignments="assignments"
              @updated="loadAssignments"
            />
          </div>

          <pre
            v-if="open === s.name"
            class="mt-3 max-h-112 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-sunken/80 p-3.5 font-mono text-xs leading-relaxed text-fg shadow-inner"
          >{{ s.content }}</pre>
        </article>
      </div>

      <!-- Empty state: Skills library -->
      <div v-if="!skills.length" class="card border-dashed p-12 text-center flex flex-col items-center justify-center">
        <div class="mb-3 flex size-12 items-center justify-center rounded-2xl border border-line bg-surface-2 text-muted shadow-sm">
          <BookOpen :size="20" class="text-faint" />
        </div>
        <h3 class="text-sm font-semibold tracking-tight text-fg">No skills yet</h3>
        <p class="mx-auto mt-1 max-w-sm text-xs text-muted leading-relaxed">
          Approve one from an agent, or import a SKILL.md (for example from Hermes Agent).
        </p>
      </div>
    </div>
  </div>
</template>
