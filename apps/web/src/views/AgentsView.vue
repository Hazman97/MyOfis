<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { Bot, LoaderCircle, Pause, Pencil, Play, Plus } from "lucide-vue-next";
import { AgentPreferences, dayKey, type Agent, type ProviderPublic, type Runner } from "@agent-office/shared";
import AgentAvatar from "../components/AgentAvatar.vue";
import PageHeader from "../components/PageHeader.vue";
import SidePanel from "../components/SidePanel.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { api, type ToolInfo } from "../api/http.ts";
import { useOffice } from "../stores/office.ts";
import { fmtTokens } from "../format.ts";
import { isOwner } from "../me.ts";
import MoveToRoom from "../components/MoveToRoom.vue";

const office = useOffice();
const providers = ref<ProviderPublic[]>([]);
const runners = ref<Runner[]>([]);
const toolCatalog = ref<ToolInfo[]>([]);
const editing = ref<string | null>(null); // agent id, "new", or null
const error = ref("");
const saving = ref(false);

const firstProvider = () => providers.value.find((p) => p.enabled && p.kind !== "mock") ?? providers.value.find((p) => p.enabled);
const blank = () => ({
  slug: "",
  name: "",
  role: "",
  provider: firstProvider()?.slug ?? "",
  model: firstProvider()?.models[0] ?? "",
  system_prompt: "",
  daily_token_budget: 200000,
  runner_id: null as string | null,
  enabled: true,
  tools: [] as string[],
  permission_level: "safe" as "safe" | "review",
  // config, edited as one entry per line
  shell_allowlist: "",
  read_paths: "",
  http_allowlist: "",
  max_steps: 30,
  max_run_minutes: 20,
  max_run_tokens: 250_000,
  runtime: "ai-sdk" as "ai-sdk" | "opencode",
  self_review: true,
  // set from the agent panel (office); kept as is here
  preferences: AgentPreferences.parse({}) as AgentPreferences,
  // set on the Skills page; kept as is here
  skills: "all" as "all" | string[],
  // TikTok-style agents: clip folder on the runner PC, and posting without approval
  clip_folder: "",
  auto_publish: false,
  auto_publish_daily_max: 3,
});
const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
const form = reactive(blank());

const modelOptions = computed(() => providers.value.find((p) => p.slug === form.provider)?.models ?? []);
const today = () => dayKey(new Date().toISOString());
const toolsByCategory = computed(() => {
  const g = new Map<string, ToolInfo[]>();
  for (const t of toolCatalog.value) g.set(t.category, [...(g.get(t.category) ?? []), t]);
  return [...g.entries()].sort(([a], [b]) => a.localeCompare(b));
});

onMounted(async () => {
  [providers.value, runners.value, toolCatalog.value] = await Promise.all([
    api.providers().then((r) => r.providers),
    // runners are the owner's; members' agents never pin one
    isOwner.value ? api.runners().then((r) => r.runners) : Promise.resolve([]),
    api.tools().then((r) => r.tools),
  ]);
  const hash = location.hash.slice(1);
  const a = hash && office.agents.find((x) => x.slug === hash);
  if (a) edit(a);
});

function edit(a: Agent | null) {
  error.value = "";
  Object.assign(form, blank());
  if (a) {
    Object.assign(form, {
      slug: a.slug,
      name: a.name,
      role: a.role,
      provider: a.provider,
      model: a.model,
      system_prompt: a.system_prompt,
      daily_token_budget: a.daily_token_budget,
      runner_id: a.runner_id,
      enabled: a.enabled,
      tools: [...a.tools],
      permission_level: a.permission_level,
      shell_allowlist: a.config.shell_allowlist.join("\n"),
      read_paths: a.config.read_paths.join("\n"),
      http_allowlist: a.config.http_allowlist.join("\n"),
      max_steps: a.config.max_steps,
      max_run_minutes: a.config.max_run_minutes ?? 20,
      max_run_tokens: a.config.max_run_tokens ?? 250_000,
      runtime: a.config.runtime,
      self_review: a.config.self_review ?? true,
      preferences: AgentPreferences.parse(a.config.preferences ?? {}),
      skills: a.config.skills ?? "all",
      clip_folder: a.config.clip_folder ?? "",
      auto_publish: a.config.auto_publish ?? false,
      auto_publish_daily_max: a.config.auto_publish_daily_max ?? 3,
    });
  }
  editing.value = a?.id ?? "new";
}

