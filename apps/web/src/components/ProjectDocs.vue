<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { Download, FileText, Search, Upload } from "lucide-vue-next";
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
const text = ref("");
const error = ref("");
const busy = ref(false);

async function load() {
  docs.value = (await api.docs(props.project.id)).docs;
}
onMounted(load);

async function search() {
  error.value = "";
  hits.value = q.value.trim().length >= 2 ? (await api.searchDocs(q.value.trim(), props.project.id)).hits : null;
}
async function show(id: string, page = 1) {
  if (open.value === id && page === 1) {
    open.value = null;
    return;
  }
  open.value = id;
  text.value = (await api.docText(id, page, page + 4)).text;
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
</script>

<template>
  <div class="space-y-4">
    <p class="text-xs text-muted">
      Files for this project (minutes, brochures, specs). They are read on your PC; the <b>Project Assistant</b> searches them and quotes the page. Send them in
      <RouterLink :to="{ path: '/chat', query: { agent: 'project-assistant' } }" class="text-accent hover:underline">Chat</RouterLink> or Telegram with this project selected, or add one here.
    </p>
    <div class="flex flex-wrap gap-2">
      <form class="flex min-w-0 flex-1 gap-2" @submit.prevent="search">
        <input v-model="q" class="input min-w-0 flex-1 text-sm" placeholder="Search all documents… (e.g. power supply)" aria-label="Search documents" />
        <button class="btn btn-sm"><Search :size="14" /> Search</button>
      </form>
      <label class="btn btn-sm cursor-pointer" :class="busy && 'opacity-60'">
        <input type="file" accept="application/pdf,.pdf,.docx,.txt,.md" class="hidden" :disabled="busy" @change="add" />
        <Upload :size="14" /> {{ busy ? "Reading…" : "Add document" }}
      </label>
    </div>
    <p v-if="error" class="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{{ error }}</p>

    <div v-if="hits" class="card space-y-2 p-3">
      <div class="text-xs font-medium">{{ hits.length }} matches</div>
      <button v-for="h in hits" :key="`${h.doc_id}-${h.page}`" type="button" class="block w-full rounded-md p-2 text-left text-xs hover:bg-surface-2" @click="show(h.doc_id, h.page)">
        <span class="font-medium">{{ h.title }}</span> <span class="text-muted">· page {{ h.page }}</span>
        <span class="mt-0.5 block text-muted">{{ h.snippet }}</span>
      </button>
    </div>

    <p v-if="!docs.length" class="text-sm text-muted">No documents yet.</p>
    <article v-for="d in docs" :key="d.id" class="card space-y-2 p-3">
      <div class="flex flex-wrap items-center gap-2">
        <FileText :size="16" class="text-accent" />
        <button type="button" class="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline" @click="show(d.id)">{{ d.title }}</button>
        <span class="text-[11px] text-muted">{{ d.pages }} pages · {{ fmtDateTime(d.created_at) }}</span>
        <a :href="api.uploadUrl(d.upload_id, true)" class="btn btn-ghost btn-sm px-2" download :aria-label="`Download ${d.title}`"><Download :size="14" /></a>
      </div>
      <p v-if="d.summary" class="whitespace-pre-wrap text-xs text-muted">{{ d.summary }}</p>
      <p v-else class="text-[11px] text-faint">Not summarised yet: send it to the Project Assistant in chat.</p>
      <pre v-if="open === d.id" class="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-sunken p-2 text-[11px]">{{ text }}</pre>
    </article>
  </div>
</template>
