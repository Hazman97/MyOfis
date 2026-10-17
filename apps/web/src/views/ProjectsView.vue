<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { FileText, FolderGit2, Globe, ListChecks, Pencil, Plus } from "lucide-vue-next";
import type { Project } from "@agent-office/shared";
import BriefPanel from "../components/BriefPanel.vue";
import PageHeader from "../components/PageHeader.vue";
import SidePanel from "../components/SidePanel.vue";
import { api } from "../api/http.ts";

const projects = ref<Project[]>([]);
const editing = ref<string | null>(null); // project id, "new", or null
const error = ref("");
const form = reactive({ slug: "", name: "", live_url: "", repo_url: "", enabled: true });
/** Project whose brief / feature log is open. */
const briefOf = ref<{ project: Project; tab: "brief" | "features" } | null>(null);

const load = async () => (projects.value = (await api.projects()).projects);
onMounted(load);

function edit(p: Project | null) {
  error.value = "";
  Object.assign(form, p ? { ...p, live_url: p.live_url ?? "", repo_url: p.repo_url ?? "" } : { slug: "", name: "", live_url: "", repo_url: "", enabled: true });
  editing.value = p?.id ?? "new";
}

async function save() {
  error.value = "";
  try {
    const { slug, ...rest } = form;
    if (editing.value === "new") await api.createProject({ ...rest, slug });
    else await api.updateProject(editing.value!, rest);
    editing.value = null;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
const host = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};
</script>

<template>
  <div>
    <PageHeader sign="Work" title="Projects" description="Your products. Tester checks each live site, Coder works in each repo, Marketing writes from each brief.">
      <button class="btn btn-primary shadow-sm" @click="edit(null)"><Plus :size="16" /> New project</button>
    </PageHeader>

    <div class="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="p in projects"
        :key="p.id"
        class="card flex flex-col p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card"
        :class="!p.enabled && 'opacity-65'"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <h2 class="truncate font-semibold text-base tracking-tight text-fg">{{ p.name }}</h2>
              <span v-if="!p.enabled" class="chip text-[10px] px-1.5 py-0 border-line text-faint">off</span>
            </div>
            <p class="font-mono text-[11px] text-faint">{{ p.slug }}</p>
          </div>
          <button class="btn btn-ghost btn-sm size-8 p-0 text-muted hover:text-fg" aria-label="Edit project" title="Edit project" @click="edit(p)">
            <Pencil :size="13" />
          </button>
        </div>

        <dl class="mt-3.5 space-y-2 text-xs">
          <!-- Live site -->
          <div class="flex min-w-0 items-center gap-2 rounded-lg border border-line/60 bg-surface-2/40 px-2.5 py-1.5">
            <Globe :size="13" class="shrink-0 text-faint" />
            <a v-if="p.live_url" :href="p.live_url" target="_blank" rel="noopener noreferrer" class="truncate font-medium text-accent hover:underline">
              {{ host(p.live_url) }}
            </a>
            <span v-else class="text-faint">No live site configured</span>
          </div>

          <!-- Repo -->
          <div class="flex min-w-0 items-center gap-2 rounded-lg border border-line/60 bg-surface-2/40 px-2.5 py-1.5">
            <FolderGit2 :size="13" class="shrink-0 text-faint" />
            <span v-if="p.repo_url" class="truncate font-mono text-[11px] text-fg">{{ p.repo_url }}</span>
            <span v-else class="text-amber-500 font-medium">No repo yet · Coder can't work</span>
          </div>

          <!-- Brief status badge -->
          <div class="flex items-center justify-between px-0.5 pt-1">
            <span class="sign text-[9px]">Brief status</span>
            <span v-if="!p.brief_path" class="chip border-amber-500/40 bg-amber-500/10 text-amber-500 font-semibold text-[10px]">
              Brief · empty
            </span>
            <span v-else class="chip border-accent/40 bg-accent/10 text-accent font-medium text-[10px]">
              Brief configured
            </span>
          </div>
        </dl>

        <!-- Neat card footer -->
        <div class="mt-4 flex items-center gap-2 border-t border-line pt-3">
          <button
            class="btn btn-sm flex-1"
            :class="!p.brief_path ? 'border-amber-500/40 text-amber-500 hover:bg-amber-500/10' : ''"
            @click="briefOf = { project: p, tab: 'brief' }"
          >
            <FileText :size="13" /> Brief
            <span v-if="!p.brief_path" class="text-[10px] font-bold">· to-do</span>
          </button>
          <button class="btn btn-sm flex-1" @click="briefOf = { project: p, tab: 'features' }">
            <ListChecks :size="13" /> Feature log
          </button>
        </div>
      </article>

      <!-- Empty state -->
      <div v-if="!projects.length" class="card flex flex-col items-center justify-center border-dashed p-12 text-center text-xs text-muted md:col-span-2 xl:col-span-3">
        <FolderGit2 :size="28" class="text-faint mb-2" :stroke-width="1.5" />
        <p class="font-semibold text-sm text-fg">No projects yet</p>
        <p class="mt-1 max-w-sm text-muted">
          Add your products (ekadkahwin, Sewa Kamera, JomBelajar…) with their live site and repo.
        </p>
        <button class="btn btn-primary btn-sm mt-4 shadow-sm" @click="edit(null)">
          <Plus :size="14" /> New project
        </button>
      </div>
    </div>

    <BriefPanel v-if="briefOf" :key="briefOf.project.id + briefOf.tab" :project="briefOf.project" :tab="briefOf.tab" @close="briefOf = null; load()" />

    <SidePanel v-if="editing" :sign="editing === 'new' ? 'New project' : 'Edit project'" :title="form.name || 'Project'" @close="editing = null">
      <form id="proj-form" class="space-y-4" @submit.prevent="save">
        <div class="grid gap-3 sm:grid-cols-2">
          <div><label class="label" for="pj-name">Name</label><input id="pj-name" v-model="form.name" class="input" required /></div>
          <div>
            <label class="label" for="pj-slug">Slug</label>
            <input id="pj-slug" v-model="form.slug" class="input font-mono" :disabled="editing !== 'new'" pattern="[a-z0-9][a-z0-9\-]*" required />
          </div>
        </div>
        <div>
          <label class="label" for="pj-live">Live site</label>
          <input id="pj-live" v-model="form.live_url" type="url" class="input font-mono text-xs" placeholder="https://…" />
          <p class="mt-1 text-xs text-faint">Tester opens this in a real browser every night.</p>
        </div>
        <div>
          <label class="label" for="pj-repo">Repo (Gitea clone URL)</label>
          <input id="pj-repo" v-model="form.repo_url" type="url" class="input font-mono text-xs" placeholder="https://git.example.com/owner/repo.git" />
          <p class="mt-1 text-xs text-faint">Coder clones this, works on a branch and opens a pull request.</p>
        </div>
        <label class="flex items-center gap-2 text-xs font-medium cursor-pointer"><input v-model="form.enabled" type="checkbox" class="accent-accent" /> Enabled</label>
      </form>
      <template #footer>
        <p v-if="error" class="min-w-0 flex-1 truncate text-xs text-danger" :title="error">{{ error }}</p>
        <button type="button" class="btn ml-auto" @click="editing = null">Cancel</button>
        <button form="proj-form" class="btn btn-primary shadow-sm">Save</button>
      </template>
    </SidePanel>
  </div>
</template>
