<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  AudioLines,
  Bot,
  Clapperboard,
  Clock,
  Download,
  Film,
  Layers,
  LoaderCircle,
  Plus,
  RotateCcw,
  Scissors,
  Settings2,
  Subtitles as SubtitlesIcon,
  Trash2,
  Type,
  Upload,
  Wand2,
  X,
} from "lucide-vue-next";
import {
  EditPlan,
  isFiller,
  subtitleCues,
  tightCuts,
  type EditSuggestion,
  type Transcript,
} from "@agent-office/shared";
import PageHeader from "../components/PageHeader.vue";
import EditSuggestionCards from "../components/EditSuggestionCards.vue";
import TranscriptPanel from "../components/studio/TranscriptPanel.vue";
import AskEditorPanel from "../components/studio/AskEditorPanel.vue";
import { api, type VideoInfo } from "../api/http.ts";
import { useOffice } from "../stores/office.ts";
import { fmtDateTime } from "../format.ts";
import { openInOpenCut } from "../opencut.ts";

/**
 * Video Studio (Task 015):
 * Inspect how a video was edited, polish with whisper transcripts, drop pauses (tight cut),
 * toggle/customize subtitles with live player overlay, and ask Editor for creative edit suggestions.
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
const transcribeJobId = ref<string | null>(null);
const transcribing = ref(false);
const askEditorOpen = ref(false);
const playerCurrentTime = ref(0);

/** The plan being edited (a copy of the video's plan). */
const plan = reactive<EditPlan>(EditPlan.parse({ clips: [{ video: 1 }] }));
/** Source clip lengths in seconds, read from the browser's video metadata. */
const durations = reactive<Record<string, number>>({});

const previewVideo = ref<HTMLVideoElement | null>(null);
const selectedClipIndex = ref<number | null>(null);
const selectedCaptionIndex = ref<number | null>(null);

const draftId = computed(() =>
  typeof route.query.draft === "string"
    ? route.query.draft
    : (info.value?.drafts.find((d) => d.status === "draft")?.id ?? null),
);
const sources = computed(() => info.value?.render.attachments ?? []);
const videoSources = computed(() =>
  sources.value
    .map((s, i) => ({ ...s, n: i + 1 }))
    .filter((s) => s.content_type.startsWith("video/")),
);

const firstVideoTranscript = computed<Transcript | null>(() => {
  const first = videoSources.value[0];
  if (!first) return null;
  return (info.value?.transcripts ?? {})[first.id] ?? null;
});

const transcriptsByNumber = computed(() => {
  const res: Record<number, Transcript | undefined> = {};
  const atts = info.value?.render?.attachments ?? [];
  atts.forEach((a, i) => {
    const t = (info.value?.transcripts ?? {})[a.id];
    if (t) res[i + 1] = t;
  });
  return res;
});

// the player shows this upload: a source file (your own clip) plays in source time, a render in finished time
const playerSource = computed(() => (info.value ? info.value.render.attachments.findIndex((a) => a.id === info.value!.upload.id) + 1 : 0));
const allSubtitleCues = computed(() => {
  if (!plan.subtitles) return [];
  if (playerSource.value) return subtitleCues({ clips: [{ video: playerSource.value, start: 0, speed: 1, zoom: "none" }], subtitles: plan.subtitles }, transcriptsByNumber.value, durations);
  return subtitleCues(plan, transcriptsByNumber.value, durations);
});

const activeCue = computed(() => {
  const t = playerCurrentTime.value;
  return allSubtitleCues.value.find((c) => c.start <= t && t <= c.end) ?? null;
});

async function load() {
  error.value = "";
  try {
    info.value = await api.video(props.id);
    resetPlan();
    if (info.value.last_render_job && ["queued", "running"].includes(info.value.last_render_job.status)) {
      jobId.value = info.value.last_render_job.id;
    }
    if (info.value.transcribe_job && ["queued", "running"].includes(info.value.transcribe_job.status)) {
      transcribeJobId.value = info.value.transcribe_job.id;
      transcribing.value = true;
    }
  } catch (e) {
    error.value = (e as Error).message;
  }
}

