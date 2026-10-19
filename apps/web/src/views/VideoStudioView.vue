<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { ArrowDown, ArrowLeft, ArrowUp, Clapperboard, Download, LoaderCircle, Plus, RotateCcw, Scissors, Trash2, Type, Upload, Wand2 } from "lucide-vue-next";
import { EditPlan } from "@agent-office/shared";
import PageHeader from "../components/PageHeader.vue";
import { api, type VideoInfo } from "../api/http.ts";
import { useOffice } from "../stores/office.ts";
import { fmtDateTime } from "../format.ts";
import { openInOpenCut } from "../opencut.ts";

/**
 * Video Studio (owner request): see how a video was edited (clips, captions, settings), change it
 * and render again on the runner PC without the AI. Heavy manual edits go to OpenCut; the export
 * comes back with "Use my own edit". `?draft=` = the draft this video belongs to (it gets the new video).
 */
const props = defineProps<{ id: string }>();
const route = useRoute();
const router = useRouter();
const office = useOffice();

const info = ref<VideoInfo | null>(null);
const error = ref("");
const msg = ref("");
const busy = ref(false);
const uploadPct = ref<number | null>(null);
const jobId = ref<string | null>(null);
/** The plan being edited (a copy of the video's plan). */
const plan = reactive<EditPlan>(EditPlan.parse({ clips: [{ video: 1 }] }));
/** Source clip lengths in seconds, read from the browser's video metadata. */
const durations = reactive<Record<string, number>>({});

const draftId = computed(() => (typeof route.query.draft === "string" ? route.query.draft : (info.value?.drafts.find((d) => d.status === "draft")?.id ?? null)));
const sources = computed(() => info.value?.render.attachments ?? []);
const videoSources = computed(() => sources.value.map((s, i) => ({ ...s, n: i + 1 })).filter((s) => s.content_type.startsWith("video/")));

