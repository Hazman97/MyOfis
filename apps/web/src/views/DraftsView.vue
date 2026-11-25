<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { CalendarClock, CheckCheck, FilePenLine, Layers, LoaderCircle, X } from "lucide-vue-next";
import { groupDraftSets, type ContentDraft, type Project } from "@agent-office/shared";
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
const setBusy = ref<string | null>(null);
const activeSetTab = reactive<Record<string, string>>({});
const setSchedule = reactive<Record<string, string>>({});

const projectName = (id: string) => projects.value.find((p) => p.id === id)?.name;
const marketing = computed(() => office.agents.find((a) => a.slug === "pengurus-sosial") ?? office.agents.find((a) => a.slug === "marketing") ?? office.agents.find((a) => a.tools.includes("save_draft")));
const groups = computed(() => groupDraftSets(drafts.value));

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
  youtube: "YouTube",
  whatsapp: "WhatsApp",
  website: "Website",
};

function tabLabel(d: ContentDraft, idx: number, all: ContentDraft[]): string {
  const base = PLATFORM_LABELS[d.platform] ?? d.platform;
  const pl = d.meta?.placement ? d.meta.placement.replace(/^(ig|fb|yt)_/, "") : "";
  const samePlat = all.filter((x) => x.platform === d.platform && x.meta?.placement === d.meta?.placement);
  const num = samePlat.length > 1 ? ` #${samePlat.findIndex((x) => x.id === d.id) + 1}` : "";
  return `${base}${pl && pl !== d.platform ? ` · ${pl}` : ""}${num}`;
}

function selectedDraft(setId: string, list: ContentDraft[]): ContentDraft {
  const id = activeSetTab[setId];
  return list.find((d) => d.id === id) ?? list[0]!;
}

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
watch(
  () => Object.values(office.state.pending_drafts ?? {}).map((d) => `${d.id}:${d.updated_at ?? ""}`).join(","),
  () => tab.value === "pending" && load(),
);
watch(
  () => office.state.drafts_rev,
  () => tab.value !== "pending" && load(),
);

function onDecided(d: ContentDraft) {
  if (tab.value === "pending") drafts.value = drafts.value.filter((x) => x.id !== d.id);
  else drafts.value = drafts.value.map((x) => (x.id === d.id ? d : x));
}

async function decideSet(setId: string, decision: "approve" | "reject") {
  setBusy.value = setId;
  error.value = "";
  try {
    const rawTime = setSchedule[setId];
    const publish_at = decision === "approve" && rawTime ? new Date(rawTime).toISOString() : undefined;
    await api.decideDraftSet(setId, { decision, ...(publish_at ? { publish_at } : {}) });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    setBusy.value = null;
  }
}

async function scheduleSet(setId: string) {
  const rawTime = setSchedule[setId];
  if (!rawTime) return;
  setBusy.value = setId;
  error.value = "";
  try {
    await api.scheduleDraftSet(setId, new Date(rawTime).toISOString());
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    setBusy.value = null;
  }
}

const pendingCount = computed(() => Object.keys(office.state.pending_drafts ?? {}).length);
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <PageHeader
      sign="Whiteboard"
      title="Drafts"
      description="Posts, captions, sets and videos your agents made. Nothing goes out without you: approving posts it where it is connected (website, Facebook, Instagram, Threads, TikTok, YouTube Shorts), otherwise copy it out."
    >
      <RouterLink v-if="marketing" :to="{ path: '/jobs/new', query: { agent: marketing.slug } }" class="btn btn-primary shadow-sm">New brief for Social Manager</RouterLink>
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

    <div class="space-y-4">
      <template v-for="g in groups" :key="g.set_id ?? g.drafts[0]!.id">
        <!-- Multi-platform Post Set Card -->
        <section v-if="g.set_id" class="card overflow-hidden border-accent/30" :aria-label="`Set pos ${g.set_id}`">
          <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-2/40 px-4 py-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <Layers :size="15" class="text-accent shrink-0" />
                <span class="font-semibold text-sm text-fg">Set pos · {{ g.drafts.length }} platform</span>
                <span v-if="projectName(g.drafts[0]!.project_id)" class="chip chip-sm text-[11px]">{{ projectName(g.drafts[0]!.project_id) }}</span>
              </div>
              <div class="mt-0.5 font-mono text-[11px] text-muted">{{ g.set_id }}</div>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <input
                v-model="setSchedule[g.set_id]"
                type="datetime-local"
                class="input h-9 w-auto text-xs"
                :aria-label="`Jadual set ${g.set_id}`"
              />
              <button
                type="button"
                class="btn btn-sm min-h-9 gap-1.5"
                :disabled="setBusy === g.set_id || !setSchedule[g.set_id]"
                @click="scheduleSet(g.set_id)"
              >
                <CalendarClock :size="13" /> Jadualkan set
              </button>
              <button
                v-if="tab === 'pending'"
                type="button"
                class="btn btn-primary btn-sm min-h-9 gap-1.5"
                :disabled="setBusy === g.set_id"
                @click="decideSet(g.set_id, 'approve')"
              >
                <LoaderCircle v-if="setBusy === g.set_id" :size="13" class="animate-spin" />
                <CheckCheck v-else :size="13" />
                Lulus semua
              </button>
              <button
                v-if="tab === 'pending'"
                type="button"
                class="btn btn-sm min-h-9 gap-1 text-danger"
                :disabled="setBusy === g.set_id"
                @click="decideSet(g.set_id, 'reject')"
              >
                <X :size="13" /> Tolak
              </button>
            </div>
          </div>

          <!-- Platform tabs inside the set -->
          <div class="flex flex-wrap gap-1.5 border-b border-line bg-surface px-4 py-2" role="tablist">
            <button
              v-for="(d, idx) in g.drafts"
              :key="d.id"
              type="button"
              role="tab"
              class="rounded-lg px-2.5 py-1 text-xs font-medium transition-colors"
              :class="selectedDraft(g.set_id, g.drafts).id === d.id ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-muted hover:text-fg'"
              @click="activeSetTab[g.set_id] = d.id"
            >
              {{ tabLabel(d, idx, g.drafts) }}
            </button>
          </div>

          <div class="p-3 bg-sunken/30">
            <DraftCard
              :key="selectedDraft(g.set_id, g.drafts).id"
              :draft="selectedDraft(g.set_id, g.drafts)"
              :project-name="projectName(selectedDraft(g.set_id, g.drafts).project_id)"
              @decided="onDecided"
            />
          </div>
        </section>

        <!-- Standalone draft -->
        <DraftCard
          v-else
          :draft="g.drafts[0]!"
          :project-name="projectName(g.drafts[0]!.project_id)"
          @decided="onDecided"
        />
      </template>

      <div v-if="!drafts.length" class="card flex flex-col items-center justify-center p-12 text-center border-dashed">
        <div class="mb-3 flex size-12 items-center justify-center rounded-2xl border border-line bg-surface-2 text-muted shadow-sm">
          <FilePenLine :size="24" class="text-faint" />
        </div>
        <h3 class="font-semibold text-sm tracking-tight text-fg">{{ tab === "pending" ? "No drafts waiting" : "Nothing decided yet" }}</h3>
        <p class="mt-1 max-w-sm text-xs text-muted leading-relaxed">
          Give Pengurus Sosial or Marketing a job (weekly sets, captions, carousels, Reels, Stories, Shorts…) or chat with it.
        </p>
        <RouterLink to="/projects" class="mt-3 text-xs font-semibold text-accent hover:underline">Edit project briefs →</RouterLink>
      </div>
    </div>
  </div>
</template>