async function save() {
  error.value = "";
  saving.value = true;
  try {
    const { shell_allowlist, read_paths, http_allowlist, max_steps, max_run_minutes, max_run_tokens, runtime, self_review, preferences, skills, clip_folder, auto_publish, auto_publish_daily_max, slug, ...rest } = form;
    const body = {
      ...rest,
      config: { shell_allowlist: lines(shell_allowlist), read_paths: lines(read_paths), http_allowlist: lines(http_allowlist), max_steps, max_run_minutes, max_run_tokens, runtime, self_review, preferences, skills, clip_folder: clip_folder.trim(), auto_publish, auto_publish_daily_max },
    };
    if (editing.value === "new") await api.createAgent({ ...body, slug });
    else await api.updateAgent(editing.value!, body);
    await office.loadAgents();
    editing.value = null;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

async function toggle(a: Agent) {
  await api.updateAgent(a.id, { enabled: !a.enabled });
  await office.loadAgents();
}

const tokensToday = (a: Agent) => office.state.agents[a.id]?.tokens_by_day[today()] ?? 0;
const pct = (a: Agent) => (a.daily_token_budget ? Math.min(100, Math.round((tokensToday(a) / a.daily_token_budget) * 100)) : 0);
const activity = (a: Agent) => (a.enabled ? (office.state.agents[a.id]?.activity ?? "idle") : "away");
</script>

<template>
  <div>
    <PageHeader sign="Team" title="Agents" description="Who works in the office, which AI brain they use, and what they may do without asking you.">
      <button class="btn btn-primary shadow-sm" @click="edit(null)"><Plus :size="16" /> New agent</button>
    </PageHeader>

    <div class="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="a in office.agents"
        :key="a.id"
        class="card flex min-w-0 flex-col p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card"
        :class="!a.enabled && 'opacity-65'"
      >
        <div class="flex min-w-0 items-start gap-3">
          <AgentAvatar :name="a.name" :slug="a.slug" :size="42" class="shrink-0 mt-0.5" />
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center justify-between gap-2">
              <h2 class="truncate font-semibold text-base tracking-tight text-fg">{{ a.name }}</h2>
              <StatusBadge :status="activity(a)" />
            </div>
            <p class="truncate text-xs text-muted mt-0.5">{{ a.role || "No role specified" }}</p>
          </div>
        </div>

        <div class="mt-3.5 flex flex-wrap gap-1.5 text-[11px]">
          <span class="chip max-w-full truncate font-mono text-[10px] bg-surface" :title="`${a.provider}:${a.model}`">
            {{ a.provider }}:{{ a.model }}
          </span>
          <span class="chip text-[10px] bg-surface">
            {{ a.config.runtime === "opencode" ? "OpenCode" : `${a.tools.length} tools` }}
          </span>
          <span
            class="chip text-[10px] capitalize"
            :class="a.permission_level === 'review' ? 'border-amber-500/40 bg-amber-500/10 text-amber-500 font-semibold' : 'bg-surface text-muted'"
          >
            {{ a.permission_level }}
          </span>
        </div>

        <!-- Budget bar & counter -->
        <div class="mt-4 mb-4" :title="`${tokensToday(a)} of ${a.daily_token_budget || 'unlimited'} tokens today`">
          <div class="mb-1.5 flex items-center justify-between text-[11px]">
            <span class="text-muted font-medium">Tokens today</span>
            <span class="font-mono tabular-nums text-fg">
              {{ fmtTokens(tokensToday(a)) }}
              <span class="text-faint">/</span>
              <span :class="!a.daily_token_budget ? 'text-accent font-semibold' : 'text-muted'">
                {{ a.daily_token_budget ? fmtTokens(a.daily_token_budget) : "no limit" }}
              </span>
            </span>
          </div>
          <div class="h-1.5 overflow-hidden rounded-full bg-surface-2 border border-line/40">
            <div
              class="h-full rounded-full transition-all duration-300"
              :class="!a.daily_token_budget ? 'bg-accent/40 w-full' : pct(a) > 85 ? 'bg-signal' : 'bg-accent'"
              :style="a.daily_token_budget ? { width: `${pct(a)}%` } : {}"
            />
          </div>
        </div>

        <!-- Card Footer -->
        <div class="mt-auto flex items-center gap-2 border-t border-line pt-3">
          <template v-if="!a.shared">
            <button class="btn btn-sm" @click="toggle(a)">
              <component :is="a.enabled ? Pause : Play" :size="13" /> {{ a.enabled ? "Pause" : "Enable" }}
            </button>
            <button class="btn btn-sm ml-auto" @click="edit(a)"><Pencil :size="13" /> Edit</button>
          </template>
          <span v-else class="chip text-[11px] text-info" title="The owner shared this agent with you: it runs on the owner's AI, within your daily limit">Shared with you</span>
        </div>
        <div v-if="isOwner && !a.shared" class="mt-2"><MoveToRoom kind="agent" :id="a.id" /></div>
      </article>

      <!-- Empty state -->
      <div v-if="!office.agents.length" class="card flex flex-col items-center justify-center border-dashed p-12 text-center text-xs text-muted md:col-span-2 xl:col-span-3">
        <Bot :size="28" class="text-faint mb-2" :stroke-width="1.5" />
        <p class="font-semibold text-sm text-fg">No agents configured</p>
        <p class="mt-1 max-w-sm text-muted">
          Add an agent to start delegating work to your office team.
        </p>
        <button class="btn btn-primary btn-sm mt-4 shadow-sm" @click="edit(null)">
          <Plus :size="14" /> New agent
        </button>
      </div>
    </div>

    <!-- Edit Side Panel -->
    <SidePanel v-if="editing" :sign="editing === 'new' ? 'New agent' : 'Edit agent'" :title="form.name || 'Untitled agent'" wide @close="editing = null">
      <form id="agent-form" class="space-y-6" @submit.prevent="save">
        <!-- Section: Identity -->
        <fieldset class="card p-4 space-y-3.5 bg-surface/70 border-line">
          <legend class="sign text-[10px] tracking-wider text-accent px-1">Identity</legend>
          <div class="grid gap-3 sm:grid-cols-2">
            <div><label class="label" for="ag-name">Name</label><input id="ag-name" v-model="form.name" class="input" required /></div>
            <div>
              <label class="label" for="ag-slug">Slug</label>
              <input id="ag-slug" v-model="form.slug" class="input font-mono" :disabled="editing !== 'new'" pattern="[a-z0-9][a-z0-9\-]*" required />
            </div>
            <div class="sm:col-span-2"><label class="label" for="ag-role">Role</label><input id="ag-role" v-model="form.role" class="input" placeholder="e.g. QA · nightly smoke tests" /></div>
          </div>
        </fieldset>

        <!-- Section: Brain -->
        <fieldset class="card p-4 space-y-3.5 bg-surface/70 border-line">
          <legend class="sign text-[10px] tracking-wider text-accent px-1">Brain</legend>
          <div class="grid gap-3 sm:grid-cols-2">
            <div>
              <label class="label" for="ag-prov">Provider</label>
              <select id="ag-prov" v-model="form.provider" class="input">
                <option v-for="p in providers" :key="p.id" :value="p.slug" :disabled="!p.enabled">{{ p.name }}{{ p.enabled ? "" : " (off)" }}</option>
              </select>
            </div>
            <div>
              <label class="label" for="ag-model">Model</label>
              <input id="ag-model" v-model="form.model" class="input font-mono text-xs" list="model-options" required />
              <datalist id="model-options"><option v-for="m in modelOptions" :key="m" :value="m" /></datalist>
            </div>
            <div>
              <label class="label" for="ag-engine">Engine</label>
              <select id="ag-engine" v-model="form.runtime" class="input">
                <option value="ai-sdk">Agent Office tools</option>
                <option value="opencode">OpenCode (coding in a repo)</option>
              </select>
            </div>
            <div>
              <label class="label" for="ag-runner">Runner</label>
              <select id="ag-runner" v-model="form.runner_id" class="input">
                <option :value="null">Any online runner</option>
                <option v-for="r in runners" :key="r.id" :value="r.id">{{ r.name }}</option>
              </select>
            </div>
          </div>
          <p v-if="form.runtime === 'opencode'" class="rounded-xl border border-info/30 bg-info-soft p-3 text-xs text-info leading-relaxed">
            OpenCode needs <code>npm install -g opencode-ai</code> on the runner and an OpenAI-compatible provider. Agent Office still decides approvals and makes the commit, push and pull request.
          </p>
        </fieldset>

        <!-- Section: Permissions -->
        <fieldset class="card p-4 space-y-3.5 bg-surface/70 border-line">
          <legend class="sign text-[10px] tracking-wider text-accent px-1">Permissions</legend>
          <div class="grid gap-2.5 sm:grid-cols-2">
            <label
              class="flex cursor-pointer gap-2.5 rounded-xl border p-3.5 transition-all"
              :class="form.permission_level === 'safe' ? 'border-accent bg-accent/10 shadow-sm' : 'border-line bg-surface hover:bg-surface-2'"
            >
              <input v-model="form.permission_level" type="radio" value="safe" class="mt-0.5 accent-accent" />
              <span><span class="block text-xs font-semibold text-fg">Safe</span><span class="text-[11px] text-muted">Asks before writing any file.</span></span>
            </label>
            <label
              class="flex cursor-pointer gap-2.5 rounded-xl border p-3.5 transition-all"
              :class="form.permission_level === 'review' ? 'border-accent bg-accent/10 shadow-sm' : 'border-line bg-surface hover:bg-surface-2'"
            >
              <input v-model="form.permission_level" type="radio" value="review" class="mt-0.5 accent-accent" />
              <span><span class="block text-xs font-semibold text-fg">Review</span><span class="text-[11px] text-muted">Writes in its own workspace freely.</span></span>
            </label>
          </div>
          <p class="text-xs text-muted">Dangerous actions (commands outside the allowlist, pushing to main) always ask you.</p>

          <div v-if="form.runtime === 'ai-sdk'" class="pt-2">
            <div class="label">Tools</div>
            <div class="space-y-3 rounded-xl border border-line bg-surface-2/40 p-3.5">
              <div v-for="[cat, tools] in toolsByCategory" :key="cat">
                <div class="sign mb-1 text-[10px] text-accent tracking-wider">{{ cat }}</div>
                <div class="grid gap-1 sm:grid-cols-2">
                  <label v-for="t in tools" :key="t.name" class="flex items-center gap-2 text-xs py-0.5 cursor-pointer" :title="t.description">
                    <input v-model="form.tools" type="checkbox" :value="t.name" class="accent-accent" />
                    <span class="font-mono text-[12px] text-fg">{{ t.name }}</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div class="grid gap-3 sm:grid-cols-2 pt-2">
            <div class="sm:col-span-2">
              <label class="label" for="ag-shell">Shell allowlist · one command prefix per line</label>
              <textarea id="ag-shell" v-model="form.shell_allowlist" class="input min-h-24 font-mono text-xs" placeholder="bun test&#10;npm run build" />
            </div>
            <div>
              <label class="label" for="ag-read">Extra read-only folders</label>
              <textarea id="ag-read" v-model="form.read_paths" class="input min-h-20 font-mono text-xs" />
            </div>
            <div>
              <label class="label" for="ag-http">Web hosts allowed (empty = any)</label>
              <textarea id="ag-http" v-model="form.http_allowlist" class="input min-h-20 font-mono text-xs" placeholder="ekadkahwin.com" />
            </div>
          </div>
        </fieldset>

        <!-- Section: Instructions & limits -->
        <fieldset class="card p-4 space-y-3.5 bg-surface/70 border-line">
          <legend class="sign text-[10px] tracking-wider text-accent px-1">Instructions & limits</legend>
          <div>
            <label class="label" for="ag-prompt">System prompt</label>
            <textarea id="ag-prompt" v-model="form.system_prompt" class="input min-h-56 font-mono text-xs leading-relaxed" />
          </div>
          <div class="grid gap-3 sm:grid-cols-3">
            <div>
              <label class="label" for="ag-budget">Daily token budget · 0 = no limit</label>
              <input id="ag-budget" v-model.number="form.daily_token_budget" type="number" min="0" step="1000" class="input font-mono text-xs" />
              <p class="mt-1 text-[11px] text-faint">When it runs out the agent goes home; its jobs wait until tomorrow (Malaysia time).</p>
            </div>
            <div>
              <label class="label" for="ag-steps">Max steps per run</label>
              <input id="ag-steps" v-model.number="form.max_steps" type="number" min="1" max="200" class="input font-mono text-xs" />
            </div>
            <div>
              <label class="label" for="ag-minutes">Max minutes per run</label>
              <input id="ag-minutes" v-model.number="form.max_run_minutes" type="number" min="1" max="240" class="input font-mono text-xs" />
              <p class="mt-1 text-[11px] text-faint">Stopped after this. Waiting for your approval does not count.</p>
            </div>
            <div>
              <label class="label" for="ag-run-tokens">Max tokens per run</label>
              <input id="ag-run-tokens" v-model.number="form.max_run_tokens" type="number" min="5000" step="10000" class="input font-mono text-xs" />
              <p class="mt-1 text-[11px] text-faint">One job never uses more than this, even if the daily budget allows.</p>
            </div>
            <label class="flex items-center gap-2 self-end pb-2 text-xs font-medium cursor-pointer">
              <input v-model="form.enabled" type="checkbox" class="accent-accent" /> Enabled
            </label>
          </div>

          <div v-if="form.runtime === 'ai-sdk'" class="pt-1">
            <div class="flex flex-col gap-1">
              <label
                for="ag-self-review"
                class="group inline-flex cursor-pointer items-center gap-2.5 select-none"
              >
                <span class="relative inline-flex items-center">
                  <input
                    id="ag-self-review"
                    v-model="form.self_review"
                    type="checkbox"
                    class="peer sr-only"
                  />
                  <div class="h-5 w-9 rounded-full bg-surface-2 border border-line peer-checked:bg-accent peer-checked:border-accent transition-colors duration-200" />
                  <div class="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-fg peer-checked:bg-accent-ink peer-checked:translate-x-4 transition-transform duration-200 shadow-sm" />
                </span>
                <span class="text-xs font-medium text-fg">Learn after work</span>
              </label>
              <p class="text-[11px] text-faint">After a big job or every 5th chat message, the agent looks back and may save a note or propose a skill. Costs a few extra tokens.</p>
            </div>
          </div>

          <!-- clip folder + posting without approval (TikTok agent); owner only -->
          <div v-if="isOwner" class="space-y-4 border-t border-line pt-4">
            <!-- Clip folder sub-section -->
            <div class="space-y-1.5">
              <div class="flex items-center gap-2">
                <svg class="size-4 shrink-0 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 8 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
                </svg>
                <label for="ag-clip-folder" class="label text-xs font-semibold text-fg !mb-0 cursor-pointer">
                  Clip folder (on the runner PC)
                </label>
              </div>
              <input
                id="ag-clip-folder"
                v-model="form.clip_folder"
                class="input font-mono text-xs min-h-10"
                placeholder="C:\MyOfis\tiktok-clips"
              />
              <p class="text-[11px] text-faint leading-relaxed">
                Drop videos here; a <code class="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px] border border-line">music</code> folder inside holds royalty-free songs. Videos the agent may use with the <code class="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px] border border-line">clip_library</code> tool.
              </p>
            </div>

            <!-- Toggle switch for Post without approval -->
            <div class="flex flex-col gap-1 pt-0.5">
              <label
                for="ag-auto-publish"
                class="group inline-flex cursor-pointer items-center gap-2.5 select-none"
              >
                <span class="relative inline-flex items-center">
                  <input
                    id="ag-auto-publish"
                    v-model="form.auto_publish"
                    type="checkbox"
                    class="peer sr-only"
                  />
                  <div class="h-5 w-9 rounded-full bg-surface-2 border border-line peer-checked:bg-accent peer-checked:border-accent transition-colors duration-200" />
                  <div class="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-fg peer-checked:bg-accent-ink peer-checked:translate-x-4 transition-transform duration-200 shadow-sm" />
                </span>
                <span class="text-xs font-medium text-fg">Post without approval</span>
              </label>
            </div>

            <!-- Warning box when auto_publish is on -->
            <div
              v-if="form.auto_publish"
              class="space-y-3 rounded-xl border border-signal/40 bg-signal-soft/30 p-3.5 text-xs text-signal transition-all duration-200"
              role="alert"
            >
              <div class="flex items-start gap-2.5">
                <svg class="size-4 shrink-0 text-signal mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <div class="space-y-1 leading-relaxed">
                  <p class="font-semibold text-fg">Posts go live automatically</p>
                  <p class="text-[11px] text-signal/90 leading-relaxed">
                    Drafts this agent saves go out straight away (website / connected social accounts). You get a Telegram message after each post.
                  </p>
                </div>
              </div>

              <!-- Daily max number stepper (1–15) -->
              <div class="flex flex-wrap items-center justify-between gap-3 pt-2.5 border-t border-signal/20">
                <label for="ag-daily-max" class="text-xs font-medium text-fg">
                  Daily max posts (1–15)
                </label>
                <div class="flex items-center gap-1.5">
                  <button
                    type="button"
                    class="btn btn-sm size-10 sm:size-8 p-0 flex items-center justify-center font-bold text-fg rounded-lg bg-surface border border-line shadow-xs hover:bg-surface-2 transition-colors disabled:opacity-40"
                    :disabled="(form.auto_publish_daily_max ?? 3) <= 1"
                    @click="form.auto_publish_daily_max = Math.max(1, (form.auto_publish_daily_max || 3) - 1)"
                    aria-label="Decrease daily max"
                  >
                    -
                  </button>
                  <input
                    id="ag-daily-max"
                    v-model.number="form.auto_publish_daily_max"
                    type="number"
                    min="1"
                    max="15"
                    class="input w-16 h-10 sm:h-8 py-1 text-center font-mono text-xs tabular-nums"
                  />
                  <button
                    type="button"
                    class="btn btn-sm size-10 sm:size-8 p-0 flex items-center justify-center font-bold text-fg rounded-lg bg-surface border border-line shadow-xs hover:bg-surface-2 transition-colors disabled:opacity-40"
                    :disabled="(form.auto_publish_daily_max ?? 3) >= 15"
                    @click="form.auto_publish_daily_max = Math.min(15, (form.auto_publish_daily_max || 3) + 1)"
                    aria-label="Increase daily max"
                  >
                    +
                  </button>
                  <span class="text-[11px] text-faint ml-1">/ day</span>
                </div>
              </div>
            </div>
          </div>
        </fieldset>
      </form>
      <template #footer>
        <p v-if="error" class="min-w-0 flex-1 truncate text-xs text-danger" :title="error">{{ error }}</p>
        <button type="button" class="btn ml-auto" @click="editing = null">Cancel</button>
        <button form="agent-form" class="btn btn-primary shadow-sm" :disabled="saving">
          <LoaderCircle v-if="saving" :size="14" class="motion-safe:animate-spin" />
          Save agent
        </button>
      </template>
    </SidePanel>
  </div>
</template>
