<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Boxes, Database, ExternalLink, GitFork, Layers, Network, ShieldCheck, Sparkles, Workflow, Wrench, Zap } from "lucide-vue-next";
import type { Agent } from "@agent-office/shared";
import PageHeader from "../components/PageHeader.vue";
import MermaidDiagram from "../components/MermaidDiagram.vue";
import { api, type SystemInfo, type ToolInfo } from "../api/http.ts";

/**
 * The whole system on one page (owner request): what it is made of, how the parts talk, the
 * database, the agents and tools, and the main flows. Everything comes from GET /api/system,
 * /api/agents and /api/tools, so the page follows the code.
 */
const info = ref<SystemInfo | null>(null);
const agents = ref<Agent[]>([]);
const tools = ref<ToolInfo[]>([]);
const error = ref("");
const fullErd = ref(false);

onMounted(async () => {
  try {
    [info.value, agents.value, tools.value] = await Promise.all([api.system(), api.agents().then((r) => r.agents), api.tools().then((r) => r.tools)]);
  } catch (e) {
    error.value = (e as Error).message;
  }
});

const overview = computed(() => {
  const c = info.value?.counts ?? {};
  return [
    { label: "Agents", value: `${c.agents_enabled ?? 0}/${c.agents ?? 0}`, hint: "enabled / total" },
    { label: "Tools", value: c.tools, hint: `${c.tool_categories} categories` },
    { label: "Event types", value: c.event_types, hint: `${(c.events ?? 0).toLocaleString("en")} events so far` },
    { label: "Tables", value: c.tables, hint: "SQLite" },
    { label: "Runs", value: c.runs, hint: `${c.jobs} jobs` },
    { label: "Drafts", value: c.drafts, hint: `${c.projects} projects` },
    { label: "Runners", value: `${c.runners_online ?? 0}/${c.runners ?? 0}`, hint: "online / paired" },
    { label: "Files", value: `${c.upload_mb ?? 0} MB`, hint: `${c.uploads} photos & videos` },
  ];
});

const ARCHITECTURE = `flowchart LR
  owner(["Owner<br/>phone / PC"])
  tg["Telegram bot"]
  web["Web app<br/>Vue 3 + Phaser office"]
  cf["Cloudflare Tunnel + Access<br/>myofis.bijokdev.com"]
  subgraph HUB["Hub · Bun + Hono · :8788"]
    api["HTTP API + WebSocket"]
    store[("SQLite · Drizzle<br/>append-only events")]
    reducer["Shared reducer<br/>→ office state"]
    sched["Scheduler · budgets<br/>approvals · backups"]
    pub["Publisher · Social<br/>uploads · web search"]
  end
  subgraph RUN["Runner · Bun daemon · 1..n PCs"]
    rt["Runtimes<br/>AI SDK · OpenCode"]
    tools["Tools via runTool()<br/>validate → risk → approval"]
    ff["ffmpeg (NVENC)<br/>Playwright worker"]
  end
  llm["LLM providers<br/>canopy-ai · OpenRouter · Ollama…"]
  sites["Own websites<br/>SmashPoint Worker"]
  meta["Facebook · Instagram · Threads"]
  owner --> web --> cf --> api
  owner <--> tg <--> api
  api <--> store --> reducer
  api --- sched
  api --- pub
  api <-->|"WebSocket, sequenced"| rt
  rt --> tools --> ff
  rt --> llm
  pub -->|"HMAC-signed"| sites
  pub --> meta`;

const FLOWS = `flowchart TD
  a["Owner: chat / Telegram<br/>text + photos + videos"] --> j["Job (queued)"]
  s["Schedule (cron)"] --> j
  e["Event: merged PR"] --> j
  j --> r["Run on a runner"]
  r --> t{"Tool call"}
  t -->|safe| x["Execute"]
  t -->|risky| ap["Approval<br/>web / Telegram"] --> x
  x --> c["Consult colleagues<br/>consult_team / Ketua"]
  x --> d["Draft<br/>post · caption · video"]
  x --> rep["Report → Telegram"]
  d --> o{"Owner"}
  o -->|approve| p["Publish: website / Facebook /<br/>Instagram / Threads"]
  o -->|edit| d
  o -->|reject| f["Feedback → memory / skills"]
  r --> l["Background review:<br/>save memory, propose skill"]`;

