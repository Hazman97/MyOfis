<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { FilePenLine } from "lucide-vue-next";
import type { ContentDraft, Project } from "@agent-office/shared";
import DraftCard from "../components/DraftCard.vue";
import PageHeader from "../components/PageHeader.vue";
import { api } from "../api/http.ts";
import { useOffice } from "../stores/office.ts";

const office = useOffice();
const tab = ref<"pending" | "decided">("pending");
const projectId = ref("");
const drafts = ref<ContentDraft[]>([]);
const projects = ref<Project[]>([]);
const error = ref("");

const projectName = (id: string) => projects.value.find((p) => p.id === id)?.name;
const marketing = computed(() => office.agents.find((a) => a.slug === "marketing") ?? office.agents.find((a) => a.tools.includes("save_draft")));

async function load() {
  error.value = "";
  try {
    drafts.value = (await api.drafts({ status: tab.value, project_id: projectId.value || undefined })).drafts;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  projects.value = (await api.projects()).projects;
  await load();
});
watch([tab, projectId], load);
// live: new drafts arrive while you look at the page
watch(() => Object.keys(office.state.pending_drafts ?? {}).join(","), () => tab.value === "pending" && load());

function onDecided(d: ContentDraft) {
  if (tab.value === "pending") drafts.value = drafts.value.filter((x) => x.id !== d.id);
  else drafts.value = drafts.value.map((x) => (x.id === d.id ? d : x));
}
const pendingCount = computed(() => Object.keys(office.state.pending_drafts ?? {}).length);
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <PageHeader
      sign="Whiteboard"
      title="Drafts"
      description="Posts and copy Marketing wrote for you. Nothing is ever posted for you: approve or edit what you like, then copy it out. Your edits and feedback teach Marketing your style."
    >
      <RouterLink v-if="marketing" :to="{ path: '/jobs/new', query: { agent: marketing.slug } }" class="btn btn-primary shadow-sm">New brief for Marketing</RouterLink>
    </PageHeader>

    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div class="inline-flex rounded-xl border border-line bg-surface-2/60 p-1" role="tablist" aria-label="Draft status">
        <button
          role="tab"
          class="inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all duration-150"
          :class="tab === 'pending' ? 'bg-accent text-accent-ink shadow-sm' : 'text-muted hover:text-fg hover:bg-surface-2'"
          :aria-selected="tab === 'pending'"
          @click="tab = 'pending'"
        >
          Waiting
          <span
            v-if="pendingCount"
            class="rounded-full px-1.5 font-mono text-[10px] leading-4 font-bold"
            :class="tab === 'pending' ? 'bg-black/20 text-accent-ink' : 'bg-signal text-white'"
          >
            {{ pendingCount }}
          </span>
        </button>
        <button
          role="tab"
          class="inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all duration-150"
          :class="tab === 'decided' ? 'bg-accent text-accent-ink shadow-sm' : 'text-muted hover:text-fg hover:bg-surface-2'"
          :aria-selected="tab === 'decided'"
          @click="tab = 'decided'"
        >
          Decided
        </button>
      </div>

      <select v-model="projectId" class="input w-auto text-xs py-1.5" aria-label="Project">
        <option value="">All projects</option>
        <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </div>

    <p v-if="error" class="mb-3 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-xs font-medium text-danger">{{ error }}</p>

    <div class="space-y-3">
      <DraftCard v-for="d in drafts" :key="d.id" :draft="d" :project-name="projectName(d.project_id)" @decided="onDecided" />
      <div v-if="!drafts.length" class="card flex flex-col items-center justify-center p-12 text-center border-dashed">
        <div class="mb-3 flex size-12 items-center justify-center rounded-2xl border border-line bg-surface-2 text-muted shadow-sm">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="size-6 text-faint"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </div>
        <h3 class="font-semibold text-sm tracking-tight text-fg">{{ tab === "pending" ? "No drafts waiting" : "Nothing decided yet" }}</h3>
        <p class="mt-1 max-w-sm text-xs text-muted leading-relaxed">
          Give Marketing a job (captions, a video script, a content calendar…) or chat with it. Fill in the project's brief first so it knows your prices and tone.
        </p>
        <RouterLink to="/projects" class="mt-3 text-xs font-semibold text-accent hover:underline">Edit project briefs →</RouterLink>
      </div>
    </div>
  </div>
</template>
