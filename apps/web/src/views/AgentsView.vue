<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { Pause, Pencil, Play, Plus } from "lucide-vue-next";
import { dayKey, type Agent, type ProviderPublic, type Runner } from "@agent-office/shared";
import AgentAvatar from "../components/AgentAvatar.vue";
import PageHeader from "../components/PageHeader.vue";
import SidePanel from "../components/SidePanel.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { api, type ToolInfo } from "../api/http.ts";
import { useOffice } from "../stores/office.ts";
import { fmtTokens } from "../format.ts";

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
  runtime: "ai-sdk" as "ai-sdk" | "opencode",
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
    api.runners().then((r) => r.runners),
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
      runtime: a.config.runtime,
    });
  }
  editing.value = a?.id ?? "new";
}

async function save() {
  error.value = "";
  saving.value = true;
  try {
    const { shell_allowlist, read_paths, http_allowlist, max_steps, runtime, slug, ...rest } = form;
    const body = {
      ...rest,
      config: { shell_allowlist: lines(shell_allowlist), read_paths: lines(read_paths), http_allowlist: lines(http_allowlist), max_steps, runtime },
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
      <button class="btn btn-primary" @click="edit(null)"><Plus :size="16" /> New agent</button>
    </PageHeader>

    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <article v-for="a in office.agents" :key="a.id" class="card flex min-w-0 flex-col p-4" :class="!a.enabled && 'opacity-70'">
        <div class="flex min-w-0 items-start gap-3">
          <AgentAvatar :name="a.name" :slug="a.slug" :size="44" />
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-2">
              <h2 class="truncate font-semibold">{{ a.name }}</h2>
              <StatusBadge :status="activity(a)" />
            </div>
            <p class="truncate text-sm text-muted">{{ a.role || "No role yet" }}</p>
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          <span class="chip max-w-full truncate font-mono" :title="`${a.provider}:${a.model}`">{{ a.provider }}:{{ a.model }}</span>
          <span class="chip">{{ a.config.runtime === "opencode" ? "OpenCode" : `${a.tools.length} tools` }}</span>
          <span class="chip" :class="a.permission_level === 'review' && 'border-review/40 text-review'">{{ a.permission_level }}</span>
        </div>
        <div class="mt-3 mb-4" :title="`${tokensToday(a)} of ${a.daily_token_budget} tokens today`">
          <div class="mb-1 flex justify-between text-[11px] text-faint">
            <span>Tokens today</span>
            <span class="font-mono tabular-nums">{{ fmtTokens(tokensToday(a)) }} / {{ fmtTokens(a.daily_token_budget) }}</span>
          </div>
          <div class="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div class="h-full rounded-full" :class="pct(a) > 85 ? 'bg-signal' : 'bg-accent'" :style="{ width: `${pct(a)}%` }" />
          </div>
        </div>
        <div class="mt-auto flex gap-2 border-t border-line pt-3">
          <button class="btn btn-sm" @click="toggle(a)">
            <component :is="a.enabled ? Pause : Play" :size="13" /> {{ a.enabled ? "Pause" : "Enable" }}
          </button>
          <button class="btn btn-sm ml-auto" @click="edit(a)"><Pencil :size="13" /> Edit</button>
        </div>
      </article>
    </div>

    <SidePanel v-if="editing" :sign="editing === 'new' ? 'New agent' : 'Edit agent'" :title="form.name || 'Untitled agent'" wide @close="editing = null">
      <form id="agent-form" class="space-y-6" @submit.prevent="save">
        <fieldset class="space-y-3">
          <legend class="sign mb-1">Identity</legend>
          <div class="grid gap-3 sm:grid-cols-2">
            <div><label class="label" for="ag-name">Name</label><input id="ag-name" v-model="form.name" class="input" required /></div>
            <div>
              <label class="label" for="ag-slug">Slug</label>
              <input id="ag-slug" v-model="form.slug" class="input font-mono" :disabled="editing !== 'new'" pattern="[a-z0-9][a-z0-9\-]*" required />
            </div>
            <div class="sm:col-span-2"><label class="label" for="ag-role">Role</label><input id="ag-role" v-model="form.role" class="input" placeholder="e.g. QA · nightly smoke tests" /></div>
          </div>
        </fieldset>

        <fieldset class="space-y-3">
          <legend class="sign mb-1">Brain</legend>
          <div class="grid gap-3 sm:grid-cols-2">
            <div>
              <label class="label" for="ag-prov">Provider</label>
              <select id="ag-prov" v-model="form.provider" class="input">
                <option v-for="p in providers" :key="p.id" :value="p.slug" :disabled="!p.enabled">{{ p.name }}{{ p.enabled ? "" : " (off)" }}</option>
              </select>
            </div>
            <div>
              <label class="label" for="ag-model">Model</label>
              <input id="ag-model" v-model="form.model" class="input font-mono" list="model-options" required />
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
          <p v-if="form.runtime === 'opencode'" class="rounded-md bg-info-soft px-3 py-2 text-xs text-info">
            OpenCode needs <code>npm install -g opencode-ai</code> on the runner and an OpenAI-compatible provider. Agent Office still decides approvals and makes the commit, push and pull request.
          </p>
        </fieldset>

        <fieldset class="space-y-3">
          <legend class="sign mb-1">Permissions</legend>
          <div class="grid gap-2 sm:grid-cols-2">
            <label class="flex cursor-pointer gap-2.5 rounded-lg border p-3" :class="form.permission_level === 'safe' ? 'border-accent bg-accent-soft' : 'border-line'">
              <input v-model="form.permission_level" type="radio" value="safe" class="mt-0.5 accent-accent" />
              <span><span class="block text-sm font-medium">Safe</span><span class="text-xs text-muted">Asks before writing any file.</span></span>
            </label>
            <label class="flex cursor-pointer gap-2.5 rounded-lg border p-3" :class="form.permission_level === 'review' ? 'border-accent bg-accent-soft' : 'border-line'">
              <input v-model="form.permission_level" type="radio" value="review" class="mt-0.5 accent-accent" />
              <span><span class="block text-sm font-medium">Review</span><span class="text-xs text-muted">Writes in its own workspace freely.</span></span>
            </label>
          </div>
          <p class="text-xs text-muted">Dangerous actions (commands outside the allowlist, pushing to main) always ask you.</p>
          <div v-if="form.runtime === 'ai-sdk'">
            <div class="label">Tools</div>
            <div class="space-y-3 rounded-lg border border-line p-3">
              <div v-for="[cat, tools] in toolsByCategory" :key="cat">
                <div class="sign mb-1">{{ cat }}</div>
                <div class="grid gap-1 sm:grid-cols-2">
                  <label v-for="t in tools" :key="t.name" class="flex items-center gap-2 text-sm" :title="t.description">
                    <input v-model="form.tools" type="checkbox" :value="t.name" class="accent-accent" />
                    <span class="font-mono text-[13px]">{{ t.name }}</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
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

        <fieldset class="space-y-3">
          <legend class="sign mb-1">Instructions & limits</legend>
          <div>
            <label class="label" for="ag-prompt">System prompt</label>
            <textarea id="ag-prompt" v-model="form.system_prompt" class="input min-h-56 font-mono text-xs leading-relaxed" />
          </div>
          <div class="grid gap-3 sm:grid-cols-3">
            <div><label class="label" for="ag-budget">Daily token budget</label><input id="ag-budget" v-model.number="form.daily_token_budget" type="number" min="0" step="1000" class="input font-mono" /></div>
            <div><label class="label" for="ag-steps">Max steps per run</label><input id="ag-steps" v-model.number="form.max_steps" type="number" min="1" max="200" class="input font-mono" /></div>
            <label class="flex items-center gap-2 self-end pb-2 text-sm"><input v-model="form.enabled" type="checkbox" class="accent-accent" /> Enabled</label>
          </div>
        </fieldset>
      </form>
      <template #footer>
        <p v-if="error" class="min-w-0 flex-1 truncate text-sm text-danger" :title="error">{{ error }}</p>
        <button type="button" class="btn ml-auto" @click="editing = null">Cancel</button>
        <button form="agent-form" class="btn btn-primary" :disabled="saving">Save agent</button>
      </template>
    </SidePanel>
  </div>
</template>
