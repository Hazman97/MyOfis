<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import {
  BookOpen,
  ChevronDown,
  Download,
  FileText,
  FolderOpen,
  Loader2,
  MessageSquare,
  Search,
  Send,
  Upload,
  X,
} from "lucide-vue-next";
import type { DocHit, Project, ProjectDoc } from "@agent-office/shared";
import { api } from "../api/http.ts";
import { fmtDateTime } from "../format.ts";

/**
 * The project's documents (Project Assistant): every PDF / DOCX / note sent in chat or Telegram,
 * read on this PC and searchable. Add one here too; the assistant summarises it when you chat.
 */
const props = defineProps<{ project: Project }>();
const docs = ref<ProjectDoc[]>([]);
const hits = ref<DocHit[] | null>(null);
const q = ref("");
const open = ref<string | null>(null);
const openPage = ref(1);
const text = ref("");
const error = ref("");
const busy = ref(false);
const readingDoc = ref(false);
const expandedSummaries = ref<Record<string, boolean>>({});

const totalPages = computed(() => docs.value.reduce((acc, d) => acc + (d.pages || 0), 0));

async function load() {
  docs.value = (await api.docs(props.project.id)).docs;
}
onMounted(load);

async function search() {
  error.value = "";
  hits.value = q.value.trim().length >= 2 ? (await api.searchDocs(q.value.trim(), props.project.id)).hits : null;
}

function clearSearch() {
  q.value = "";
  hits.value = null;
}

interface GroupedHit {
  docId: string;
  docTitle: string;
  hits: DocHit[];
}
const groupedHits = computed<GroupedHit[]>(() => {
  if (!hits.value) return [];
  const map = new Map<string, GroupedHit>();
  for (const h of hits.value) {
    let g = map.get(h.doc_id);
    if (!g) {
      g = { docId: h.doc_id, docTitle: h.title, hits: [] };
      map.set(h.doc_id, g);
    }
    g.hits.push(h);
  }
  return Array.from(map.values());
});

async function show(id: string, page = 1) {
  if (open.value === id && openPage.value === page) {
    open.value = null;
    text.value = "";
    return;
  }
  open.value = id;
  openPage.value = page;
  readingDoc.value = true;
  try {
    text.value = (await api.docText(id, page, page + 4)).text;
  } catch (err) {
    text.value = `Failed to load document text: ${(err as Error).message}`;
  } finally {
    readingDoc.value = false;
  }
}