async function load() {
  error.value = "";
  try {
    info.value = await api.video(props.id);
    resetPlan();
    if (info.value.last_render_job && ["queued", "running"].includes(info.value.last_render_job.status)) jobId.value = info.value.last_render_job.id;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function resetPlan() {
  if (!info.value) return;
  Object.assign(plan, JSON.parse(JSON.stringify(info.value.render.plan)) as EditPlan);
}
watch(() => props.id, load, { immediate: true });

function onMeta(id: string, e: Event) {
  const d = (e.target as HTMLVideoElement).duration;
  if (Number.isFinite(d)) durations[id] = Math.round(d * 100) / 100;
}

// ---------------------------------------------------------------- timeline
const clipLen = (c: EditPlan["clips"][number]) => {
  const src = sources.value[c.video - 1];
  const full = src ? durations[src.id] : undefined;
  const end = c.end ?? full;
  return end === undefined ? null : Math.max(0, (end - c.start) / c.speed);
};
const lengths = computed(() => plan.clips.map(clipLen));
const total = computed(() => (lengths.value.every((l) => l !== null) ? Math.round(lengths.value.reduce<number>((a, b) => a + (b ?? 0), 0) * 10) / 10 : null));
const preset = computed(() => info.value?.presets[plan.preset]);
const tooLong = computed(() => total.value !== null && !!preset.value && total.value > preset.value.max_seconds);
const COLORS = ["bg-accent/70", "bg-info/70", "bg-review/70", "bg-signal/70", "bg-danger/60"];

function addClip() {
  plan.clips.push({ video: videoSources.value[0]?.n ?? 1, start: 0, speed: 1 });
}
function moveClip(i: number, d: -1 | 1) {
  const j = i + d;
  if (j < 0 || j >= plan.clips.length) return;
  [plan.clips[i], plan.clips[j]] = [plan.clips[j]!, plan.clips[i]!];
}
function addCaption() {
  const start = plan.captions.at(-1)?.end ?? 0;
  plan.captions.push({ text: "", start, end: start + 2, position: "bottom" });
}
const num = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : Number(v));

// ---------------------------------------------------------------- render again
const job = computed(() => (jobId.value ? office.state.jobs[jobId.value] : undefined));
const jobAgent = computed(() => (job.value ? office.state.agents[job.value.agent_id] : undefined));
const rendering = computed(() => !!job.value && ["queued", "running"].includes(job.value.status));
watch(
  () => job.value?.status,
  async (s) => {
    if (s === "done") {
      const fresh = await api.video(props.id);
      const made = fresh.last_render_job?.result_upload_id;
      jobId.value = null;
      msg.value = "Rendered. Opening the new video…";
      if (made) await router.push({ name: "studio", params: { id: made }, query: draftId.value ? { draft: draftId.value } : {} });
    } else if (s === "failed" || s === "cancelled") {
      error.value = `The render ${s}. Open the job for details.`;
    }
  },
);

async function renderAgain() {
  error.value = msg.value = "";
  const parsed = EditPlan.safeParse({ ...plan, captions: plan.captions.filter((c) => c.text.trim()) });
  if (!parsed.success) {
    error.value = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return;
  }
  if (tooLong.value) {
    error.value = `${preset.value!.label} takes at most ${preset.value!.max_seconds} s; this edit is ${total.value} s.`;
    return;
  }
  busy.value = true;
  try {
    jobId.value = (await api.renderVideo(props.id, parsed.data, draftId.value)).job.id;
    msg.value = "Rendering on the runner PC (no AI)…";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

// ---------------------------------------------------------------- own edit (OpenCut export)
const ownInput = ref<HTMLInputElement>();
async function useOwnEdit(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  error.value = msg.value = "";
  uploadPct.value = 0;
  try {
    const up = await api.uploadVideo(file, (d) => (uploadPct.value = Math.round(d * 100)));
    if (draftId.value) await api.setDraftVideo(draftId.value, up.id);
    msg.value = draftId.value ? "Your edit is now the draft's video." : "Uploaded.";
    await router.push({ name: "studio", params: { id: up.id }, query: draftId.value ? { draft: draftId.value } : {} });
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    uploadPct.value = null;
  }
}
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <RouterLink to="/drafts" class="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft :size="15" /> Drafts</RouterLink>
    <PageHeader sign="Video Studio" :title="info?.upload.name ?? 'Video'" description="See how this video was edited, change it and render it again on your PC (no AI, no tokens). For heavy edits use OpenCut, then bring the export back here." />

    <p v-if="error" class="mb-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{{ error }}</p>
    <p v-if="msg" class="mb-3 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent" role="status">{{ msg }}</p>

    <div v-if="info" class="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <!-- preview + actions -->
      <section id="preview" class="space-y-3">
        <div class="card overflow-hidden p-2">
          <video :key="info.upload.id" :src="api.uploadUrl(info.upload.id)" controls playsinline preload="metadata" class="mx-auto max-h-[70vh] w-full rounded-lg bg-black" aria-label="Video preview" />
        </div>
        <div class="flex flex-wrap gap-2">
          <a :href="api.uploadUrl(info.upload.id, true)" class="btn btn-sm" download><Download :size="14" /> Download</a>
          <button type="button" class="btn btn-sm" @click="openInOpenCut(info.upload.id, info.upload.name)"><Scissors :size="14" /> Edit fully in OpenCut</button>
          <label class="btn btn-sm cursor-pointer" :class="uploadPct !== null && 'opacity-60'">
            <input ref="ownInput" type="file" accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mkv,.m4v" class="hidden" :disabled="uploadPct !== null" @change="useOwnEdit" />
            <Upload :size="14" /> {{ uploadPct === null ? "Use my own edit" : `Uploading ${uploadPct}%` }}
          </label>
        </div>
        <p class="text-xs text-muted">
          OpenCut opens in a new tab and the video downloads: drag it into OpenCut, edit, export, then press <b>Use my own edit</b>.
        </p>
        <div class="card space-y-1 p-3 text-xs text-muted">
          <p>{{ Math.round(info.upload.size / 1024 / 102.4) / 10 }} MB · made {{ fmtDateTime(info.upload.created_at) }}</p>
          <p v-if="!info.known">This is your own clip: the plan below starts from the whole video.</p>
          <p v-for="d in info.drafts" :key="d.id">
            Draft: <RouterLink to="/drafts" class="text-accent hover:underline">{{ d.title }}</RouterLink> · {{ d.platform }} · {{ d.status }}
          </p>
        </div>
        <!-- hidden: read each source clip's length for the timeline -->
        <video v-for="s in videoSources" :key="s.id" :src="api.uploadUrl(s.id)" preload="metadata" class="hidden" muted @loadedmetadata="onMeta(s.id, $event)" />
      </section>

      <!-- the edit -->
      <section id="edit" class="space-y-4">
        <!-- timeline -->
        <div class="card p-4">
          <div class="mb-2 flex items-center justify-between gap-2">
            <h2 class="flex items-center gap-2 font-semibold"><Clapperboard :size="17" class="text-accent" /> Timeline</h2>
            <span class="text-xs tabular-nums" :class="tooLong ? 'text-danger' : 'text-muted'">{{ total === null ? "…" : `${total} s` }}{{ preset ? ` / max ${preset.max_seconds} s` : "" }}</span>
          </div>
          <div class="flex h-10 w-full overflow-hidden rounded-md border border-line bg-sunken" aria-label="Clips in order">
            <div
              v-for="(c, i) in plan.clips"
              :key="i"
              class="flex min-w-6 items-center justify-center border-r border-bg text-[11px] font-medium text-white"
              :class="COLORS[(c.video - 1) % COLORS.length]"
              :style="{ flexGrow: lengths[i] ?? 1 }"
              :title="`Clip ${i + 1}: file ${c.video}, ${c.start}s → ${c.end ?? 'end'}${c.speed !== 1 ? `, ${c.speed}×` : ''}`"
            >
              {{ i + 1 }}
            </div>
          </div>
          <div v-if="total" class="relative mt-1 h-5" aria-label="Captions on the timeline">
            <div
              v-for="(cap, i) in plan.captions"
              :key="i"
              class="absolute top-0 h-4 overflow-hidden rounded bg-fg/15 px-1 text-[10px] leading-4 whitespace-nowrap"
              :style="{ left: `${Math.min(100, (cap.start / total) * 100)}%`, width: `${Math.max(2, ((Math.min(cap.end, total) - cap.start) / total) * 100)}%` }"
              :title="cap.text"
            >
              {{ cap.text }}
            </div>
          </div>
        </div>

        <!-- clips -->
        <div class="card space-y-2 p-4">
          <div class="flex items-center justify-between">
            <h2 class="flex items-center gap-2 font-semibold"><Scissors :size="17" class="text-accent" /> Clips</h2>
            <button type="button" class="btn btn-sm" :disabled="plan.clips.length >= 20" @click="addClip"><Plus :size="14" /> Clip</button>
          </div>
          <div v-for="(c, i) in plan.clips" :key="i" class="grid grid-cols-2 items-end gap-2 rounded-lg border border-line p-2 sm:grid-cols-[auto_1fr_5rem_5rem_5rem_auto]">
            <span class="self-center font-mono text-xs text-muted">#{{ i + 1 }}</span>
            <label class="col-span-2 sm:col-span-1">
              <span class="label">File</span>
              <select v-model.number="c.video" class="input text-sm">
                <option v-for="s in videoSources" :key="s.id" :value="s.n">{{ s.n }}. {{ s.name }}{{ durations[s.id] ? ` (${durations[s.id]} s)` : "" }}</option>
              </select>
            </label>
            <label><span class="label">Start s</span><input v-model.number="c.start" type="number" min="0" step="0.1" class="input text-sm" /></label>
            <label>
              <span class="label">End s</span>
              <input :value="c.end ?? ''" type="number" min="0" step="0.1" class="input text-sm" placeholder="end" @input="c.end = num(($event.target as HTMLInputElement).value)" />
            </label>
            <label>
              <span class="label">Speed</span>
              <select v-model.number="c.speed" class="input text-sm">
                <option :value="0.5">0.5× slow</option>
                <option :value="0.75">0.75×</option>
                <option :value="1">1×</option>
                <option :value="1.5">1.5×</option>
                <option :value="2">2×</option>
              </select>
            </label>
            <div class="flex gap-1">
              <button type="button" class="btn btn-sm btn-ghost px-2" :disabled="i === 0" aria-label="Move up" @click="moveClip(i, -1)"><ArrowUp :size="14" /></button>
              <button type="button" class="btn btn-sm btn-ghost px-2" :disabled="i === plan.clips.length - 1" aria-label="Move down" @click="moveClip(i, 1)"><ArrowDown :size="14" /></button>
              <button type="button" class="btn btn-sm btn-ghost px-2 text-danger" :disabled="plan.clips.length === 1" aria-label="Remove clip" @click="plan.clips.splice(i, 1)"><Trash2 :size="14" /></button>
            </div>
          </div>
        </div>

        <!-- captions -->
        <div class="card space-y-2 p-4">
          <div class="flex items-center justify-between">
            <h2 class="flex items-center gap-2 font-semibold"><Type :size="17" class="text-accent" /> Captions</h2>
            <button type="button" class="btn btn-sm" :disabled="plan.captions.length >= 40" @click="addCaption"><Plus :size="14" /> Caption</button>
          </div>
          <p v-if="!plan.captions.length" class="text-xs text-muted">No text on the video. Times are in the finished video.</p>
          <div v-for="(cap, i) in plan.captions" :key="i" class="grid grid-cols-2 items-end gap-2 rounded-lg border border-line p-2 sm:grid-cols-[1fr_4.5rem_4.5rem_6.5rem_auto]">
            <label class="col-span-2 sm:col-span-1"><span class="label">Text</span><input v-model="cap.text" maxlength="200" class="input text-sm" placeholder="Tournament Sabtu ni!" /></label>
            <label><span class="label">From s</span><input v-model.number="cap.start" type="number" min="0" step="0.1" class="input text-sm" /></label>
            <label><span class="label">To s</span><input v-model.number="cap.end" type="number" min="0" step="0.1" class="input text-sm" /></label>
            <label>
              <span class="label">Where</span>
              <select v-model="cap.position" class="input text-sm"><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select>
            </label>
            <button type="button" class="btn btn-sm btn-ghost px-2 text-danger" aria-label="Remove caption" @click="plan.captions.splice(i, 1)"><Trash2 :size="14" /></button>
          </div>
        </div>

        <!-- settings -->
        <div class="card grid gap-3 p-4 sm:grid-cols-2">
          <label>
            <span class="label">Format</span>
            <select v-model="plan.preset" class="input text-sm"><option v-for="(p, id) in info.presets" :key="id" :value="id">{{ p.label }}</option></select>
          </label>
          <label>
            <span class="label">Fit</span>
            <select v-model="plan.fit" class="input text-sm">
              <option value="crop">Crop: fill the screen</option>
              <option value="blur">Blur: whole picture on a blurred copy</option>
              <option value="pad">Pad: whole picture on black</option>
            </select>
          </label>
          <label>
            <span class="label">Frame rate</span>
            <select v-model.number="plan.fps" class="input text-sm"><option v-for="f in [24, 25, 30, 50, 60]" :key="f" :value="f">{{ f }} fps</option></select>
          </label>
          <label><span class="label">File name</span><input v-model="plan.name" maxlength="60" class="input text-sm" /></label>
          <label class="flex items-center gap-2 text-sm"><input v-model="plan.mute" type="checkbox" class="accent-accent" /> Mute the original sound</label>
          <label class="flex items-center gap-2 text-sm"><input v-model="plan.normalize_audio" type="checkbox" class="accent-accent" /> Even loudness (−14 LUFS)</label>
        </div>

        <!-- render -->
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="btn btn-primary" :disabled="busy || rendering || tooLong" @click="renderAgain">
            <LoaderCircle v-if="busy || rendering" :size="16" class="animate-spin" /><Wand2 v-else :size="16" />
            {{ rendering ? (jobAgent?.thinking ?? "Rendering…") : "Render again" }}
          </button>
          <button type="button" class="btn btn-ghost" :disabled="rendering" @click="resetPlan"><RotateCcw :size="15" /> Undo changes</button>
          <span v-if="draftId" class="text-xs text-muted">The draft switches to the new video when it is done.</span>
        </div>
      </section>
    </div>
    <p v-else-if="!error" class="text-sm text-muted">Loading…</p>
  </div>
</template>