const erd = computed(() => {
  const s = info.value?.schema ?? [];
  const fkCols = new Set(s.flatMap((t) => t.foreign_keys.flatMap((f) => f.columns.map((c) => `${t.name}.${c}`))));
  const lines = ["erDiagram"];
  for (const t of s) {
    const cols = t.columns.filter((c) => fullErd.value || c.primary || fkCols.has(`${t.name}.${c.name}`));
    lines.push(`  ${t.name} {`);
    for (const c of cols) lines.push(`    ${c.type.replace(/\W/g, "_")} ${c.name}${c.primary ? " PK" : fkCols.has(`${t.name}.${c.name}`) ? " FK" : ""}`);
    if (!cols.length) lines.push(`    text ${t.columns[0]?.name ?? "id"}`);
    lines.push("  }");
  }
  for (const t of s) for (const f of t.foreign_keys) lines.push(`  ${f.table} ||--o{ ${t.name} : "${f.columns.join(", ")}"`);
  return lines.join("\n");
});

const stack = computed(() => {
  const all: Record<string, string> = {};
  for (const v of info.value?.versions ?? []) Object.assign(all, v.deps);
  const pick = (names: string[]) => names.filter((n) => all[n]).map((n) => ({ name: n, version: all[n]! }));
  return [
    { layer: "Runtime", items: [{ name: "Bun", version: info.value?.runtime.bun ?? "" }, ...pick(["typescript"])] },
    { layer: "Hub (server)", items: pick(["hono", "drizzle-orm", "zod", "jose", "croner", "yaml"]) },
    { layer: "AI / agents", items: pick(["ai", "@ai-sdk/anthropic", "@ai-sdk/openai", "@ai-sdk/google", "@ai-sdk/openai-compatible"]) },
    { layer: "Web app", items: pick(["vue", "vue-router", "pinia", "tailwindcss", "vite", "lucide-vue-next", "mermaid"]) },
    { layer: "Office", items: pick(["phaser", "easystarjs"]) },
    { layer: "Checks", items: pick(["playwright", "pixelmatch"]) },
  ].filter((g) => g.items.length);
});

const toolsByCategory = computed(() => {
  const g = new Map<string, ToolInfo[]>();
  for (const t of tools.value) g.set(t.category, [...(g.get(t.category) ?? []), t]);
  return [...g.entries()].sort((a, b) => b[1].length - a[1].length);
});

const eventGroups = computed(() => {
  const g = new Map<string, string[]>();
  for (const e of info.value?.event_types ?? []) {
    const k = e.split(".")[0]!;
    g.set(k, [...(g.get(k) ?? []), e]);
  }
  return [...g.entries()];
});

