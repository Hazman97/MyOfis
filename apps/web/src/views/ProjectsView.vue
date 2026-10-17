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
      <button class="btn btn-primary" @click="edit(null)"><Plus :size="16" /> New project</button>
    </PageHeader>

    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <article v-for="p in projects" :key="p.id" class="card flex flex-col p-4" :class="!p.enabled && 'opacity-60'">
        <div class="flex items-start gap-2">
          <div class="min-w-0 flex-1">
            <h2 class="truncate font-semibold">{{ p.name }}</h2>
            <p class="font-mono text-[11px] text-faint">{{ p.slug }}<template v-if="!p.enabled"> · off</template></p>
          </div>
          <button class="btn btn-sm" @click="edit(p)"><Pencil :size="13" /> Edit</button>
        </div>
        <dl class="mt-3 space-y-1.5 text-sm">
          <div class="flex min-w-0 items-center gap-2">
            <Globe :size="14" class="shrink-0 text-faint" />
            <a v-if="p.live_url" :href="p.live_url" target="_blank" rel="noopener noreferrer" class="truncate text-accent hover:underline">{{ host(p.live_url) }}</a>
            <span v-else class="text-faint">No live site</span>
          </div>
          <div class="flex min-w-0 items-center gap-2">
            <FolderGit2 :size="14" class="shrink-0 text-faint" />
            <span v-if="p.repo_url" class="truncate font-mono text-xs">{{ p.repo_url }}</span>
            <span v-else class="text-signal">No repo yet · Coder can't work here</span>
          </div>
        </dl>
        <div class="mt-4 flex gap-2 border-t border-line pt-3">
          <button class="btn btn-sm" @click="briefOf = { project: p, tab: 'brief' }">
            <FileText :size="13" /> Brief<span v-if="!p.brief_path" class="text-signal">· empty</span>
          </button>
          <button class="btn btn-sm" @click="briefOf = { project: p, tab: 'features' }"><ListChecks :size="13" /> Feature log</button>
        </div>
      </article>
      <div v-if="!projects.length" class="rounded-lg border border-dashed border-line px-6 py-10 text-center text-sm text-muted md:col-span-2 xl:col-span-3">
        No projects yet. Add ekadkahwin, Sewa Kamera, JomBelajar… with their live site and repo.
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
          <input id="pj-live" v-model="form.live_url" type="url" class="input font-mono" placeholder="https://…" />
          <p class="mt-1 text-xs text-faint">Tester opens this in a real browser every night.</p>
        </div>
        <div>
          <label class="label" for="pj-repo">Repo (Gitea clone URL)</label>
          <input id="pj-repo" v-model="form.repo_url" type="url" class="input font-mono" placeholder="https://git.example.com/owner/repo.git" />
          <p class="mt-1 text-xs text-faint">Coder clones this, works on a branch and opens a pull request.</p>
        </div>
        <label class="flex items-center gap-2 text-sm"><input v-model="form.enabled" type="checkbox" class="accent-accent" /> Enabled</label>
      </form>
      <template #footer>
        <p v-if="error" class="min-w-0 flex-1 truncate text-sm text-danger" :title="error">{{ error }}</p>
        <button type="button" class="btn ml-auto" @click="editing = null">Cancel</button>
        <button form="proj-form" class="btn btn-primary">Save</button>
      </template>
    </SidePanel>
  </div>
</template>