async function add(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  busy.value = true;
  error.value = "";
  try {
    const up = await api.uploadImage(file); // documents use the same upload
    await api.addDoc(up.id, props.project.id);
    await load();
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}

function getDocTypeInfo(doc: ProjectDoc) {
  const name = (doc.title || "").toLowerCase();
  const ct = (doc.content_type || "").toLowerCase();
  if (name.endsWith(".pdf") || ct.includes("pdf")) {
    return { ext: "PDF", badgeClass: "text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/20" };
  }
  if (name.endsWith(".docx") || ct.includes("word") || ct.includes("officedocument")) {
    return { ext: "DOCX", badgeClass: "text-sky-600 dark:text-sky-400 bg-sky-500/10 border-sky-500/20" };
  }
  if (name.endsWith(".txt") || ct.includes("text/plain")) {
    return { ext: "TXT", badgeClass: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20" };
  }
  if (name.endsWith(".md") || ct.includes("markdown")) {
    return { ext: "MD", badgeClass: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20" };
  }
  return { ext: "DOC", badgeClass: "text-muted bg-surface-2 border-line" };
}

function toggleSummary(id: string) {
  expandedSummaries.value[id] = !expandedSummaries.value[id];
}

const currentDocTitle = computed(() => {
  if (!open.value) return "";
  return docs.value.find((d) => d.id === open.value)?.title || "Document";
});
</script>

<template>
  <div class="space-y-4">
    <!-- Header Stats & Introduction -->
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-3">
      <div>
        <h3 class="text-sm font-semibold tracking-tight text-fg flex items-center gap-2">
          <span>Project Documents</span>
          <span v-if="docs.length" class="chip text-[11px] font-mono font-medium">
            {{ docs.length }} {{ docs.length === 1 ? "file" : "files" }} · {{ totalPages }} {{ totalPages === 1 ? "page" : "pages" }}
          </span>
        </h3>
        <p class="text-xs text-muted mt-0.5">
          Read on your PC; the <b>Project Assistant</b> searches and quotes exact pages. Send files in
          <RouterLink :to="{ path: '/chat', query: { agent: 'project-assistant' } }" class="text-accent hover:underline font-medium">Chat</RouterLink>
          or Telegram with this project selected, or upload below.
        </p>
      </div>
    </div>

    <!-- Search Bar & Upload Button -->
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
      <form class="flex min-w-0 flex-1 items-center gap-2" @submit.prevent="search">
        <div class="relative min-w-0 flex-1">
          <Search :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            v-model="q"
            class="input min-w-0 pl-8 text-xs sm:text-sm min-h-[40px]"
            placeholder="Search all documents… (e.g. power supply, specs)"
            aria-label="Search documents"
          />
          <button
            v-if="q"
            type="button"
            class="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint hover:text-fg p-0.5 rounded"
            title="Clear search"
            @click="clearSearch"
          >
            <X :size="13" />
          </button>
        </div>
        <button type="submit" class="btn btn-sm min-h-[40px] px-3.5 shrink-0">
          <Search :size="14" />
          <span>Search</span>
        </button>
      </form>

      <label
        class="btn btn-primary btn-sm min-h-[40px] px-3.5 cursor-pointer shrink-0 transition-all"
        :class="busy && 'opacity-60 pointer-events-none'"
      >
        <input type="file" accept="application/pdf,.pdf,.docx,.txt,.md" class="hidden" :disabled="busy" @change="add" />
        <Loader2 v-if="busy" :size="14" class="animate-spin" />
        <Upload v-else :size="14" />
        <span>{{ busy ? "Reading…" : "Add document" }}</span>
      </label>
    </div>

    <!-- Error Alert -->
    <p v-if="error" class="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger font-medium" role="alert">
      {{ error }}
    </p>

    <!-- Search Results (Grouped by Document) -->
    <div v-if="hits" class="card space-y-3 p-3.5 bg-surface-2/30 border-line-strong">
      <div class="flex items-center justify-between border-b border-line pb-2">
        <div class="flex items-center gap-2">
          <Search :size="14" class="text-accent" />
          <span class="text-xs font-semibold text-fg">
            {{ hits.length }} {{ hits.length === 1 ? "match" : "matches" }} across {{ groupedHits.length }} {{ groupedHits.length === 1 ? "document" : "documents" }}
          </span>
        </div>
        <button type="button" class="btn btn-ghost btn-sm text-[11px] h-6 px-2" @click="clearSearch">
          Clear results
        </button>
      </div>

      <div class="space-y-3">
        <div v-for="g in groupedHits" :key="g.docId" class="rounded-lg border border-line bg-surface p-3 space-y-2">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 min-w-0">
              <FileText :size="14" class="text-accent shrink-0" />
              <span class="text-xs font-semibold text-fg truncate">{{ g.docTitle }}</span>
            </div>
            <span class="text-[11px] text-muted shrink-0">{{ g.hits.length }} {{ g.hits.length === 1 ? "hit" : "hits" }}</span>
          </div>

          <!-- Page chips and snippets -->
          <div class="space-y-1.5 pt-1">
            <div
              v-for="h in g.hits"
              :key="`${h.doc_id}-${h.page}`"
              class="group flex flex-col sm:flex-row sm:items-start gap-1.5 rounded-md p-2 text-xs hover:bg-surface-2 transition-colors cursor-pointer border border-transparent hover:border-line"
              @click="show(h.doc_id, h.page)"
            >
              <button
                type="button"
                class="chip self-start shrink-0 text-[10px] font-mono font-semibold hover:border-accent hover:text-accent"
                title="Open this page"
              >
                Page {{ h.page }}
              </button>
              <span class="text-muted leading-relaxed min-w-0 flex-1 group-hover:text-fg transition-colors">
                {{ h.snippet }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Active Document Text Reader (Nicer Reader) -->
    <div v-if="open && text" class="card overflow-hidden border-accent/40 shadow-card">
      <div class="flex items-center justify-between border-b border-line bg-surface-2/60 px-3.5 py-2">
        <div class="flex items-center gap-2 min-w-0">
          <BookOpen :size="14" class="text-accent shrink-0" />
          <span class="text-xs font-semibold text-fg truncate">{{ currentDocTitle }}</span>
          <span class="chip text-[10px] font-mono">Page {{ openPage }} – {{ openPage + 4 }}</span>
        </div>
        <button
          type="button"
          class="rounded p-1 text-faint hover:text-fg hover:bg-surface-2 transition-colors"
          title="Close reader"
          aria-label="Close document text"
          @click="open = null"
        >
          <X :size="14" />
        </button>
      </div>
      <div class="p-3.5 bg-sunken/40">
        <div v-if="readingDoc" class="flex items-center justify-center py-8 text-xs text-muted gap-2">
          <Loader2 :size="16" class="animate-spin text-accent" />
          <span>Loading text…</span>
        </div>
        <div
          v-else
          class="font-sans text-xs leading-relaxed text-fg whitespace-pre-wrap max-h-80 sm:max-h-96 overflow-y-auto pr-2"
        >
          {{ text }}
        </div>
      </div>
    </div>

    <!-- Empty State (3 Ways to Add Files) -->
    <div v-if="!docs.length && !hits" class="card p-6 text-center space-y-4 border-dashed">
      <div class="mx-auto flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent shadow-xs">
        <FolderOpen :size="24" />
      </div>
      <div class="space-y-1">
        <h4 class="text-sm font-semibold text-fg">No documents uploaded yet</h4>
        <p class="text-xs text-muted max-w-md mx-auto leading-relaxed">
          Upload specifications, minutes, or brochures. The <b>Project Assistant</b> indexes them and quotes exact pages when answering questions.
        </p>
      </div>

      <div class="grid gap-2.5 sm:grid-cols-3 max-w-xl mx-auto pt-2 text-left">
        <div class="rounded-lg border border-line bg-surface-2/40 p-3 space-y-1">
          <div class="flex items-center gap-1.5 font-semibold text-xs text-fg">
            <MessageSquare :size="14" class="text-accent shrink-0" />
            <span>1. In Chat</span>
          </div>
          <p class="text-[11px] text-muted leading-relaxed">
            Attach files when chatting with
            <RouterLink :to="{ path: '/chat', query: { agent: 'project-assistant' } }" class="text-accent hover:underline font-medium">Project Assistant</RouterLink>.
          </p>
        </div>

        <div class="rounded-lg border border-line bg-surface-2/40 p-3 space-y-1">
          <div class="flex items-center gap-1.5 font-semibold text-xs text-fg">
            <Send :size="14" class="text-info shrink-0" />
            <span>2. Via Telegram</span>
          </div>
          <p class="text-[11px] text-muted leading-relaxed">
            Send files to your bot with this project selected (<code class="text-[10px]">/project</code>).
          </p>
        </div>

        <div class="rounded-lg border border-line bg-surface-2/40 p-3 space-y-1">
          <div class="flex items-center gap-1.5 font-semibold text-xs text-fg">
            <Upload :size="14" class="text-signal shrink-0" />
            <span>3. Direct Upload</span>
          </div>
          <p class="text-[11px] text-muted leading-relaxed">
            Use the "Add document" button above to upload PDF, DOCX, TXT or MD files.
          </p>
        </div>
      </div>
    </div>

    <!-- Documents List -->
    <div v-if="docs.length" class="space-y-3">
      <article
        v-for="d in docs"
        :key="d.id"
        class="card space-y-3 p-3.5 transition-all hover:border-line-strong"
      >
        <!-- Document Header Row -->
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <!-- File Type Badge -->
            <span
              class="shrink-0 inline-flex items-center justify-center rounded-md border px-1.5 py-0.5 text-[10px] font-mono font-bold tracking-tight"
              :class="getDocTypeInfo(d).badgeClass"
            >
              {{ getDocTypeInfo(d).ext }}
            </span>

            <!-- Title & Show Text Toggle -->
            <button
              type="button"
              class="min-w-0 flex-1 truncate text-left text-sm font-semibold text-fg hover:text-accent hover:underline transition-colors"
              :title="`Read ${d.title}`"
              @click="show(d.id)"
            >
              {{ d.title }}
            </button>
          </div>

          <!-- Metadata & Actions -->
          <div class="flex items-center gap-2 shrink-0">
            <span class="text-[11px] text-muted font-medium">
              {{ d.pages }} {{ d.pages === 1 ? "page" : "pages" }} · {{ fmtDateTime(d.created_at) }}
            </span>
            <a
              :href="api.uploadUrl(d.upload_id, true)"
              class="btn btn-ghost btn-sm min-h-[32px] px-2 text-muted hover:text-fg"
              download
              :aria-label="`Download ${d.title}`"
              title="Download original file"
            >
              <Download :size="14" />
            </a>
          </div>
        </div>

        <!-- Summary in a readable box (collapsed to 4 lines with Show more) -->
        <div v-if="d.summary" class="rounded-lg border border-line bg-surface-2/40 p-3 text-xs">
          <div class="flex items-center gap-1.5 pb-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-faint">
            <BookOpen :size="12" class="text-accent" />
            <span>Summary</span>
          </div>
          <div
            class="whitespace-pre-wrap leading-relaxed text-muted transition-all"
            :class="!expandedSummaries[d.id] && 'line-clamp-4'"
          >
            {{ d.summary }}
          </div>
          <button
            v-if="d.summary.length > 220 || d.summary.includes('\n')"
            type="button"
            class="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline"
            @click="toggleSummary(d.id)"
          >
            <span>{{ expandedSummaries[d.id] ? "Show less" : "Show more" }}</span>
            <ChevronDown :size="12" class="transition-transform" :class="expandedSummaries[d.id] && 'rotate-180'" />
          </button>
        </div>
        <p v-else class="text-[11px] text-faint italic pl-1">
          Not summarised yet: send it to the Project Assistant in chat.
        </p>

        <!-- Document Text Reader (when expanded from title click) -->
        <div v-if="open === d.id && !hits" class="rounded-lg border border-line bg-sunken/60 overflow-hidden">
          <div class="flex items-center justify-between border-b border-line px-3 py-1.5 text-[11px] font-medium text-muted">
            <span class="flex items-center gap-1.5 font-semibold text-fg">
              <BookOpen :size="13" class="text-accent" />
              <span>Document Text (Pages {{ openPage }}–{{ openPage + 4 }})</span>
            </span>
            <button type="button" class="text-faint hover:text-fg text-xs" @click="open = null">
              Close reader
            </button>
          </div>
          <div class="p-3 text-xs leading-relaxed text-fg whitespace-pre-wrap max-h-80 overflow-y-auto font-sans">
            <div v-if="readingDoc" class="flex items-center justify-center py-4 text-muted gap-2">
              <Loader2 :size="14" class="animate-spin text-accent" />
              <span>Loading text…</span>
            </div>
            <span v-else>{{ text }}</span>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

