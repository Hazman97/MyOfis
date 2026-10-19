<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import {
  Activity,
  ArrowRight,
  Bell,
  BookOpen,
  Bot,
  Boxes,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Code2,
  Cpu,
  Database,
  ExternalLink,
  FilePenLine,
  FileText,
  Folder,
  GitBranch,
  GitFork,
  GitPullRequest,
  Globe,
  HardDrive,
  Layers,
  Lock,
  Maximize2,
  MoveHorizontal,
  Network,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  Users,
  Workflow,
  Wrench,
  X,
  Zap,
} from "lucide-vue-next";
import type { Agent } from "@agent-office/shared";
import PageHeader from "../components/PageHeader.vue";
import MermaidDiagram from "../components/MermaidDiagram.vue";
import AgentAvatar from "../components/AgentAvatar.vue";
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
const activeSection = ref("overview");
const selectedTool = ref<ToolInfo | null>(null);
const activeOverlay = ref<{ title: string; code: string; label: string } | null>(null);

const SECTIONS = [
  { id: "overview", label: "Overview", icon: Boxes },
  { id: "architecture", label: "Architecture", icon: Network },
  { id: "stack", label: "Stack", icon: Layers },
  { id: "database", label: "Database", icon: Database },
  { id: "agents", label: "Agents", icon: Sparkles },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "events", label: "Events", icon: Zap },
  { id: "flows", label: "Flow", icon: Workflow },
  { id: "integrations", label: "Connected", icon: GitFork },
  { id: "safety", label: "Safety", icon: ShieldCheck },
];

let observer: IntersectionObserver | null = null;

function setupObserver() {
  observer?.disconnect();
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          activeSection.value = entry.target.id;
        }
      }
    },
    { rootMargin: "-15% 0px -65% 0px" },
  );
  for (const s of SECTIONS) {
    const el = document.getElementById(s.id);
    if (el) observer.observe(el);
  }
}

function scrollTo(id: string) {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: "smooth" });
    activeSection.value = id;
  }
}

function openDiagram(title: string, code: string, label: string) {
  activeOverlay.value = { title, code, label };
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && activeOverlay.value) {
    activeOverlay.value = null;
  }
}