const SAFETY = [
  ["Data, not instructions", "Files, web pages, photos, videos and colleagues' answers are DATA. Every prompt says so; memory writes are scanned for injection and secrets."],
  ["Approvals", "Risky tools wait for you (web or Telegram). Nothing goes public until you approve the draft. A global Pause stops everything."],
  ["Workspaces", "One folder per run. Paths outside it and secret files (.env, keys) are blocked."],
  ["No shell", "Commands run as argv with an allowlist and a scrubbed environment; ffmpeg the same way."],
  ["Secrets", "Encrypted at rest (AES-256-GCM), kept in runner memory only, redacted from events. Website and social tokens never leave the hub."],
  ["Login", "Cloudflare Access (your email only); Telegram obeys only your chat id. Websites are called with HMAC-signed requests."],
  ["Git", "Push and pull requests are done by code, never decided by the AI."],
];
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <PageHeader sign="System" title="How MyOfis works" description="The whole system on one page, read live from the running code: what it is made of, how the parts talk, the database, agents, tools and the main flows.">
      <RouterLink to="/manual" class="btn btn-sm">Manual</RouterLink>
      <a href="/aitext" target="_blank" rel="noopener" class="btn btn-sm"><ExternalLink :size="14" /> Text for AI</a>
    </PageHeader>

    <p v-if="error" class="mb-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{{ error }}</p>
    <p v-else-if="!info" class="text-sm text-muted">Loading…</p>

    <template v-if="info">
      <!-- 1. overview -->
      <section id="overview" class="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Overview">
        <div v-for="o in overview" :key="o.label" class="card p-4">
          <div class="sign">{{ o.label }}</div>
          <div class="mt-1 text-2xl font-semibold tabular-nums">{{ o.value }}</div>
          <div class="text-xs text-muted">{{ o.hint }}</div>
        </div>
      </section>

      <!-- 2. architecture -->
      <section id="architecture" class="card mt-5 p-5">
        <h2 class="mb-1 flex items-center gap-2 font-semibold"><Network :size="18" class="text-accent" /> Architecture</h2>
        <p class="mb-4 text-sm text-muted">The hub on your PC is the centre: it stores every event, decides what runs where and holds the secrets. Runners do the work. You reach it through Cloudflare or Telegram.</p>
        <MermaidDiagram :code="ARCHITECTURE" label="Architecture diagram" />
      </section>

      <!-- 3. stack -->
      <section id="stack" class="card mt-5 p-5">
        <h2 class="mb-3 flex items-center gap-2 font-semibold"><Layers :size="18" class="text-accent" /> Stack</h2>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div v-for="g in stack" :key="g.layer">
            <div class="sign mb-1.5">{{ g.layer }}</div>
            <ul class="space-y-1">
              <li v-for="i in g.items" :key="i.name" class="flex justify-between gap-2 text-sm">
                <span class="font-mono text-[13px]">{{ i.name }}</span><span class="text-muted tabular-nums">{{ i.version }}</span>
              </li>
            </ul>
          </div>
        </div>
        <p class="mt-4 text-xs text-muted">
          Bun workspaces: <code>apps/hub</code> · <code>apps/runner</code> · <code>apps/web</code> · <code>packages/shared</code> (schemas + pure reducer) · <code>packages/tools</code> · <code>packages/agents</code>. Runs on {{ info.runtime.platform }}, auth: {{ info.runtime.auth_mode }}.
        </p>
      </section>

      <!-- 4. database -->
      <section id="database" class="card mt-5 p-5">
        <div class="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 class="flex items-center gap-2 font-semibold"><Database :size="18" class="text-accent" /> Database (ERD)</h2>
          <label class="flex cursor-pointer items-center gap-2 text-xs text-muted"><input v-model="fullErd" type="checkbox" class="accent-accent" /> Show every column</label>
        </div>
        <p class="mb-4 text-sm text-muted">
          {{ info.schema.length }} tables in SQLite. <b>events</b> is the source of truth: the office state is rebuilt from it by the same reducer in the hub and the browser.
        </p>
        <MermaidDiagram :code="erd" label="Database entity relationship diagram" />
        <details class="mt-4">
          <summary class="cursor-pointer text-sm font-medium">All tables and columns</summary>
          <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div v-for="t in info.schema" :key="t.name" class="rounded-lg border border-line p-3">
              <div class="font-mono text-sm font-semibold">{{ t.name }}</div>
              <p v-if="t.note" class="text-xs text-muted">{{ t.note }}</p>
              <ul class="mt-1.5 space-y-0.5">
                <li v-for="c in t.columns" :key="c.name" class="flex justify-between gap-2 font-mono text-[12px]">
                  <span :class="c.primary && 'text-accent'">{{ c.name }}{{ c.primary ? " (PK)" : "" }}</span><span class="text-muted">{{ c.type }}{{ c.not_null ? "" : "?" }}</span>
                </li>
              </ul>
              <p v-for="f in t.foreign_keys" :key="f.columns.join()" class="mt-1 text-[11px] text-info">{{ f.columns.join(", ") }} → {{ f.table }}</p>
            </div>
          </div>
        </details>
      </section>

      <!-- 5. agents -->
      <section id="agents" class="card mt-5 p-5">
        <h2 class="mb-3 flex items-center gap-2 font-semibold"><Sparkles :size="18" class="text-accent" /> Agents</h2>
        <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <RouterLink v-for="a in agents" :key="a.id" to="/agents" class="rounded-lg border border-line p-3 transition-colors hover:bg-surface-2" :class="!a.enabled && 'opacity-50'">
            <div class="flex items-center justify-between gap-2">
              <span class="font-medium">{{ a.name }}</span><span class="chip text-[10px]">{{ a.tools.length }} tools</span>
            </div>
            <p class="line-clamp-2 text-xs text-muted">{{ a.role }}</p>
            <p class="mt-1 font-mono text-[11px] text-faint">{{ a.provider }} · {{ a.model }}</p>
          </RouterLink>
        </div>
      </section>

      <!-- 6. tools -->
      <section id="tools" class="card mt-5 p-5">
        <h2 class="mb-1 flex items-center gap-2 font-semibold"><Wrench :size="18" class="text-accent" /> Tools</h2>
        <p class="mb-3 text-sm text-muted">Every tool call goes through runTool(): check the input → decide the risk → ask you if needed → run → record events. Hover a tool for what it does.</p>
        <div class="space-y-3">
          <div v-for="[cat, list] in toolsByCategory" :key="cat">
            <div class="sign mb-1">{{ cat }} · {{ list.length }}</div>
            <div class="flex flex-wrap gap-1.5">
              <span v-for="t in list" :key="t.name" class="chip font-mono text-[11px]" :title="t.description">{{ t.name }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 7. events -->
      <section id="events" class="card mt-5 p-5">
        <h2 class="mb-1 flex items-center gap-2 font-semibold"><Zap :size="18" class="text-accent" /> Events</h2>
        <p class="mb-3 text-sm text-muted">Everything that happens is an event. The office, the board, replay and Telegram all read them.</p>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div v-for="[group, list] in eventGroups" :key="group">
            <div class="sign mb-1">{{ group }}</div>
            <div class="flex flex-wrap gap-1.5"><span v-for="e in list" :key="e" class="chip font-mono text-[11px]">{{ e }}</span></div>
          </div>
        </div>
      </section>

      <!-- 8. flows -->
      <section id="flows" class="card mt-5 p-5">
        <h2 class="mb-1 flex items-center gap-2 font-semibold"><Workflow :size="18" class="text-accent" /> Main flow</h2>
        <p class="mb-4 text-sm text-muted">From your message to something published.</p>
        <MermaidDiagram :code="FLOWS" label="Main work flow diagram" />
      </section>

      <!-- 9. integrations -->
      <section id="integrations" class="card mt-5 p-5">
        <h2 class="mb-3 flex items-center gap-2 font-semibold"><GitFork :size="18" class="text-accent" /> Connected</h2>
        <div class="flex flex-wrap gap-2 text-sm">
          <span class="chip" :class="info.integrations.telegram ? 'text-accent' : 'text-muted'">Telegram {{ info.integrations.telegram ? "✓" : "✗" }}</span>
          <span class="chip" :class="info.integrations.gitea ? 'text-accent' : 'text-muted'">Gitea {{ info.integrations.gitea ? "✓" : "✗" }}</span>
          <span class="chip text-accent">Web search: {{ info.integrations.web_search }}</span>
          <span v-for="w in info.integrations.websites" :key="w" class="chip text-accent">Website: {{ w }}</span>
          <span v-for="(list, project) in info.integrations.social" :key="project" class="chip text-accent">{{ project }}: {{ list.join(", ") }}</span>
          <span class="chip">{{ info.integrations.backups }} backups</span>
        </div>
      </section>

      <!-- 10. safety -->
      <section id="safety" class="card mt-5 p-5">
        <h2 class="mb-3 flex items-center gap-2 font-semibold"><ShieldCheck :size="18" class="text-accent" /> Safety</h2>
        <dl class="grid gap-3 sm:grid-cols-2">
          <div v-for="[t, d] in SAFETY" :key="t">
            <dt class="text-sm font-medium">{{ t }}</dt>
            <dd class="text-xs text-muted">{{ d }}</dd>
          </div>
        </dl>
      </section>

      <p class="mt-5 mb-8 flex items-center gap-1.5 text-xs text-faint"><Boxes :size="13" /> Read from the running hub at {{ new Date(info.generated_at).toLocaleString("en-MY") }}.</p>
    </template>
  </div>
</template>
