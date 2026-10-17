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
      <RouterLink v-if="marketing" :to="{ path: '/jobs/new', query: { agent: marketing.slug } }" class="btn btn-primary">New brief for Marketing</RouterLink>
    </PageHeader>

    <div class="mb-4 flex flex-wrap items-center gap-2">
      <div class="flex rounded-lg border border-line bg-surface p-0.5" role="tablist">
        <button role="tab" class="rounded-md px-3 py-1.5 text-sm font-medium" :class="tab === 'pending' ? 'bg-surface-2 text-fg' : 'text-muted'" :aria-selected="tab === 'pending'" @click="tab = 'pending'">
          Waiting <span class="font-mono text-faint">{{ pendingCount }}</span>
        </button>
        <button role="tab" class="rounded-md px-3 py-1.5 text-sm font-medium" :class="tab === 'decided' ? 'bg-surface-2 text-fg' : 'text-muted'" :aria-selected="tab === 'decided'" @click="tab = 'decided'">
          Decided
        </button>
      </div>
      <select v-model="projectId" class="input ml-auto w-auto" aria-label="Project">
        <option value="">All projects</option>
        <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </div>

    <p v-if="error" class="mb-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{{ error }}</p>

    <div class="space-y-3">
      <DraftCard v-for="d in drafts" :key="d.id" :draft="d" :project-name="projectName(d.project_id)" @decided="onDecided" />
      <div v-if="!drafts.length" class="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line px-6 py-10 text-center">
        <FilePenLine :size="28" class="text-faint" :stroke-width="1.5" />
        <p class="font-medium">{{ tab === "pending" ? "No drafts waiting" : "Nothing decided yet" }}</p>
        <p class="max-w-sm text-sm text-muted">
          Give Marketing a job (captions, a video script, a content calendar…) or chat with it. Fill in the project's brief first so it knows your prices and tone.
        </p>
        <RouterLink to="/projects" class="mt-1 text-sm font-medium text-accent hover:underline">Edit project briefs</RouterLink>
      </div>
    </div>
  </div>
</template>
