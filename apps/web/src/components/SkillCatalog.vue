<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Download, ExternalLink, LoaderCircle, RefreshCw, Search } from "lucide-vue-next";
import { api, type CatalogSkill } from "../api/http.ts";

/** Popular public skills (Anthropic, Hermes Agent): search, read, install with one click. */
const props = defineProps<{ installed: string[] }>();
const emit = defineEmits<{ installed: [] }>();

const skills = ref<CatalogSkill[]>([]);
const updatedAt = ref<string | null>(null);
const loading = ref(false);
const error = ref("");
const q = ref("");
const source = ref<"all" | "anthropic" | "hermes">("all");
const category = ref("");
const busy = ref<string | null>(null);
const notes = ref<Record<string, string[]>>({});

async function load(refresh = false) {
  loading.value = true;
  error.value = "";
  try {
    const r = await api.skillCatalog(refresh);
    skills.value = r.skills;
    updatedAt.value = r.updated_at;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(() => load());

const categories = computed(() => [...new Set(skills.value.filter((s) => source.value === "all" || s.source === source.value).map((s) => s.category))].sort());
const shown = computed(() => {
  const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
  return skills.value
    .filter((s) => (source.value === "all" || s.source === source.value) && (!category.value || s.category === category.value))
    .filter((s) => words.every((w) => `${s.name} ${s.description} ${s.category}`.toLowerCase().includes(w)))
    .slice(0, 120);
});
const isInstalled = (s: CatalogSkill) => props.installed.includes(s.name);

async function install(s: CatalogSkill) {
  busy.value = s.path;
  error.value = "";
  try {
    const r = await api.installCatalogSkill(s.source, s.path);
    notes.value = { ...notes.value, [s.path]: r.warnings };
    emit("installed");
  } catch (e) {
    error.value = `${s.name}: ${(e as Error).message}`;
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <section class="space-y-3" aria-label="Browse public skills">
    <p class="text-xs text-muted">
      Skills other people already use, from <b>Anthropic</b> (official) and <b>Hermes Agent</b> (Nous Research). Installing copies the SKILL.md into your library; your agents can then
      load it with skill_view. Read a skill before installing: it is advice your agents will follow.
    </p>

    <div class="flex flex-wrap items-center gap-2">
      <div class="relative min-w-48 flex-1">
        <Search :size="14" class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
        <input v-model="q" type="search" class="input pl-8 text-sm" placeholder="Search: social media, pdf, video, research…" aria-label="Search skills" />
      </div>
      <select v-model="source" class="input w-auto text-xs" aria-label="Source" @change="category = ''">
        <option value="all">All sources</option>
        <option value="anthropic">Anthropic</option>
        <option value="hermes">Hermes Agent</option>
      </select>
      <select v-model="category" class="input w-auto text-xs" aria-label="Category">
        <option value="">All categories</option>
        <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
      </select>
      <button class="btn btn-sm" :disabled="loading" title="Reload the catalogue from GitHub" aria-label="Reload the catalogue" @click="load(true)">
        <component :is="loading ? LoaderCircle : RefreshCw" :size="13" :class="loading && 'motion-safe:animate-spin'" />
      </button>
    </div>

    <p v-if="error" class="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">{{ error }}</p>
    <p v-if="loading && !skills.length" class="text-xs text-muted">Loading the catalogue from GitHub (the first time takes about 20 seconds)…</p>
    <p v-else class="text-[11px] text-faint">{{ shown.length }} of {{ skills.length }} skills{{ updatedAt ? ` · updated ${new Date(updatedAt).toLocaleDateString()}` : "" }}</p>

    <ul class="space-y-2">
      <li v-for="s in shown" :key="s.path" class="card p-3">
        <div class="flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="font-mono text-sm font-semibold">{{ s.name }}</span>
              <span class="chip text-[10px]">{{ s.source === "anthropic" ? "Anthropic" : "Hermes" }}</span>
              <span class="chip text-[10px] text-muted">{{ s.category }}</span>
              <span class="chip text-[10px]" :class="s.open_license ? 'text-muted' : 'border-signal/40 text-signal'" :title="s.open_license ? 'Open licence' : 'Limited licence: check the terms before using it'">
                {{ s.license }}
              </span>
            </div>
            <p class="mt-1 text-xs text-muted">{{ s.description }}</p>
            <p v-if="s.has_extra_files" class="mt-1 text-[11px] text-faint">Comes with scripts or reference files that are not installed (only the SKILL.md is).</p>
            <ul v-if="notes[s.path]?.length" class="mt-1.5 space-y-1">
              <li v-for="n in notes[s.path]" :key="n" class="rounded-md border border-signal/30 bg-signal-soft px-2 py-1 text-[11px] text-signal">⚠ {{ n }}</li>
            </ul>
          </div>
          <div class="flex shrink-0 flex-col items-end gap-1.5">
            <span v-if="isInstalled(s)" class="text-xs font-medium text-accent">Installed</span>
            <button v-else class="btn btn-sm btn-primary" :disabled="busy === s.path" @click="install(s)">
              <component :is="busy === s.path ? LoaderCircle : Download" :size="13" :class="busy === s.path && 'motion-safe:animate-spin'" /> Install
            </button>
            <a :href="s.url" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-[11px] text-muted hover:text-fg">Read <ExternalLink :size="11" /></a>
          </div>
        </div>
      </li>
    </ul>
  </section>
</template>