function resetPlan() {
  if (!info.value) return;
  const p = JSON.parse(JSON.stringify(info.value.render.plan)) as EditPlan;
  if (!p.subtitles) p.subtitles = null;
  Object.assign(plan, p);
  selectedClipIndex.value = null;
  selectedCaptionIndex.value = null;
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
const total = computed(() =>
  lengths.value.every((l) => l !== null)
    ? Math.round(lengths.value.reduce<number>((a, b) => a + (b ?? 0), 0) * 10) / 10
    : null,
);
const preset = computed(() => info.value?.presets[plan.preset]);
const tooLong = computed(() => total.value !== null && !!preset.value && total.value > preset.value.max_seconds);
const COLORS = ["bg-accent/70", "bg-info/70", "bg-review/70", "bg-signal/70", "bg-danger/60"];

const isEdited = computed(() => {
  if (!info.value?.render?.plan) return false;
  return JSON.stringify(plan) !== JSON.stringify(info.value.render.plan);
});

const aspectClass = computed(() => {
  if (plan.preset === "youtube_1080p") return "aspect-video w-full max-h-[62vh]";
  if (plan.preset === "square") return "aspect-square max-w-[400px] max-h-[62vh] mx-auto";
  return "aspect-[9/16] max-w-[340px] max-h-[62vh] mx-auto";
});

function selectClip(i: number) {
  selectedClipIndex.value = i;
  nextTick(() => {
    const el = document.getElementById(`clip-row-${i}`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

function selectCaption(i: number) {
  selectedCaptionIndex.value = i;
  nextTick(() => {
    const el = document.getElementById(`caption-row-${i}`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

function setClipStartFromPlayer(clip: EditPlan["clips"][number]) {
  const t = previewVideo.value?.currentTime ?? 0;
  clip.start = Math.max(0, Math.round(t * 10) / 10);
}

function setClipEndFromPlayer(clip: EditPlan["clips"][number]) {
  const t = previewVideo.value?.currentTime ?? 0;
  clip.end = t > 0 ? Math.round(t * 10) / 10 : undefined;
}

function addClip() {
  plan.clips.push({ video: videoSources.value[0]?.n ?? 1, start: 0, speed: 1, zoom: "none" });
  selectClip(plan.clips.length - 1);
}

function moveClip(i: number, d: -1 | 1) {
  const j = i + d;
  if (j < 0 || j >= plan.clips.length) return;
  [plan.clips[i], plan.clips[j]] = [plan.clips[j]!, plan.clips[i]!];
  selectedClipIndex.value = j;
}

function addCaption() {
  const start = plan.captions.at(-1)?.end ?? 0;
  plan.captions.push({ text: "", start, end: start + 2, position: "bottom", animation: "fade" });
  selectCaption(plan.captions.length - 1);
}

const num = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : Number(v));

// ---------------------------------------------------------------- transcription & tight cut
const transcribeJob = computed(() =>
  transcribeJobId.value ? office.state.jobs[transcribeJobId.value] : undefined,
);

watch(
  () => transcribeJob.value?.status,
  async (s) => {
    if (s === "done") {
      transcribing.value = false;
      transcribeJobId.value = null;
      msg.value = "Speech transcription finished.";
      await load();
    } else if (s === "failed" || s === "cancelled") {
      transcribing.value = false;
      error.value = `Transcription ${s}.`;
    }
  },
);

async function onTranscribe() {
  error.value = msg.value = "";
  transcribing.value = true;
  try {
    const res = await api.transcribeVideo(props.id);
    transcribeJobId.value = res.job.id;
    msg.value = "Transcribing speech on your PC runner (whisper.cpp)…";
  } catch (e) {
    error.value = (e as Error).message;
    transcribing.value = false;
  }
}

function applyTightCut() {
  const t = firstVideoTranscript.value;
  if (!t) return;
  const ok = window.confirm(
    "Replace current clips with tight cut? This will remove pauses ≥ 0.6s and hesitation sounds (um, ah).",
  );
  if (!ok) return;

  const n = videoSources.value[0]?.n ?? 1;
  const cuts = tightCuts(t, n);
  plan.clips = cuts;
  selectedClipIndex.value = null;

  const fillerCount = t.words.filter((w) => isFiller(w.w)).length;
  const newDuration = cuts.reduce((acc, c) => acc + (c.end ? (c.end - c.start) / c.speed : 0), 0);
  const savedSec = Math.max(0, Math.round((t.duration - newDuration) * 10) / 10);
  msg.value = `Tight cut applied: removed ${savedSec}s of pauses and ${fillerCount} fillers across ${cuts.length} clips.`;
}

function toggleSubtitles(e: Event) {
  const checked = (e.target as HTMLInputElement).checked;
  if (checked) {
    plan.subtitles = { style: "pop", uppercase: true, position: "bottom" };
  } else {
    plan.subtitles = null;
  }
}

/** `attachments` = the files the suggestion's clip numbers point into (that set of suggestions' job files). */
function applySuggestion(option: EditSuggestion, attachments: { id: string }[]) {
  if (!info.value) return;
  const mappedClips = option.plan.clips
    .map((c) => {
      const attach = attachments[c.video - 1];
      if (!attach) return null;
      const idx = info.value?.render.attachments.findIndex((a) => a.id === attach.id);
      if (idx === undefined || idx === -1) return null;
      return { ...c, video: idx + 1 };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  plan.clips = mappedClips.length ? mappedClips : [{ video: 1, start: 0, speed: 1, zoom: "none" }];
  plan.preset = option.plan.preset;
  plan.fit = option.plan.fit;
  plan.fps = option.plan.fps;
  if (option.plan.name) plan.name = option.plan.name;
  plan.mute = option.plan.mute;
  plan.normalize_audio = option.plan.normalize_audio;
  plan.captions = JSON.parse(JSON.stringify(option.plan.captions ?? []));
  plan.subtitles = option.plan.subtitles ? JSON.parse(JSON.stringify(option.plan.subtitles)) : null;
  selectedClipIndex.value = null;
  selectedCaptionIndex.value = null;
  msg.value = `Applied suggestion "${option.title}" to timeline.`;
}

function onSeek(seconds: number) {
  if (previewVideo.value) {
    previewVideo.value.currentTime = seconds;
    previewVideo.value.play().catch(() => {});
  }
}

// ---------------------------------------------------------------- render again
const job = computed(() => (jobId.value ? office.state.jobs[jobId.value] : undefined));
const jobAgent = computed(() => (job.value ? office.state.agents[job.value.agent_id] : undefined));
const rendering = computed(() => !!job.value && ["queued", "running"].includes(job.value.status));

const renderProgress = computed(() => {
  const text = jobAgent.value?.thinking;
  if (!text) return null;
  const m = text.match(/(\d+)%/);
  return m ? Number(m[1]) : null;
});

watch(
  () => job.value?.status,
  async (s) => {
    if (s === "done") {
      const fresh = await api.video(props.id);
      const made = fresh.last_render_job?.result_upload_id;
      jobId.value = null;
      msg.value = "Rendered. Opening the new video…";
      if (made) {
        await router.push({
          name: "studio",
          params: { id: made },
          query: draftId.value ? { draft: draftId.value } : {},
        });
      }
    } else if (s === "failed" || s === "cancelled") {
      error.value = `The render ${s}. Open the job for details.`;
    }
  },
);

async function renderAgain() {
  error.value = msg.value = "";
  const parsed = EditPlan.safeParse({
    ...plan,
    captions: plan.captions.filter((c) => c.text.trim()),
  });
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
    await router.push({
      name: "studio",
      params: { id: up.id },
      query: draftId.value ? { draft: draftId.value } : {},
    });
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    uploadPct.value = null;
  }
}
</script>

<template>
  <div class="mx-auto max-w-6xl pb-28 lg:pb-8">
    <div class="mb-3 flex items-center justify-between">
      <RouterLink to="/drafts" class="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg min-h-10">
        <ArrowLeft :size="15" /> Drafts
      </RouterLink>

      <button
        v-if="info"
        type="button"
        class="btn btn-sm min-h-9 px-3 flex items-center gap-1.5 font-medium border-accent/40 text-accent hover:bg-accent/10 cursor-pointer shadow-xs"
        @click="askEditorOpen = true"
      >
        <Bot :size="14" /> Ask Editor
      </button>
    </div>

    <PageHeader
      sign="Video Studio"
      :title="info?.upload.name ?? 'Video'"
      description="See how this video was edited, change it and render it again on your PC (no AI, no tokens). For heavy edits use OpenCut, then bring the export back here."
    >
      <span v-if="isEdited" class="chip chip-sm text-[11px] font-medium bg-amber-500/15 text-amber-500 border-amber-500/30">
        Edited
      </span>
      <span v-if="draftId" class="chip chip-sm text-[11px] text-muted">
        Linked to draft
      </span>
    </PageHeader>

    <div v-if="error" class="mb-4 rounded-xl border border-danger/30 bg-danger-soft p-3.5 text-sm text-danger" role="alert">
      {{ error }}
    </div>
    <div v-if="msg" class="mb-4 rounded-xl border border-accent/30 bg-accent-soft p-3.5 text-sm text-accent" role="status">
      {{ msg }}
    </div>

    <div v-if="info" class="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <!-- 1. preview + external tools -->
      <section id="preview" class="space-y-4">
        <!-- Video Preview Card with dynamic Aspect Ratio frame and Subtitles overlay -->
        <div class="card overflow-hidden p-3 bg-surface-2/30 flex flex-col items-center justify-center">
          <div class="relative w-full flex items-center justify-center" :class="aspectClass">
            <video
              ref="previewVideo"
              :key="info.upload.id"
              :src="api.uploadUrl(info.upload.id)"
              controls
              playsinline
              preload="metadata"
              class="h-full w-full object-contain rounded-lg bg-black shadow-md"
              aria-label="Video preview"
              @timeupdate="playerCurrentTime = previewVideo?.currentTime ?? 0"
            />

            <!-- Subtitle overlay -->
            <div
              v-if="plan.subtitles && activeCue"
              class="pointer-events-none absolute inset-x-4 flex justify-center z-10 transition-all"
              :class="plan.subtitles.position === 'middle' ? 'top-1/2 -translate-y-1/2' : 'bottom-12'"
            >
              <span
                class="max-w-[90%] rounded-md px-3 py-1.5 text-center leading-snug drop-shadow-md select-none"
                :class="[
                  plan.subtitles.style === 'pop'
                    ? 'bg-amber-400 text-black text-sm sm:text-base font-black tracking-wide shadow-lg uppercase scale-105'
                    : 'bg-black/85 text-white text-xs sm:text-sm font-semibold tracking-normal backdrop-blur-xs'
                ]"
              >
                {{ activeCue.text }}
              </span>
            </div>

            <!-- Target shape badge overlay -->
            <span class="chip chip-sm absolute top-3 left-3 bg-black/70 text-white backdrop-blur border border-white/20 text-[11px] font-medium shadow-md">
              <Film :size="12" class="text-accent" />
              {{ preset?.label ?? plan.preset }}
            </span>
          </div>
        </div>

        <!-- Transcript Panel -->
        <TranscriptPanel
          :transcript="firstVideoTranscript"
          :file-number="videoSources[0]?.n ?? 1"
          :current-time="playerCurrentTime"
          :busy="transcribing"
          @seek="onSeek"
          @transcribe="onTranscribe"
        />

        <!-- OpenCut 3-Step Panel -->
        <div class="card p-3.5 space-y-3 border-line/80 bg-surface/50">
          <div class="flex items-center justify-between">
            <span class="sign flex items-center gap-1.5 font-semibold text-xs">
              <Scissors :size="14" class="text-accent" />
              External edit with OpenCut
            </span>
            <span class="chip chip-sm text-[10px]">3 steps</span>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
            <!-- Step 1: Download -->
            <div class="rounded-lg border border-line bg-surface-2/40 p-2.5 flex flex-col justify-between gap-2">
              <div class="space-y-1">
                <div class="flex items-center gap-1.5 font-semibold text-fg text-[12px]">
                  <span class="flex size-5 items-center justify-center rounded-full bg-accent/15 text-accent text-[10px] font-bold">1</span>
                  Download
                </div>
                <p class="text-[11px] text-muted leading-snug">Save video file to your PC.</p>
              </div>
              <a :href="api.uploadUrl(info.upload.id, true)" class="btn btn-sm min-h-10 w-full justify-center text-xs" download>
                <Download :size="13" /> Download
              </a>
            </div>

            <!-- Step 2: OpenCut -->
            <div class="rounded-lg border border-line bg-surface-2/40 p-2.5 flex flex-col justify-between gap-2">
              <div class="space-y-1">
                <div class="flex items-center gap-1.5 font-semibold text-fg text-[12px]">
                  <span class="flex size-5 items-center justify-center rounded-full bg-accent/15 text-accent text-[10px] font-bold">2</span>
                  OpenCut
                </div>
                <p class="text-[11px] text-muted leading-snug">Cut, effect, audio, export.</p>
              </div>
              <button
                type="button"
                class="btn btn-sm min-h-10 w-full justify-center text-xs"
                @click="openInOpenCut(info.upload.id, info.upload.name)"
              >
                <Scissors :size="13" /> Open OpenCut
              </button>
            </div>

            <!-- Step 3: Bring export back -->
            <div class="rounded-lg border border-line bg-surface-2/40 p-2.5 flex flex-col justify-between gap-2">
              <div class="space-y-1">
                <div class="flex items-center gap-1.5 font-semibold text-fg text-[12px]">
                  <span class="flex size-5 items-center justify-center rounded-full bg-accent/15 text-accent text-[10px] font-bold">3</span>
                  Use own edit
                </div>
                <p class="text-[11px] text-muted leading-snug">Import your exported video.</p>
              </div>
              <label class="btn btn-sm min-h-10 w-full justify-center text-xs cursor-pointer" :class="uploadPct !== null && 'opacity-60'">
                <input
                  ref="ownInput"
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mkv,.m4v"
                  class="hidden"
                  :disabled="uploadPct !== null"
                  @change="useOwnEdit"
                />
                <Upload :size="13" />
                <span class="truncate">{{ uploadPct === null ? "Use my own edit" : `Uploading ${uploadPct}%` }}</span>
              </label>
            </div>
          </div>
        </div>

        <!-- Video Metadata Card -->
        <div class="card space-y-1.5 p-3.5 text-xs text-muted">
          <div class="flex items-center justify-between text-fg font-medium">
            <span>{{ Math.round(info.upload.size / 1024 / 102.4) / 10 }} MB</span>
            <span class="text-faint">{{ fmtDateTime(info.upload.created_at) }}</span>
          </div>
          <p v-if="!info.known" class="text-muted">
            This is your own clip: the plan below starts from the whole video.
          </p>
          <div v-for="d in info.drafts" :key="d.id" class="pt-1 border-t border-line/60 flex items-center gap-1.5">
            <span class="text-fg font-semibold">Draft:</span>
            <RouterLink to="/drafts" class="text-accent hover:underline truncate">{{ d.title }}</RouterLink>
            <span class="chip chip-sm text-[10px]">{{ d.platform }}</span>
            <span class="chip chip-sm text-[10px]">{{ d.status }}</span>
          </div>
        </div>

        <!-- hidden: read each source clip's length for the timeline -->
        <video
          v-for="s in videoSources"
          :key="s.id"
          :src="api.uploadUrl(s.id)"
          preload="metadata"
          class="hidden"
          muted
          @loadedmetadata="onMeta(s.id, $event)"
        />
      </section>

      <!-- 2. the edit (timeline, clips, captions, settings, render) -->
      <section id="edit" class="space-y-4">
        <!-- Editor's Suggestions (above timeline) -->
        <div v-if="info.suggestions" class="card p-4 space-y-3 bg-surface/90 border-accent/30 shadow-xs">
          <EditSuggestionCards
            :suggestions="info.suggestions"
            mode="studio"
            @use="(opt) => applySuggestion(opt, info!.suggestions!.attachments)"
          />
        </div>

        <!-- Timeline Card -->
        <div class="card p-4 space-y-2.5">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <h2 class="flex items-center gap-2 font-semibold text-base">
                <Clapperboard :size="17" class="text-accent" /> Timeline
              </h2>
              <span v-if="isEdited" class="chip chip-sm text-[10px] bg-amber-500/15 text-amber-500 border-amber-500/30">
                Edited
              </span>
            </div>
            <div class="flex items-center gap-2 text-xs">
              <span class="text-muted">{{ plan.clips.length }} clips</span>
              <span>·</span>
              <span class="tabular-nums font-mono font-medium" :class="tooLong ? 'text-danger font-semibold' : 'text-fg'">
                {{ total === null ? "…" : `${total}s` }}
                <span class="text-muted font-normal">{{ preset ? ` / max ${preset.max_seconds}s` : "" }}</span>
              </span>
            </div>
          </div>

          <!-- Video Clip Bars -->
          <div class="flex h-14 sm:h-16 w-full overflow-hidden rounded-lg border border-line bg-sunken p-1 gap-1" aria-label="Clips in order">
            <button
              v-for="(c, i) in plan.clips"
              :key="i"
              type="button"
              class="relative flex min-w-10 flex-col items-center justify-center rounded transition-all cursor-pointer select-none text-white overflow-hidden p-1"
              :class="[
                COLORS[(c.video - 1) % COLORS.length],
                selectedClipIndex === i ? 'ring-2 ring-white shadow-md scale-[1.01] z-10 font-bold' : 'opacity-90 hover:opacity-100 hover:brightness-105'
              ]"
              :style="{ flexGrow: lengths[i] ?? 1 }"
              :title="`Clip ${i + 1}: file ${c.video}, ${c.start}s → ${c.end ?? 'end'}${c.speed !== 1 ? `, ${c.speed}×` : ''}`"
              @click="selectClip(i)"
            >
              <div class="flex items-center gap-1 leading-none">
                <span class="text-xs font-semibold">#{{ i + 1 }}</span>
                <span v-if="c.speed !== 1" class="chip chip-sm px-1 py-0 text-[9px] bg-black/40 text-white border-0 font-mono">
                  {{ c.speed }}×
                </span>
              </div>
              <span class="text-[11px] font-mono opacity-90 leading-tight mt-0.5 tabular-nums">
                {{ lengths[i] !== null && lengths[i] !== undefined ? `${Math.round(lengths[i]! * 10) / 10}s` : '…' }}
              </span>
            </button>
          </div>

          <!-- Time Ruler -->
          <div v-if="total" class="flex justify-between items-center text-[10px] font-mono text-muted px-1 select-none border-t border-line/40 pt-1">
            <span class="flex items-center gap-1">0s</span>
            <span v-if="total > 4" class="hidden sm:inline">{{ Math.round(total * 0.25 * 10) / 10 }}s</span>
            <span v-if="total > 2">{{ Math.round(total * 0.5 * 10) / 10 }}s</span>
            <span v-if="total > 4" class="hidden sm:inline">{{ Math.round(total * 0.75 * 10) / 10 }}s</span>
            <span class="font-semibold text-fg">{{ total }}s</span>
          </div>

          <!-- Captions Lane -->
          <div v-if="plan.captions.length" class="space-y-1">
            <div class="text-[11px] text-muted flex items-center justify-between">
              <span class="flex items-center gap-1"><Type :size="12" class="text-accent" /> Captions lane</span>
              <span class="text-[10px] font-mono">{{ plan.captions.length }} captions</span>
            </div>
            <div
              v-if="total"
              class="relative h-7 w-full overflow-hidden rounded-md border border-line bg-sunken p-0.5"
              aria-label="Captions on the timeline"
            >
              <button
                v-for="(cap, i) in plan.captions"
                :key="i"
                type="button"
                class="absolute top-0.5 bottom-0.5 overflow-hidden rounded px-1.5 text-[10px] font-medium leading-5 whitespace-nowrap text-left transition-all cursor-pointer flex items-center border"
                :class="selectedCaptionIndex === i
                  ? 'bg-accent text-accent-ink border-accent font-semibold shadow-sm z-10'
                  : 'bg-surface border-line text-fg hover:border-line-strong hover:bg-surface-2'"
                :style="{
                  left: `${Math.min(100, (cap.start / total) * 100)}%`,
                  width: `${Math.max(4, ((Math.min(cap.end, total) - cap.start) / total) * 100)}%`,
                }"
                :title="`Caption ${i + 1} (${cap.start}s - ${cap.end}s): ${cap.text}`"
                @click="selectCaption(i)"
              >
                <span class="truncate">{{ cap.text || '(empty)' }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Clips Section -->
        <div class="card space-y-3 p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <h2 class="flex items-center gap-2 font-semibold text-base">
                <Scissors :size="17" class="text-accent" /> Clips
              </h2>
              <span class="chip chip-sm text-xs">{{ plan.clips.length }}</span>
            </div>

            <div class="flex items-center gap-2">
              <!-- Tight cut button -->
              <button
                v-if="firstVideoTranscript"
                type="button"
                class="btn btn-sm min-h-10 px-3 font-medium flex items-center gap-1.5 border-accent/40 text-accent hover:bg-accent/10 cursor-pointer"
                title="Build tight cut by removing pauses and filler words"
                @click="applyTightCut"
              >
                <Scissors :size="14" /> Tight cut
              </button>

              <button
                type="button"
                class="btn btn-sm min-h-10 px-3 font-medium flex items-center gap-1.5 cursor-pointer"
                :disabled="plan.clips.length >= 80"
                @click="addClip"
              >
                <Plus :size="14" /> Add clip
              </button>
            </div>
          </div>

          <div class="space-y-2.5">
            <div
              v-for="(c, i) in plan.clips"
              :id="`clip-row-${i}`"
              :key="i"
              class="rounded-xl border p-3 transition-all"
              :class="selectedClipIndex === i ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-line bg-surface/40 hover:border-line-strong'"
            >
              <!-- Phone card layout -->
              <div class="sm:hidden space-y-3">
                <div class="flex items-center justify-between gap-2 border-b border-line/60 pb-2">
                  <div class="flex items-center gap-2">
                    <span class="flex size-6 items-center justify-center rounded-md bg-surface-2 font-mono text-xs font-semibold text-accent border border-line">
                      #{{ i + 1 }}
                    </span>
                    <span class="text-xs font-mono text-muted">
                      {{ lengths[i] !== null && lengths[i] !== undefined ? `${Math.round(lengths[i]! * 10) / 10}s` : '…' }}
                    </span>
                  </div>
                  <div class="flex items-center gap-1">
                    <button
                      type="button"
                      class="btn btn-sm btn-ghost min-h-10 min-w-10 p-0 flex items-center justify-center cursor-pointer"
                      :disabled="i === 0"
                      aria-label="Move up"
                      @click="moveClip(i, -1)"
                    >
                      <ArrowUp :size="15" />
                    </button>
                    <button
                      type="button"
                      class="btn btn-sm btn-ghost min-h-10 min-w-10 p-0 flex items-center justify-center cursor-pointer"
                      :disabled="i === plan.clips.length - 1"
                      aria-label="Move down"
                      @click="moveClip(i, 1)"
                    >
                      <ArrowDown :size="15" />
                    </button>
                    <button
                      type="button"
                      class="btn btn-sm btn-ghost min-h-10 min-w-10 p-0 flex items-center justify-center text-danger cursor-pointer"
                      :disabled="plan.clips.length === 1"
                      aria-label="Remove clip"
                      @click="plan.clips.splice(i, 1)"
                    >
                      <Trash2 :size="15" />
                    </button>
                  </div>
                </div>

                <label class="block">
                  <span class="label text-xs">Source file</span>
                  <select v-model.number="c.video" class="input text-sm min-h-10 w-full">
                    <option v-for="s in videoSources" :key="s.id" :value="s.n">
                      {{ s.n }}. {{ s.name }}{{ durations[s.id] ? ` (${durations[s.id]}s)` : "" }}
                    </option>
                  </select>
                </label>

                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <div class="flex items-center justify-between mb-1">
                      <span class="label text-xs">Start (s)</span>
                      <button
                        type="button"
                        class="text-[10px] text-accent font-medium hover:underline flex items-center gap-0.5 min-h-7.5"
                        title="Reads current time from preview player"
                        @click="setClipStartFromPlayer(c)"
                      >
                        <Clock :size="11" /> From player
                      </button>
                    </div>
                    <input v-model.number="c.start" type="number" min="0" step="0.1" class="input text-sm min-h-10 w-full" />
                  </div>

                  <div>
                    <div class="flex items-center justify-between mb-1">
                      <span class="label text-xs">End (s)</span>
                      <button
                        type="button"
                        class="text-[10px] text-accent font-medium hover:underline flex items-center gap-0.5 min-h-7.5"
                        title="Reads current time from preview player"
                        @click="setClipEndFromPlayer(c)"
                      >
                        <Clock :size="11" /> From player
                      </button>
                    </div>
                    <input
                      :value="c.end ?? ''"
                      type="number"
                      min="0"
                      step="0.1"
                      class="input text-sm min-h-10 w-full"
                      placeholder="end"
                      @input="c.end = num(($event.target as HTMLInputElement).value)"
                    />
                  </div>
                </div>

                <label class="block">
                  <span class="label text-xs">Playback speed</span>
                  <select v-model.number="c.speed" class="input text-sm min-h-10 w-full">
                    <option :value="0.5">0.5× slow</option>
                    <option :value="0.75">0.75×</option>
                    <option :value="1">1× normal</option>
                    <option :value="1.5">1.5×</option>
                    <option :value="2">2× fast</option>
                  </select>
                </label>
              </div>

              <!-- Desktop compact row layout -->
              <div class="hidden sm:grid sm:grid-cols-[2.5rem_1fr_6.5rem_6.5rem_6.5rem_auto] items-end gap-2.5">
                <span class="self-center font-mono text-xs font-semibold text-accent">#{{ i + 1 }}</span>

                <label class="min-w-0">
                  <span class="label text-xs">Source file</span>
                  <select v-model.number="c.video" class="input text-sm min-h-9.5 w-full">
                    <option v-for="s in videoSources" :key="s.id" :value="s.n">
                      {{ s.n }}. {{ s.name }}{{ durations[s.id] ? ` (${durations[s.id]}s)` : "" }}
                    </option>
                  </select>
                </label>

                <div>
                  <div class="flex items-center justify-between mb-1">
                    <span class="label text-[11px]">Start s</span>
                    <button
                      type="button"
                      class="text-[10px] text-accent hover:underline flex items-center gap-0.5"
                      title="Reads current time from preview player"
                      @click="setClipStartFromPlayer(c)"
                    >
                      <Clock :size="10" /> Now
                    </button>
                  </div>
                  <input v-model.number="c.start" type="number" min="0" step="0.1" class="input text-sm min-h-9.5 w-full" />
                </div>

                <div>
                  <div class="flex items-center justify-between mb-1">
                    <span class="label text-[11px]">End s</span>
                    <button
                      type="button"
                      class="text-[10px] text-accent hover:underline flex items-center gap-0.5"
                      title="Reads current time from preview player"
                      @click="setClipEndFromPlayer(c)"
                    >
                      <Clock :size="10" /> Now
                    </button>
                  </div>
                  <input
                    :value="c.end ?? ''"
                    type="number"
                    min="0"
                    step="0.1"
                    class="input text-sm min-h-9.5 w-full"
                    placeholder="end"
                    @input="c.end = num(($event.target as HTMLInputElement).value)"
                  />
                </div>

                <label>
                  <span class="label text-[11px]">Speed</span>
                  <select v-model.number="c.speed" class="input text-sm min-h-9.5 w-full">
                    <option :value="0.5">0.5×</option>
                    <option :value="0.75">0.75×</option>
                    <option :value="1">1×</option>
                    <option :value="1.5">1.5×</option>
                    <option :value="2">2×</option>
                  </select>
                </label>

                <div class="flex gap-1 pb-0.5">
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost px-2 min-h-9.5 cursor-pointer"
                    :disabled="i === 0"
                    aria-label="Move up"
                    @click="moveClip(i, -1)"
                  >
                    <ArrowUp :size="14" />
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost px-2 min-h-9.5 cursor-pointer"
                    :disabled="i === plan.clips.length - 1"
                    aria-label="Move down"
                    @click="moveClip(i, 1)"
                  >
                    <ArrowDown :size="14" />
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost px-2 min-h-9.5 text-danger cursor-pointer"
                    :disabled="plan.clips.length === 1"
                    aria-label="Remove clip"
                    @click="plan.clips.splice(i, 1)"
                  >
                    <Trash2 :size="14" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Subtitles Section -->
        <div class="card p-4 space-y-3.5">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <h2 class="flex items-center gap-2 font-semibold text-base">
                <SubtitlesIcon :size="17" class="text-accent" /> Subtitles
              </h2>
              <span
                class="chip chip-sm text-[10px]"
                :class="plan.subtitles ? 'bg-accent/15 text-accent border-accent/30 font-medium' : 'text-muted'"
              >
                {{ plan.subtitles ? 'Enabled' : 'Off' }}
              </span>
            </div>

            <!-- Toggle Switch -->
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <span class="text-xs text-muted font-medium">{{ plan.subtitles ? 'Burn in subtitles' : 'No subtitles' }}</span>
              <input
                type="checkbox"
                class="accent-accent size-4 cursor-pointer"
                :checked="!!plan.subtitles"
                @change="toggleSubtitles"
              />
            </label>
          </div>

          <p v-if="!plan.subtitles" class="text-xs text-muted leading-relaxed">
            Burn in timed subtitles generated from whisper speech recognition. Requires video transcription first.
          </p>

          <!-- Controls when enabled -->
          <div v-else class="space-y-3 pt-2 border-t border-line/60">
            <div class="grid gap-3 sm:grid-cols-3">
              <label>
                <span class="label text-xs">Subtitle style</span>
                <select v-model="plan.subtitles.style" class="input text-sm min-h-10 w-full">
                  <option value="pop">Pop (2 words, TikTok)</option>
                  <option value="line">Line (up to 6 words)</option>
                </select>
              </label>

              <label>
                <span class="label text-xs">Position</span>
                <select v-model="plan.subtitles.position" class="input text-sm min-h-10 w-full">
                  <option value="bottom">Bottom</option>
                  <option value="middle">Middle</option>
                </select>
              </label>

              <label class="flex items-center gap-2.5 text-xs text-fg min-h-10 mt-auto cursor-pointer select-none">
                <input
                  v-model="plan.subtitles.uppercase"
                  type="checkbox"
                  class="accent-accent size-4 cursor-pointer"
                />
                <span class="font-medium">Uppercase text</span>
              </label>
            </div>

            <!-- Live subtitle cue indicator -->
            <div v-if="activeCue" class="rounded-lg border border-accent/25 bg-accent/5 p-2.5 flex items-center justify-between text-xs">
              <span class="text-muted text-[11px] font-mono">Current cue ({{ activeCue.start }}s - {{ activeCue.end }}s):</span>
              <span class="font-bold text-fg truncate ml-2">{{ activeCue.text }}</span>
            </div>
            <div v-else-if="allSubtitleCues.length" class="text-[11px] text-muted">
              {{ allSubtitleCues.length }} subtitle cues ready across clips. Play video to preview live.
            </div>
            <div v-else class="text-[11px] text-muted">
              No speech cues found in current clips. Make sure video source has a transcript.
            </div>
          </div>
        </div>

        <!-- Captions Section -->
        <div class="card space-y-3 p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <h2 class="flex items-center gap-2 font-semibold text-base">
                <Type :size="17" class="text-accent" /> Captions
              </h2>
              <span class="chip chip-sm text-xs">{{ plan.captions.length }}</span>
            </div>
            <button
              type="button"
              class="btn btn-sm min-h-10 px-3 font-medium flex items-center gap-1.5 cursor-pointer"
              :disabled="plan.captions.length >= 40"
              @click="addCaption"
            >
              <Plus :size="14" /> Add caption
            </button>
          </div>

          <p v-if="!plan.captions.length" class="text-xs text-muted">
            No text overlays on the video. Times are measured in the finished video.
          </p>

          <div v-else class="space-y-2.5">
            <div
              v-for="(cap, i) in plan.captions"
              :id="`caption-row-${i}`"
              :key="i"
              class="rounded-xl border p-3 transition-all"
              :class="selectedCaptionIndex === i ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-line bg-surface/40 hover:border-line-strong'"
            >
              <!-- Phone card layout -->
              <div class="sm:hidden space-y-3">
                <div class="flex items-center justify-between gap-2 border-b border-line/60 pb-2">
                  <span class="flex size-6 items-center justify-center rounded-md bg-surface-2 font-mono text-xs font-semibold text-accent border border-line">
                    #{{ i + 1 }}
                  </span>
                  <div class="flex items-center gap-1">
                    <span class="chip chip-sm text-[10px]">{{ cap.position }}</span>
                    <button
                      type="button"
                      class="btn btn-sm btn-ghost min-h-10 min-w-10 p-0 flex items-center justify-center text-danger cursor-pointer"
                      aria-label="Remove caption"
                      @click="plan.captions.splice(i, 1)"
                    >
                      <Trash2 :size="15" />
                    </button>
                  </div>
                </div>

                <label class="block">
                  <span class="label text-xs">Caption text</span>
                  <input
                    v-model="cap.text"
                    maxlength="200"
                    class="input text-sm min-h-10 w-full"
                    placeholder="e.g. Tournament Sabtu ni!"
                  />
                </label>

                <div class="grid grid-cols-3 gap-2">
                  <label>
                    <span class="label text-xs">From (s)</span>
                    <input v-model.number="cap.start" type="number" min="0" step="0.1" class="input text-sm min-h-10 w-full" />
                  </label>
                  <label>
                    <span class="label text-xs">To (s)</span>
                    <input v-model.number="cap.end" type="number" min="0" step="0.1" class="input text-sm min-h-10 w-full" />
                  </label>
                  <label>
                    <span class="label text-xs">Position</span>
                    <select v-model="cap.position" class="input text-sm min-h-10 w-full">
                      <option value="top">Top</option>
                      <option value="middle">Middle</option>
                      <option value="bottom">Bottom</option>
                    </select>
                  </label>
                </div>
              </div>

              <!-- Desktop compact row layout -->
              <div class="hidden sm:grid sm:grid-cols-[1fr_5rem_5rem_6.5rem_auto] items-end gap-2.5">
                <label class="min-w-0">
                  <span class="label text-xs">Caption text</span>
                  <input
                    v-model="cap.text"
                    maxlength="200"
                    class="input text-sm min-h-9.5 w-full"
                    placeholder="e.g. Tournament Sabtu ni!"
                  />
                </label>

                <label>
                  <span class="label text-[11px]">From s</span>
                  <input v-model.number="cap.start" type="number" min="0" step="0.1" class="input text-sm min-h-9.5 w-full" />
                </label>

                <label>
                  <span class="label text-[11px]">To s</span>
                  <input v-model.number="cap.end" type="number" min="0" step="0.1" class="input text-sm min-h-9.5 w-full" />
                </label>

                <label>
                  <span class="label text-[11px]">Position</span>
                  <select v-model="cap.position" class="input text-sm min-h-9.5 w-full">
                    <option value="top">Top</option>
                    <option value="middle">Middle</option>
                    <option value="bottom">Bottom</option>
                  </select>
                </label>

                <div class="pb-0.5">
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost px-2 min-h-9.5 text-danger cursor-pointer"
                    aria-label="Remove caption"
                    @click="plan.captions.splice(i, 1)"
                  >
                    <Trash2 :size="14" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Settings Section -->
        <div class="card p-4 space-y-3">
          <div class="flex items-center gap-2 mb-1">
            <h2 class="flex items-center gap-2 font-semibold text-base">
              <Settings2 :size="17" class="text-accent" /> Output settings
            </h2>
          </div>

          <div class="grid gap-3.5 sm:grid-cols-2">
            <label>
              <span class="label text-xs">Format</span>
              <select v-model="plan.preset" class="input text-sm min-h-10">
                <option v-for="(p, id) in info.presets" :key="id" :value="id">{{ p.label }}</option>
              </select>
            </label>

            <label>
              <span class="label text-xs">Fit strategy</span>
              <select v-model="plan.fit" class="input text-sm min-h-10">
                <option value="crop">Crop: fill the screen</option>
                <option value="blur">Blur: whole picture on a blurred copy</option>
                <option value="pad">Pad: whole picture on black</option>
              </select>
            </label>

            <label>
              <span class="label text-xs">Frame rate</span>
              <select v-model.number="plan.fps" class="input text-sm min-h-10">
                <option v-for="f in [24, 25, 30, 50, 60]" :key="f" :value="f">{{ f }} fps</option>
              </select>
            </label>

            <label>
              <span class="label text-xs">File name</span>
              <input v-model="plan.name" maxlength="60" class="input text-sm min-h-10" />
            </label>

            <label class="flex items-center gap-2.5 text-sm min-h-10 cursor-pointer select-none">
              <input v-model="plan.mute" type="checkbox" class="accent-accent size-4 cursor-pointer" />
              <span>Mute original audio</span>
            </label>

            <label class="flex items-center gap-2.5 text-sm min-h-10 cursor-pointer select-none">
              <input v-model="plan.normalize_audio" type="checkbox" class="accent-accent size-4 cursor-pointer" />
              <span>Even loudness (−14 LUFS)</span>
            </label>
          </div>
        </div>

        <!-- Desktop Render Actions Card -->
        <div class="card p-4 space-y-3 bg-surface/80 border-line">
          <!-- Real-time Progress Bar while rendering -->
          <div v-if="rendering" class="space-y-1.5 rounded-lg border border-accent/30 bg-accent/5 p-3">
            <div class="flex items-center justify-between text-xs">
              <span class="flex items-center gap-2 font-medium text-accent">
                <LoaderCircle :size="14" class="animate-spin" />
                {{ jobAgent?.thinking ?? "Rendering video on runner PC (no AI)…" }}
              </span>
              <span v-if="renderProgress !== null" class="font-mono font-semibold tabular-nums text-accent">
                {{ renderProgress }}%
              </span>
            </div>
            <div class="h-2 w-full overflow-hidden rounded-full bg-surface-2 border border-line">
              <div
                class="h-full bg-accent transition-all duration-300"
                :class="renderProgress === null && 'animate-pulse w-full bg-accent/60'"
                :style="renderProgress !== null ? { width: `${renderProgress}%` } : {}"
              />
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                class="btn btn-primary min-h-10 px-4 font-medium flex items-center gap-2 cursor-pointer shadow-xs"
                :disabled="busy || rendering || tooLong"
                @click="renderAgain"
              >
                <LoaderCircle v-if="busy || rendering" :size="16" class="animate-spin" />
                <Wand2 v-else :size="16" />
                {{ rendering ? (jobAgent?.thinking ?? "Rendering…") : "Render again" }}
              </button>

              <button
                type="button"
                class="btn btn-ghost min-h-10 px-3.5 flex items-center gap-1.5 cursor-pointer"
                :disabled="rendering || !isEdited"
                @click="resetPlan"
              >
                <RotateCcw :size="15" /> Undo changes
              </button>
            </div>

            <span v-if="draftId" class="text-xs text-muted">
              The draft switches to the new video when it is done.
            </span>
          </div>
        </div>
      </section>
    </div>

    <!-- Phone Sticky Bottom Action Bar -->
    <div
      v-if="info"
      class="fixed bottom-14 inset-x-0 z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur-md lg:hidden shadow-lg"
    >
      <!-- Rendering progress on phone -->
      <div v-if="rendering" class="mb-2 space-y-1">
        <div class="flex items-center justify-between text-[11px]">
          <span class="flex items-center gap-1.5 text-accent font-medium truncate">
            <LoaderCircle :size="12" class="animate-spin shrink-0" />
            <span class="truncate">{{ jobAgent?.thinking ?? "Rendering…" }}</span>
          </span>
          <span v-if="renderProgress !== null" class="font-mono font-semibold tabular-nums text-accent ml-2">
            {{ renderProgress }}%
          </span>
        </div>
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-surface-2 border border-line">
          <div
            class="h-full bg-accent transition-all duration-300"
            :class="renderProgress === null && 'animate-pulse w-full bg-accent/60'"
            :style="renderProgress !== null ? { width: `${renderProgress}%` } : {}"
          />
        </div>
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="btn btn-primary flex-1 min-h-10.5 font-medium justify-center flex items-center gap-2 cursor-pointer shadow-xs"
          :disabled="busy || rendering || tooLong"
          @click="renderAgain"
        >
          <LoaderCircle v-if="busy || rendering" :size="15" class="animate-spin" />
          <Wand2 v-else :size="15" />
          <span>{{ rendering ? "Rendering…" : "Render again" }}</span>
        </button>

        <button
          type="button"
          class="btn btn-ghost min-h-10.5 px-3 shrink-0 flex items-center gap-1.5 cursor-pointer"
          title="Ask Editor"
          aria-label="Ask Editor"
          @click="askEditorOpen = true"
        >
          <Bot :size="16" class="text-accent" />
          <span class="text-xs">Ask</span>
        </button>

        <button
          type="button"
          class="btn btn-ghost min-h-10.5 px-3 shrink-0 flex items-center gap-1.5 cursor-pointer"
          :disabled="rendering || !isEdited"
          title="Undo changes"
          aria-label="Undo changes"
          @click="resetPlan"
        >
          <RotateCcw :size="16" />
          <span class="text-xs">Undo</span>
        </button>
      </div>
    </div>

    <!-- Ask Editor Drawer / Bottom Sheet -->
    <Teleport to="body">
      <div
        v-if="askEditorOpen && info"
        class="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs transition-opacity"
        @click.self="askEditorOpen = false"
      >
        <!-- On phone: bottom sheet (bottom-0 w-full max-h-[85vh]); on desktop: right side drawer (w-96 sm:w-[420px] h-full) -->
        <div
          class="w-full sm:w-[440px] max-w-full h-[85vh] sm:h-full mt-auto sm:mt-0 flex flex-col shadow-2xl transition-transform"
        >
          <AskEditorPanel
            :upload-id="info.upload.id"
            :video-sources="videoSources"
            @use-suggestion="applySuggestion"
            @close="askEditorOpen = false"
          />
        </div>
      </div>
    </Teleport>

    <div v-if="!info && !error" class="card p-8 text-center text-sm text-muted">
      <LoaderCircle :size="24" class="mx-auto mb-2 animate-spin text-accent" />
      Loading video studio…
    </div>
  </div>
</template>
