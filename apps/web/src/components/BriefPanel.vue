<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { RouterLink } from "vue-router";
import { ExternalLink, Image, Plus, Sparkles, Trash2 } from "lucide-vue-next";
import { Platform, type ContentLanguage, type FeatureNote, type Project, type ProjectBriefInput } from "@agent-office/shared";
import SidePanel from "./SidePanel.vue";
import { api } from "../api/http.ts";
import { fmtDateTime } from "../format.ts";

/** Brief editor (projects/<slug>/brief.yaml) and the project's feature log. */
const props = defineProps<{ project: Project; tab?: "brief" | "features" }>();
const emit = defineEmits<{ close: [] }>();

const tab = ref<"brief" | "features">(props.tab ?? "brief");
const loaded = ref(false);
const exists = ref(false);
const path = ref("");
const example = ref<ProjectBriefInput | null>(null);
const error = ref("");
const saved = ref(false);
const busy = ref(false);

const PLATFORMS = Platform.options.filter((p) => p !== "general");
const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
  youtube: "YouTube",
  whatsapp: "WhatsApp",
  landing_page: "Landing page",
};
const LANGS: { value: ContentLanguage; label: string }[] = [
  { value: "manglish", label: "Manglish" },
  { value: "bahasa_melayu", label: "Bahasa Melayu" },
  { value: "english", label: "English" },
];

const form = reactive({
  project: "",
  one_liner: "",
  target: "",
  pain_point: "",
  pricing: "",
  location: "",
  call_to_action: "",
  facts: "",
  tone: "",
  platforms: [] as string[],
  languages: {} as Record<string, ContentLanguage>,
  do_not: "",
  good_examples: [] as string[],
  style_notes: "",
});

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

function fill(b: ProjectBriefInput) {
  Object.assign(form, {
    project: b.project ?? props.project.name,
    one_liner: b.one_liner ?? "",
    target: b.target ?? "",
    pain_point: b.pain_point ?? "",
    pricing: b.pricing ?? "",
    location: b.location ?? "",
    call_to_action: b.call_to_action ?? "",
    facts: (b.facts ?? []).join("\n"),
    tone: b.tone ?? "",
    platforms: [...(b.platforms ?? [])],
    languages: { ...(b.languages ?? {}) } as Record<string, ContentLanguage>,
    do_not: (b.do_not ?? []).join("\n"),
    good_examples: [...(b.good_examples ?? [])],
    style_notes: b.style_notes ?? "",
  });
}

onMounted(async () => {
  try {
    const r = await api.brief(props.project.id);
    exists.value = !!r.brief;
    path.value = r.path;
    example.value = r.example;
    fill(r.brief ?? { project: props.project.name });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loaded.value = true;
  }
  void loadFeatures();
});

function togglePlatform(p: string) {
  const i = form.platforms.indexOf(p);
  if (i >= 0) form.platforms.splice(i, 1);
  else {
    form.platforms.push(p);
    form.languages[p] ??= "manglish";
  }
}