async function loadData() {
  error.value = "";
  try {
    [info.value, agents.value, tools.value] = await Promise.all([
      api.system(),
      api.agents().then((r) => r.agents),
      api.tools().then((r) => r.tools),
    ]);
    await nextTick();
    setupObserver();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

onMounted(() => {
  void loadData();
  window.addEventListener("keydown", handleKeydown);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener("keydown", handleKeydown);
});

const overview = computed(() => {
  const c = info.value?.counts ?? {};
  return [
    { label: "Agents", value: `${c.agents_enabled ?? 0}/${c.agents ?? 0}`, hint: "enabled / total", icon: Bot, color: "text-accent bg-accent/10 border-accent/25" },
    { label: "Tools", value: c.tools, hint: `${c.tool_categories} categories`, icon: Wrench, color: "text-signal bg-signal/10 border-signal/25" },
    { label: "Event types", value: c.event_types, hint: `${(c.events ?? 0).toLocaleString("en")} events so far`, icon: Zap, color: "text-indigo-400 bg-indigo-500/10 border-indigo-500/25" },
    { label: "Tables", value: c.tables, hint: "SQLite", icon: Database, color: "text-info bg-info/10 border-info/25" },
    { label: "Runs", value: c.runs, hint: `${c.jobs} jobs`, icon: Activity, color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25" },
    { label: "Drafts", value: c.drafts, hint: `${c.projects} projects`, icon: FilePenLine, color: "text-sky-400 bg-sky-500/10 border-sky-500/25" },
    { label: "Runners", value: `${c.runners_online ?? 0}/${c.runners ?? 0}`, hint: "online / paired", icon: Server, color: "text-amber-400 bg-amber-500/10 border-amber-500/25" },
    { label: "Files", value: `${c.upload_mb ?? 0} MB`, hint: `${c.uploads} photos & videos`, icon: HardDrive, color: "text-rose-400 bg-rose-500/10 border-rose-500/25" },
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
  pub --> meta
  classDef accent fill:#10b98118,stroke:#10b981,stroke-width:1.5px;
  classDef primary fill:#3b82f618,stroke:#3b82f6,stroke-width:1.5px;
  classDef purple fill:#8b5cf612,stroke:#8b5cf6,stroke-width:1.5px;
  classDef amber fill:#f59e0b12,stroke:#f59e0b,stroke-width:1.5px;
  class owner accent;
  class web,tg primary;
  class HUB purple;
  class RUN amber;`;

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
  r --> l["Background review:<br/>save memory, propose skill"]
  classDef accent fill:#10b98118,stroke:#10b981,stroke-width:1.5px;
  classDef warn fill:#f59e0b18,stroke:#f59e0b,stroke-width:1.5px;
  classDef primary fill:#3b82f618,stroke:#3b82f6,stroke-width:1.5px;
  class a,o accent;
  class t,ap warn;
  class p primary;`;

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
    { layer: "Runtime", icon: Cpu, items: [{ name: "Bun", version: info.value?.runtime.bun ?? "" }, ...pick(["typescript"])] },
    { layer: "Hub (server)", icon: Server, items: pick(["hono", "drizzle-orm", "zod", "jose", "croner", "yaml"]) },
    { layer: "AI / agents", icon: Sparkles, items: pick(["ai", "@ai-sdk/anthropic", "@ai-sdk/openai", "@ai-sdk/google", "@ai-sdk/openai-compatible"]) },
    { layer: "Web app", icon: Globe, items: pick(["vue", "vue-router", "pinia", "tailwindcss", "vite", "lucide-vue-next", "mermaid"]) },
    { layer: "Office", icon: Building2, items: pick(["phaser", "easystarjs"]) },
    { layer: "Checks", icon: CheckCircle2, items: pick(["playwright", "pixelmatch"]) },
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

function toolCategoryIcon(cat: string) {
  switch (cat.toLowerCase()) {
    case "read_docs": return BookOpen;
    case "write": return FilePenLine;
    case "search": return Search;
    case "browser": return Globe;
    case "shell": return Terminal;
    case "git": return GitBranch;
    case "meeting": return Users;
    case "notify": return Bell;
    case "code": return Code2;
    default: return Wrench;
  }
}

function eventGroupIcon(group: string) {
  switch (group.toLowerCase()) {
    case "run": return Activity;
    case "agent": return Bot;
    case "job": return Layers;
    case "approval": return ShieldCheck;
    case "draft": return FilePenLine;
    case "runner": return Server;
    case "schedule": return CalendarClock;
    case "feature": return Sparkles;
    case "budget": return CircleDollarSign;
    default: return Zap;
  }
}

const SAFETY = [
  ["Data, not instructions", "Files, web pages, photos, videos and colleagues' answers are DATA. Every prompt says so; memory writes are scanned for injection and secrets."],
  ["Approvals", "Risky tools wait for you (web or Telegram). Nothing goes public until you approve the draft. A global Pause stops everything."],
  ["Workspaces", "One folder per run. Paths outside it and secret files (.env, keys) are blocked."],
  ["No shell", "Commands run as argv with an allowlist and a scrubbed environment; ffmpeg the same way."],
  ["Secrets", "Encrypted at rest (AES-256-GCM), kept in runner memory only, redacted from events. Website and social tokens never leave the hub."],
  ["Login", "Cloudflare Access (your email only); Telegram obeys only your chat id. Websites are called with HMAC-signed requests."],
  ["Git", "Push and pull requests are done by code, never decided by the AI."],
] as const;

const safetyCards = computed(() => {
  const iconMap: Record<string, any> = {
    "Data, not instructions": FileText,
    "Approvals": CheckCircle2,
    "Workspaces": Folder,
    "No shell": Terminal,
    "Secrets": Lock,
    "Login": ShieldCheck,
    "Git": GitPullRequest,
  };
  return SAFETY.map(([title, desc]) => ({
    title,
    desc,
    icon: iconMap[title] ?? ShieldCheck,
  }));
});
</script>

<template>
  <div class="mx-auto max-w-6xl pb-16 lg:pb-8">
    <PageHeader
      sign="System"
      title="How MyOfis works"
      description="The whole system on one page, read live from the running code: what it is made of, how the parts talk, the database, agents, tools and the main flows."
    >
      <RouterLink to="/manual" class="btn btn-sm min-h-10 inline-flex items-center">Manual</RouterLink>
      <a href="/aitext" target="_blank" rel="noopener" class="btn btn-sm min-h-10 inline-flex items-center gap-1.5"><ExternalLink :size="14" /> Text for AI</a>
    </PageHeader>

    <!-- Error State -->
    <div v-if="error" class="mb-6 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger" role="alert">
      <div class="flex items-center gap-2 font-semibold">
        <ShieldAlert :size="16" />
        Failed to load system information
      </div>
      <p class="mt-1 text-xs opacity-90">{{ error }}</p>
      <button class="btn btn-sm btn-danger mt-3 min-h-10 px-3.5 inline-flex items-center gap-1.5" @click="loadData">
        <RefreshCw :size="13" /> Try again
      </button>
    </div>

    <!-- Skeleton Loading State -->
    <div v-else-if="!info" class="space-y-6">
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div v-for="i in 8" :key="i" class="card p-4 animate-pulse">
          <div class="h-3.5 w-16 bg-surface-2 rounded mb-3" />
          <div class="h-7 w-20 bg-surface-2 rounded mb-2" />
          <div class="h-3 w-24 bg-surface-2 rounded" />
        </div>
      </div>
      <div class="card p-5 animate-pulse">
        <div class="h-5 w-32 bg-surface-2 rounded mb-2" />
        <div class="h-3 w-3/4 bg-surface-2 rounded mb-6" />
        <div class="h-64 bg-surface-2 rounded-xl" />
      </div>
      <div class="card p-5 animate-pulse">
        <div class="h-5 w-24 bg-surface-2 rounded mb-4" />
        <div class="grid gap-4 sm:grid-cols-3">
          <div v-for="i in 3" :key="i" class="h-36 bg-surface-2 rounded-xl" />
        </div>
      </div>
    </div>

    <template v-if="info">
      <!-- Sticky Navigation Bar -->
      <nav
        class="sticky top-13 lg:top-0 z-20 -mx-4 mb-5 border-b border-line bg-surface/90 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 transition-colors"
        aria-label="Section navigation"
      >
        <div class="nav-scroll flex items-center gap-1.5 overflow-x-auto py-0.5">
          <a
            v-for="s in SECTIONS"
            :key="s.id"
            :href="`#${s.id}`"
            class="chip flex shrink-0 items-center gap-1.5 text-xs font-medium min-h-10 px-3.5 py-2 transition-colors cursor-pointer"
            :class="activeSection === s.id ? 'bg-accent/15 text-accent border-accent/40 font-semibold' : 'text-muted hover:text-fg hover:border-line-strong'"
            @click.prevent="scrollTo(s.id)"
          >
            <component :is="s.icon" :size="13" />
            {{ s.label }}
          </a>
        </div>
      </nav>

      <!-- 1. overview -->
      <section id="overview" class="grid grid-cols-2 gap-3 sm:grid-cols-4 scroll-mt-28 lg:scroll-mt-16" aria-label="Overview">
        <div v-for="o in overview" :key="o.label" class="card relative overflow-hidden p-4 transition-all hover:border-line-strong">
          <div class="flex items-center justify-between gap-2">
            <div class="sign">{{ o.label }}</div>
            <span class="flex size-7 shrink-0 items-center justify-center rounded-lg border" :class="o.color">
              <component :is="o.icon" :size="14" />
            </span>
          </div>
          <div class="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-fg">{{ o.value }}</div>
          <div class="mt-0.5 text-xs text-muted">{{ o.hint }}</div>
        </div>
      </section>

      <!-- 2. architecture -->
      <section id="architecture" class="card mt-5 p-5 scroll-mt-28 lg:scroll-mt-16">
        <div class="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 class="flex items-center gap-2 font-semibold text-base"><Network :size="18" class="text-accent" /> Architecture</h2>
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted lg:hidden flex items-center gap-1">
              <MoveHorizontal :size="12" class="text-accent" /> Swipe diagram
            </span>
            <button
              type="button"
              class="btn btn-sm btn-ghost text-xs text-muted hover:text-fg flex items-center gap-1.5 min-h-10 px-3"
              @click="openDiagram('Architecture', ARCHITECTURE, 'Architecture diagram')"
            >
              <Maximize2 :size="13" />
              <span class="hidden sm:inline">Open full size</span>
              <span class="sm:hidden">Full size</span>
            </button>
          </div>
        </div>
        <p class="mb-4 text-sm text-muted">The hub on your PC is the centre: it stores every event, decides what runs where and holds the secrets. Runners do the work. You reach it through Cloudflare or Telegram.</p>
        <MermaidDiagram :code="ARCHITECTURE" label="Architecture diagram" />
      </section>

      <!-- 3. stack -->
      <section id="stack" class="card mt-5 p-5 scroll-mt-28 lg:scroll-mt-16">
        <h2 class="mb-3 flex items-center gap-2 font-semibold text-base"><Layers :size="18" class="text-accent" /> Stack</h2>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div v-for="g in stack" :key="g.layer" class="rounded-xl border border-line bg-surface/50 p-4 transition-all hover:border-line-strong">
            <div class="flex items-center gap-2 mb-2 pb-1.5 border-b border-line/60">
              <span class="flex size-6 items-center justify-center rounded-md bg-surface-2 border border-line text-accent">
                <component :is="g.icon" :size="13" />
              </span>
              <div class="sign font-semibold">{{ g.layer }}</div>
            </div>
            <ul class="space-y-1.5">
              <li v-for="i in g.items" :key="i.name" class="flex justify-between items-center gap-2 text-sm">
                <span class="font-mono text-[13px] text-fg">{{ i.name }}</span>
                <span class="chip chip-sm text-[11px] font-mono tabular-nums text-muted">{{ i.version }}</span>
              </li>
            </ul>
          </div>
        </div>
        <div class="mt-4 rounded-lg border border-line/70 bg-surface-2/40 px-3.5 py-2.5 text-xs text-muted flex flex-wrap items-center gap-2">
          <span class="font-semibold text-fg">Workspaces:</span>
          <code>apps/hub</code> · <code>apps/runner</code> · <code>apps/web</code> · <code>packages/shared</code> · <code>packages/tools</code> · <code>packages/agents</code>.
          <span class="ml-auto font-mono text-[11px] text-faint">Platform: {{ info.runtime.platform }} · Auth: {{ info.runtime.auth_mode }}</span>
        </div>
      </section>

      <!-- 4. database -->
      <section id="database" class="card mt-5 p-5 scroll-mt-28 lg:scroll-mt-16">
        <div class="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 class="flex items-center gap-2 font-semibold text-base"><Database :size="18" class="text-accent" /> Database (ERD)</h2>
          <div class="flex items-center gap-3">
            <label class="flex cursor-pointer items-center gap-2 text-xs text-muted hover:text-fg min-h-10 px-1 select-none">
              <input v-model="fullErd" type="checkbox" class="accent-accent size-4.5 cursor-pointer" />
              <span>Show every column</span>
            </label>
            <button
              type="button"
              class="btn btn-sm btn-ghost text-xs text-muted hover:text-fg flex items-center gap-1.5 min-h-10 px-3"
              @click="openDiagram('Database (ERD)', erd, 'Database entity relationship diagram')"
            >
              <Maximize2 :size="13" />
              <span class="hidden sm:inline">Open full size</span>
              <span class="sm:hidden">Full size</span>
            </button>
          </div>
        </div>
        <p class="mb-3 text-sm text-muted">
          {{ info.schema.length }} tables in SQLite. <b>events</b> is the source of truth: the office state is rebuilt from it by the same reducer in the hub and the browser.
        </p>

        <!-- ERD Legend -->
        <div class="flex flex-wrap items-center gap-3 text-xs text-muted mb-3 bg-surface-2/50 border border-line/60 rounded-lg px-3 py-2">
          <span class="font-semibold text-fg">Legend:</span>
          <span class="inline-flex items-center gap-1 font-mono text-[11px]"><span class="text-accent font-bold">PK</span> Primary key</span>
          <span>·</span>
          <span class="inline-flex items-center gap-1 font-mono text-[11px]"><span class="text-info font-bold">FK</span> Foreign key</span>
          <span>·</span>
          <span class="inline-flex items-center gap-1 font-mono text-[11px]"><code class="text-accent bg-accent/10 px-1 py-0.5 rounded">||--o{</code> One-to-many relation</span>
          <span class="ml-auto text-[11px] text-muted lg:hidden flex items-center gap-1">
            <MoveHorizontal :size="12" class="text-accent" /> Swipe to see whole diagram
          </span>
        </div>

        <MermaidDiagram :code="erd" label="Database entity relationship diagram" />

        <details class="mt-4 group">
          <summary class="cursor-pointer text-sm font-semibold flex items-center justify-between rounded-lg border border-line bg-surface-2/50 px-3.5 py-2.5 transition-colors hover:bg-surface-2 min-h-10">
            <span class="flex items-center gap-2">
              <Database :size="15" class="text-accent" />
              All tables and columns
              <span class="chip chip-sm text-[10px]">{{ info.schema.length }} tables</span>
            </span>
            <span class="text-xs text-muted font-normal group-open:hidden">Show details ↓</span>
            <span class="text-xs text-muted font-normal hidden group-open:inline">Hide details ↑</span>
          </summary>
          <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div v-for="t in info.schema" :key="t.name" class="rounded-xl border border-line bg-surface/50 p-3.5 transition-all hover:border-line-strong">
              <div class="flex items-center justify-between gap-2">
                <div class="font-mono text-sm font-semibold text-fg">{{ t.name }}</div>
                <span class="chip chip-sm text-[10px]">{{ t.columns.length }} cols</span>
              </div>
              <p v-if="t.note" class="mt-0.5 text-xs text-muted">{{ t.note }}</p>
              <ul class="mt-2 space-y-1 border-t border-line/60 pt-2">
                <li v-for="c in t.columns" :key="c.name" class="flex justify-between items-center gap-2 font-mono text-[12px]">
                  <span :class="c.primary ? 'text-accent font-semibold flex items-center gap-1' : 'text-fg'">
                    {{ c.name }}
                    <span v-if="c.primary" class="chip chip-sm text-[9px] px-1 py-0 text-accent border-accent/30 bg-accent/10">PK</span>
                  </span>
                  <span class="text-muted tabular-nums">{{ c.type }}{{ c.not_null ? "" : "?" }}</span>
                </li>
              </ul>
              <div v-if="t.foreign_keys.length" class="mt-2.5 pt-2 border-t border-line/60 space-y-1">
                <p v-for="f in t.foreign_keys" :key="f.columns.join()" class="text-[11px] text-info font-mono flex items-center gap-1.5">
                  <ArrowRight :size="11" class="shrink-0" />
                  <span>{{ f.columns.join(", ") }} → <span class="font-semibold">{{ f.table }}</span></span>
                </p>
              </div>
            </div>
          </div>
        </details>
      </section>

      <!-- 5. agents -->
      <section id="agents" class="card mt-5 p-5 scroll-mt-28 lg:scroll-mt-16">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="flex items-center gap-2 font-semibold text-base"><Sparkles :size="18" class="text-accent" /> Agents</h2>
          <span class="chip text-xs">{{ agents.filter(a => a.enabled).length }}/{{ agents.length }} enabled</span>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <RouterLink
            v-for="a in agents"
            :key="a.id"
            to="/agents"
            class="card flex items-start gap-3 p-3.5 transition-all hover:border-line-strong hover:bg-surface-2 min-h-18"
            :class="!a.enabled && 'opacity-50 grayscale'"
          >
            <AgentAvatar :name="a.name" :slug="a.slug" :size="38" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-1.5">
                <span class="truncate font-medium text-sm text-fg">{{ a.name }}</span>
                <span class="chip shrink-0 text-[10px] font-mono">{{ a.tools.length }} tools</span>
              </div>
              <p class="line-clamp-2 text-xs text-muted mt-0.5 leading-snug">{{ a.role }}</p>
              <div class="mt-1.5 flex items-center gap-1.5 font-mono text-[11px] text-faint truncate">
                <span class="truncate">{{ a.provider }}</span>
                <span>·</span>
                <span class="truncate">{{ a.model }}</span>
              </div>
            </div>
          </RouterLink>
        </div>
      </section>

      <!-- 6. tools -->
      <section id="tools" class="card mt-5 p-5 scroll-mt-28 lg:scroll-mt-16">
        <div class="mb-1 flex items-center justify-between">
          <h2 class="flex items-center gap-2 font-semibold text-base"><Wrench :size="18" class="text-accent" /> Tools</h2>
          <span class="chip text-xs">{{ tools.length }} total</span>
        </div>
        <p class="mb-3 text-sm text-muted">Every tool call goes through runTool(): check input → risk level → ask approval if needed → execute → record events. Hover or tap a tool for its description.</p>
        <div class="space-y-4">
          <div v-for="[cat, list] in toolsByCategory" :key="cat" class="rounded-xl border border-line/60 bg-surface/40 p-3.5">
            <div class="flex items-center gap-2 mb-2 pb-1.5 border-b border-line/50">
              <span class="flex size-6 items-center justify-center rounded-md bg-surface-2 border border-line text-accent">
                <component :is="toolCategoryIcon(cat)" :size="13" />
              </span>
              <span class="sign text-xs font-semibold">{{ cat }}</span>
              <span class="chip chip-sm text-[10px] text-muted">{{ list.length }}</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="t in list"
                :key="t.name"
                type="button"
                class="chip font-mono text-[11px] min-h-10 sm:min-h-8 px-3 py-2 sm:px-2.5 sm:py-1 cursor-pointer transition-all active:scale-95"
                :class="selectedTool?.name === t.name ? 'border-accent bg-accent/15 text-accent font-semibold shadow-sm' : 'hover:border-line-strong hover:bg-surface-2'"
                :title="t.description"
                @click="selectedTool = selectedTool?.name === t.name ? null : t"
              >
                {{ t.name }}
              </button>
            </div>
          </div>
        </div>

        <!-- Selected Tool Details on Tap -->
        <div v-if="selectedTool" class="mt-4 rounded-xl border border-accent/40 bg-accent/5 p-4 transition-all">
          <div class="flex items-start justify-between gap-3">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <span class="font-mono text-sm font-semibold text-accent">{{ selectedTool.name }}</span>
                <span class="chip text-[10px] font-mono">{{ selectedTool.category }}</span>
              </div>
              <p class="text-xs leading-relaxed text-fg">{{ selectedTool.description }}</p>
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-sm p-2 text-muted hover:text-fg min-h-10 min-w-10 flex items-center justify-center shrink-0"
              aria-label="Close tool description"
              @click="selectedTool = null"
            >
              <X :size="16" />
            </button>
          </div>
        </div>
      </section>

      <!-- 7. events -->
      <section id="events" class="card mt-5 p-5 scroll-mt-28 lg:scroll-mt-16">
        <div class="mb-1 flex items-center justify-between">
          <h2 class="flex items-center gap-2 font-semibold text-base"><Zap :size="18" class="text-accent" /> Events</h2>
          <span class="chip text-xs">{{ info.event_types.length }} types</span>
        </div>
        <p class="mb-3 text-sm text-muted">Everything that happens is an append-only event. The office, the board, replay and Telegram all read from this single source of truth.</p>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div v-for="[group, list] in eventGroups" :key="group" class="rounded-xl border border-line bg-surface/50 p-3.5 transition-all hover:border-line-strong">
            <div class="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-line/60">
              <div class="flex items-center gap-2">
                <span class="flex size-6 items-center justify-center rounded-md bg-surface-2 border border-line text-accent">
                  <component :is="eventGroupIcon(group)" :size="13" />
                </span>
                <span class="sign text-xs font-semibold">{{ group }}</span>
              </div>
              <span class="chip chip-sm text-[10px] text-muted">{{ list.length }}</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <span v-for="e in list" :key="e" class="chip font-mono text-[11px]">{{ e }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 8. flows -->
      <section id="flows" class="card mt-5 p-5 scroll-mt-28 lg:scroll-mt-16">
        <div class="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 class="flex items-center gap-2 font-semibold text-base"><Workflow :size="18" class="text-accent" /> Main flow</h2>
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted lg:hidden flex items-center gap-1">
              <MoveHorizontal :size="12" class="text-accent" /> Swipe diagram
            </span>
            <button
              type="button"
              class="btn btn-sm btn-ghost text-xs text-muted hover:text-fg flex items-center gap-1.5 min-h-10 px-3"
              @click="openDiagram('Main Flow', FLOWS, 'Main work flow diagram')"
            >
              <Maximize2 :size="13" />
              <span class="hidden sm:inline">Open full size</span>
              <span class="sm:hidden">Full size</span>
            </button>
          </div>
        </div>
        <p class="mb-4 text-sm text-muted">From your message or scheduled trigger to something published live.</p>
        <MermaidDiagram :code="FLOWS" label="Main work flow diagram" />
      </section>

      <!-- 9. integrations -->
      <section id="integrations" class="card mt-5 p-5 scroll-mt-28 lg:scroll-mt-16">
        <div class="mb-1 flex items-center justify-between">
          <h2 class="flex items-center gap-2 font-semibold text-base"><GitFork :size="18" class="text-accent" /> Connected</h2>
          <span class="chip text-xs">External services</span>
        </div>
        <p class="mb-3 text-sm text-muted">Services and platforms connected to your MyOfis installation.</p>
        <div class="flex flex-wrap gap-2 text-sm">
          <span class="chip flex items-center gap-1.5 py-1.5 px-3 min-h-9" :class="info.integrations.telegram ? 'text-accent border-accent/30 bg-accent/10 font-medium' : 'text-muted border-line bg-surface-2'">
            Telegram {{ info.integrations.telegram ? "✓" : "✗" }}
          </span>
          <span class="chip flex items-center gap-1.5 py-1.5 px-3 min-h-9" :class="info.integrations.gitea ? 'text-accent border-accent/30 bg-accent/10 font-medium' : 'text-muted border-line bg-surface-2'">
            Gitea {{ info.integrations.gitea ? "✓" : "✗" }}
          </span>
          <span class="chip flex items-center gap-1.5 py-1.5 px-3 text-accent border-accent/30 bg-accent/10 font-medium min-h-9">
            <Search :size="13" /> Web search: {{ info.integrations.web_search }}
          </span>
          <span v-for="w in info.integrations.websites" :key="w" class="chip flex items-center gap-1.5 py-1.5 px-3 text-accent border-accent/30 bg-accent/10 font-medium min-h-9">
            <Globe :size="13" /> Website: {{ w }}
          </span>
          <span v-for="(list, project) in info.integrations.social" :key="project" class="chip flex items-center gap-1.5 py-1.5 px-3 text-accent border-accent/30 bg-accent/10 font-medium min-h-9">
            {{ project }}: {{ list.join(", ") }}
          </span>
          <span class="chip flex items-center gap-1.5 py-1.5 px-3 border-line bg-surface-2 text-fg min-h-9">
            <HardDrive :size="13" class="text-muted" /> {{ info.integrations.backups }} backups
          </span>
        </div>
      </section>

      <!-- 10. safety -->
      <section id="safety" class="card mt-5 p-5 scroll-mt-28 lg:scroll-mt-16">
        <div class="mb-1 flex items-center justify-between">
          <h2 class="flex items-center gap-2 font-semibold text-base"><ShieldCheck :size="18" class="text-accent" /> Safety</h2>
          <span class="chip text-xs text-accent border-accent/30 bg-accent/10">Zero Docker · Hardware isolated</span>
        </div>
        <p class="mb-4 text-sm text-muted">MyOfis relies on workspace isolation, path guards, strict allowlists, and owner approvals. The system protects your secrets and keys at every layer.</p>
        <div class="grid gap-3 sm:grid-cols-2">
          <div v-for="item in safetyCards" :key="item.title" class="rounded-xl border border-line bg-surface/50 p-3.5 transition-all hover:border-line-strong hover:bg-surface">
            <div class="flex items-center gap-2.5 mb-1.5">
              <span class="flex size-7 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
                <component :is="item.icon" :size="14" />
              </span>
              <h3 class="text-sm font-semibold text-fg">{{ item.title }}</h3>
            </div>
            <p class="text-xs text-muted leading-relaxed pl-9.5">{{ item.desc }}</p>
          </div>
        </div>
      </section>

      <p class="mt-6 flex items-center gap-1.5 text-xs text-faint">
        <Boxes :size="13" /> Read from the running hub at {{ new Date(info.generated_at).toLocaleString("en-MY") }}.
      </p>
    </template>

    <!-- Full-screen Diagram Overlay -->
    <Teleport to="body">
      <div
        v-if="activeOverlay"
        class="fixed inset-0 z-50 flex flex-col bg-bg/95 p-4 backdrop-blur-md sm:p-6"
        tabindex="-1"
        role="dialog"
        :aria-label="activeOverlay.title"
        @click.self="activeOverlay = null"
      >
        <div class="flex items-center justify-between border-b border-line pb-3">
          <div class="flex items-center gap-2">
            <h2 class="text-base font-semibold text-fg">{{ activeOverlay.title }}</h2>
            <span class="chip text-xs">Full screen view</span>
          </div>
          <button
            class="btn btn-sm btn-ghost flex items-center gap-1.5 text-muted hover:text-fg min-h-10 px-3"
            aria-label="Close full size view"
            @click="activeOverlay = null"
          >
            <kbd class="text-[10px] hidden sm:inline">ESC</kbd>
            <X :size="16" />
            <span class="text-xs">Close</span>
          </button>
        </div>
        <div class="flex-1 overflow-auto p-4 flex items-center justify-center" @click.self="activeOverlay = null">
          <MermaidDiagram :code="activeOverlay.code" :label="activeOverlay.label" full />
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.nav-scroll {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.nav-scroll::-webkit-scrollbar {
  display: none;
}
</style>