async function save() {
  error.value = "";
  saved.value = false;
  busy.value = true;
  try {
    const languages = Object.fromEntries(form.platforms.filter((p) => form.languages[p]).map((p) => [p, form.languages[p]!]));
    await api.saveBrief(props.project.id, {
      project: form.project.trim() || props.project.name,
      one_liner: form.one_liner.trim(),
      target: form.target.trim(),
      pain_point: form.pain_point.trim(),
      pricing: form.pricing.trim(),
      location: form.location.trim(),
      call_to_action: form.call_to_action.trim(),
      facts: lines(form.facts),
      tone: form.tone.trim(),
      platforms: form.platforms as ProjectBriefInput["platforms"],
      languages,
      do_not: lines(form.do_not),
      good_examples: form.good_examples.map((e) => e.trim()).filter(Boolean),
      style_notes: form.style_notes.trim(),
    });
    exists.value = true;
    saved.value = true;
    setTimeout(() => (saved.value = false), 2500);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

// ---- feature log
const features = ref<FeatureNote[]>([]);
const note = reactive({ title: "", user_facing_note: "" });
const noteError = ref("");
const noteBusy = ref(false);
const loadFeatures = async () => (features.value = (await api.features(props.project.id)).features);
async function addNote() {
  noteError.value = "";
  noteBusy.value = true;
  try {
    await api.addFeature(props.project.id, { title: note.title, user_facing_note: note.user_facing_note });
    note.title = "";
    note.user_facing_note = "";
    await loadFeatures();
  } catch (e) {
    noteError.value = (e as Error).message;
  } finally {
    noteBusy.value = false;
  }
}
const artifactUrl = (p: string) => `/api/${p}`;
const briefIsEmpty = computed(() => !form.one_liner && !form.target && !form.pricing && !form.good_examples.length);
</script>

<template>
  <SidePanel :title="project.name" sign="Project" wide @close="emit('close')">
    <div class="mb-4 flex rounded-lg border border-line bg-surface p-0.5" role="tablist">
      <button role="tab" class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium" :class="tab === 'brief' ? 'bg-surface-2 text-fg' : 'text-muted'" :aria-selected="tab === 'brief'" @click="tab = 'brief'">Brief</button>
      <button role="tab" class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium" :class="tab === 'features' ? 'bg-surface-2 text-fg' : 'text-muted'" :aria-selected="tab === 'features'" @click="tab = 'features'">
        Feature log <span class="font-mono text-faint">{{ features.length }}</span>
      </button>
    </div>

    <!-- BRIEF -->
    <form v-if="tab === 'brief' && loaded" id="brief-form" class="space-y-5" @submit.prevent="save">
      <p class="text-sm text-muted">
        Everything Marketing knows about {{ project.name }}. It only states facts written here or in the feature log. Saved to <code>{{ path }}</code>.
      </p>
      <div v-if="!exists && briefIsEmpty && example" class="flex flex-wrap items-center gap-2 rounded-md bg-info-soft px-3 py-2 text-sm text-info">
        <Sparkles :size="15" /> New brief.
        <button type="button" class="font-medium underline" @click="fill({ ...example, project: project.name })">Start from the example (Sewa Kamera)</button>
      </div>

      <fieldset class="space-y-3">
        <legend class="sign mb-1">The product</legend>
        <div><label class="label" for="b-name">Name</label><input id="b-name" v-model="form.project" class="input" /></div>
        <div><label class="label" for="b-one">One line · what it is</label><input id="b-one" v-model="form.one_liner" class="input" maxlength="300" placeholder="Sewa kamera vlog + flash + tripod untuk content creator dan event" /></div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div><label class="label" for="b-target">Who it is for</label><textarea id="b-target" v-model="form.target" class="input min-h-16" maxlength="500" /></div>
          <div><label class="label" for="b-pain">Their problem</label><textarea id="b-pain" v-model="form.pain_point" class="input min-h-16" maxlength="500" /></div>
        </div>
      </fieldset>

      <fieldset class="space-y-3">
        <legend class="sign mb-1">Facts Marketing may use</legend>
        <div><label class="label" for="b-price">Prices</label><textarea id="b-price" v-model="form.pricing" class="input min-h-16" maxlength="1000" placeholder="RM80 sehari, RM200 3 hari, deposit RM300" /></div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div><label class="label" for="b-loc">Location</label><input id="b-loc" v-model="form.location" class="input" maxlength="300" placeholder="Shah Alam, pickup / COD Klang Valley" /></div>
          <div><label class="label" for="b-cta">Call to action</label><input id="b-cta" v-model="form.call_to_action" class="input" maxlength="300" placeholder="WhatsApp 012-345 6789" /></div>
        </div>
        <div><label class="label" for="b-facts">Other facts · one per line</label><textarea id="b-facts" v-model="form.facts" class="input min-h-20" placeholder="Set lengkap: Sony ZV-E10 + flash + tripod&#10;Free memory card 64GB" /></div>
      </fieldset>

      <fieldset class="space-y-3">
        <legend class="sign mb-1">Voice</legend>
        <div><label class="label" for="b-tone">Tone</label><input id="b-tone" v-model="form.tone" class="input" maxlength="300" placeholder="santai, Manglish, mesra, tak overclaim" /></div>
        <div>
          <span class="label">Platforms and language</span>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="p in PLATFORMS"
              :key="p"
              type="button"
              class="chip cursor-pointer px-2.5 py-1"
              :class="form.platforms.includes(p) ? 'border-accent bg-accent-soft text-accent' : 'hover:bg-surface-2'"
              :aria-pressed="form.platforms.includes(p)"
              @click="togglePlatform(p)"
            >
              {{ PLATFORM_LABEL[p] }}
            </button>
          </div>
          <div v-if="form.platforms.length" class="mt-2 grid gap-2 sm:grid-cols-2">
            <label v-for="p in form.platforms" :key="p" class="flex items-center gap-2 text-sm">
              <span class="w-24 shrink-0 text-muted">{{ PLATFORM_LABEL[p] }}</span>
              <select v-model="form.languages[p]" class="input">
                <option v-for="l in LANGS" :key="l.value" :value="l.value">{{ l.label }}</option>
              </select>
            </label>
          </div>
        </div>
        <div><label class="label" for="b-dont">Never say · one per line</label><textarea id="b-dont" v-model="form.do_not" class="input min-h-16" placeholder='guna "terbaik di Malaysia"&#10;janji benda yang tak boleh tunai' /></div>
        <p class="-mt-1 text-xs text-faint">Words in "quotes" are blocked word for word: Marketing cannot save a draft that contains them.</p>
      </fieldset>

      <fieldset class="space-y-3">
        <legend class="sign mb-1">Posts you like (style examples)</legend>
        <p class="text-xs text-muted">Paste 3–10 posts whose style you want: your own best posts or ones you admire. Marketing learns the style (hooks, rhythm, emoji, CTA); it is blocked from copying their sentences.</p>
        <div v-for="(_, i) in form.good_examples" :key="i" class="flex items-start gap-2">
          <textarea v-model="form.good_examples[i]" class="input min-h-20 text-[13px]" :aria-label="`Example post ${i + 1}`" />
          <button type="button" class="btn btn-ghost btn-sm" aria-label="Remove example" @click="form.good_examples.splice(i, 1)"><Trash2 :size="14" /></button>
        </div>
        <button type="button" class="btn btn-sm" :disabled="form.good_examples.length >= 20" @click="form.good_examples.push('')"><Plus :size="13" /> Add example post</button>
        <div>
          <label class="label" for="b-style">Style notes</label>
          <textarea id="b-style" v-model="form.style_notes" class="input min-h-28 text-[13px]" maxlength="6000" placeholder="Written by Marketing from the examples, or by you." />
          <p class="mt-1 text-xs text-faint">
            Let Marketing write these: give it a <b>Writing-style analysis</b> job (or ask in
            <RouterLink :to="{ path: '/chat', query: { agent: 'marketing' } }" class="text-accent hover:underline">Chat</RouterLink>). Approving that draft fills this box.
          </p>
        </div>
      </fieldset>
    </form>

    <!-- FEATURE LOG -->
    <div v-else-if="tab === 'features'" class="space-y-5">
      <p class="text-sm text-muted">
        What changed for customers, newest first. Coder adds a note after one of its pull requests is merged and CI passes. Each note asks Tester for a screenshot and Marketing for announcement drafts.
      </p>
      <form class="card space-y-3 p-3" @submit.prevent="addNote">
        <div class="sign">Add a note yourself</div>
        <input v-model="note.title" class="input" required minlength="3" maxlength="160" placeholder="Booking boleh pilih masa sendiri" aria-label="Title" />
        <textarea v-model="note.user_facing_note" class="input min-h-16" required minlength="10" maxlength="2000" placeholder="Plain words for customers: what they can do now." aria-label="Note" />
        <div class="flex items-center gap-2">
          <p v-if="noteError" class="min-w-0 flex-1 truncate text-sm text-danger">{{ noteError }}</p>
          <button class="btn btn-primary btn-sm ml-auto" :disabled="noteBusy">Release note</button>
        </div>
      </form>
      <ol class="space-y-3">
        <li v-for="f in features" :key="f.id" class="border-l-2 border-accent pl-3">
          <div class="flex flex-wrap items-baseline gap-2">
            <span class="font-medium">{{ f.title }}</span>
            <span class="text-xs text-faint">{{ fmtDateTime(f.released_at) }}</span>
            <span v-if="f.announced" class="chip text-[11px]">announced</span>
          </div>
          <p class="mt-0.5 text-sm text-muted">{{ f.user_facing_note }}</p>
          <div class="mt-1 flex gap-3 text-xs">
            <a v-if="f.source_pr_url" :href="f.source_pr_url" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-accent hover:underline"><ExternalLink :size="12" /> Pull request</a>
            <a v-if="f.screenshot_path" :href="artifactUrl(f.screenshot_path)" target="_blank" class="inline-flex items-center gap-1 text-accent hover:underline"><Image :size="12" /> Screenshot</a>
          </div>
        </li>
        <li v-if="!features.length" class="text-sm text-faint">No releases yet.</li>
      </ol>
    </div>

    <template v-if="tab === 'brief'" #footer>
      <p v-if="error" class="min-w-0 flex-1 truncate text-sm text-danger" :title="error">{{ error }}</p>
      <p v-else-if="saved" class="min-w-0 flex-1 text-sm text-accent">Saved.</p>
      <button type="button" class="btn ml-auto" @click="emit('close')">Close</button>
      <button form="brief-form" class="btn btn-primary" :disabled="busy">Save brief</button>
    </template>
  </SidePanel>
</template>
