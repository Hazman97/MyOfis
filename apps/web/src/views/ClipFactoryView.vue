<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Flame,
  Info,
  Loader2,
  Play,
  RotateCcw,
  Scissors,
  Share2,
  Sparkles,
  Type,
  Upload,
  Video as VideoIcon,
  X,
} from "lucide-vue-next";
import {
  CAPTION_PRESETS,
  REFRAME_MODES,
  type CaptionPreset,
  type ClipCandidate,
  type ReframeMode,
} from "@agent-office/shared";
import PageHeader from "../components/PageHeader.vue";
import { api, type VideoListItem } from "../api/http.ts";
import { useOffice } from "../stores/office.ts";
import { fmtBytes } from "../format.ts";

const office = useOffice();

// State
const videos = ref<VideoListItem[]>([]);
const selectedVideoId = ref<string>("");
const clips = ref<ClipCandidate[]>([]);
const loadingVideos = ref(false);
const loadingClips = ref(false);
const analyzing = ref(false);
const uploading = ref(false);
const uploadProgress = ref(0);
const error = ref("");
const successMsg = ref("");

// Analysis Options
const topicPrompt = ref("");
const minDuration = ref(15);
const maxDuration = ref(60);
const captionPreset = ref<CaptionPreset>("pop");
const reframeMode = ref<ReframeMode>("blur_fit");

// Selected Clip for Preview / Editing Modal
const activeClip = ref<ClipCandidate | null>(null);
const chosenHook = ref("");
const renderingDraft = ref(false);

const selectedVideo = computed(() =>
  videos.value.find((v) => v.id === selectedVideoId.value) ?? null,
);

// Clip Factory first; Editor only when Clip Factory is missing or switched off
const clipFactoryAgent = computed(
  () =>
    office.agents.find((a) => a.slug === "clip-factory" && a.enabled) ??
    office.agents.find((a) => a.slug === "editor" && a.enabled) ??
    null,
);

// The chat job of the current analysis; its status comes from the reducer (no polling)
const analysisJobId = ref<string | null>(null);
const analysisJob = computed(() => (analysisJobId.value ? office.state.jobs[analysisJobId.value] ?? null : null));
const analysisRun = computed(() => {
  const id = analysisJob.value?.run_ids.at(-1);
  return id ? office.state.runs[id] ?? null : null;
});

async function loadVideos() {
  loadingVideos.value = true;
  error.value = "";
  try {
    const res = await api.videos();
    videos.value = res.videos || [];
    if (videos.value.length > 0 && !selectedVideoId.value) {
      selectedVideoId.value = videos.value[0]!.id;
    }
  } catch (err) {
    error.value = (err as Error).message || "Gagal memuat naik senarai video.";
  } finally {
    loadingVideos.value = false;
  }
}

async function loadClipsForVideo(id: string) {
  if (!id) {
    clips.value = [];
    return;
  }
  loadingClips.value = true;
  error.value = "";
  try {
    const res = await api.getClips(id);
    clips.value = res.clips || [];
  } catch (err) {
    clips.value = [];
    error.value = (err as Error).message || "Gagal memuat klip.";
  } finally {
    loadingClips.value = false;
  }
}

watch(selectedVideoId, (newId) => {
  if (newId) {
    loadClipsForVideo(newId);
  } else {
    clips.value = [];
  }
});

async function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  uploading.value = true;
  uploadProgress.value = 0;
  error.value = "";

  try {
    const up = await api.uploadVideo(file, (done) => {
      uploadProgress.value = Math.round(done * 100);
    });
    await loadVideos();
    selectedVideoId.value = up.id;
    successMsg.value = `Video "${file.name}" berjaya dimuat naik!`;
  } catch (err) {
    error.value = (err as Error).message || "Gagal memuat naik fail video.";
  } finally {
    uploading.value = false;
    input.value = "";
  }
}

async function triggerFindClips() {
  if (!selectedVideoId.value) {
    error.value = "Sila pilih video terlebih dahulu.";
    return;
  }
  if (!clipFactoryAgent.value) {
    error.value = "Agent Clip Factory / Editor tidak dijumpai dalam office.";
    return;
  }

  analyzing.value = true;
  error.value = "";
  successMsg.value = "";

  try {
    const promptText = [
      `Sila jalankan clip_find untuk video ini:`,
      topicPrompt.value ? `Fokus topik: "${topicPrompt.value}"` : null,
      `Had tempoh: ${minDuration.value}s - ${maxDuration.value}s`,
      `Gunakan whisper untuk kenal pasti sempadan ayat dan ebur128 untuk puncak tenaga suara.`,
      `Pilih klip paling viral dan laporkan skor virality (0-99).`,
    ]
      .filter(Boolean)
      .join("\n");

    const { job } = await api.chat({
      agent_id: clipFactoryAgent.value.id,
      text: promptText,
      attachments: [selectedVideoId.value],
    });
    analysisJobId.value = job.id;
    successMsg.value = `Analisis dihantar kepada ${clipFactoryAgent.value.name}. Video panjang boleh ambil beberapa minit.`;
  } catch (err) {
    error.value = (err as Error).message || "Gagal memulakan analisis klip.";
    analyzing.value = false;
  }
}

// When the analysis job ends: load the clips it saved, or say why there are none
watch(
  () => analysisJob.value?.status,
  async (status) => {
    if (!status || !analysisJob.value) return;
    if (status === "done") {
      analyzing.value = false;
      analysisJobId.value = null;
      await loadClipsForVideo(selectedVideoId.value);
      if (clips.value.length) successMsg.value = `Berjaya! Dijumpai ${clips.value.length} klip.`;
      else {
        successMsg.value = "";
        error.value = `Analisis siap tetapi tiada klip disimpan. Jawapan agent: ${(analysisRun.value?.output ?? "").trim().slice(-300) || "(kosong)"}`;
      }
    } else if (status === "failed" || status === "cancelled") {
      analyzing.value = false;
      successMsg.value = "";
      error.value = `Analisis ${status === "failed" ? "gagal" : "dibatalkan"}: ${analysisRun.value?.error || analysisJob.value.cancel_reason || "tiada sebab diberi"}`;
      analysisJobId.value = null;
    }
  },
);

function openPreview(clip: ClipCandidate) {
  activeClip.value = clip;
  chosenHook.value = clip.chosen_hook || clip.hooks[0] || clip.headline;
}

function closePreview() {
  activeClip.value = null;
}

async function renderToDraft(clip: ClipCandidate) {
  if (!clipFactoryAgent.value) return;
  renderingDraft.value = true;
  error.value = "";

  try {
    const hookText = chosenHook.value || clip.chosen_hook;
    const renderPrompt = [
      `Sila render klip berikut menjadi video menegak 9:16 (TikTok FHD) dan simpan sebagai draf:`,
      `Masa: ${clip.start}s hingga ${clip.end}s (tempoh ${clip.duration}s)`,
      `Hook overlay: "${hookText}"`,
      `Headline: "${clip.headline}"`,
      `Preset kapsyen: ${captionPreset.value}`,
      `Mod reframe: ${reframeMode.value}`,
    ].join("\n");

    await api.chat({
      agent_id: clipFactoryAgent.value.id,
      text: renderPrompt,
      attachments: [selectedVideoId.value],
    });

    successMsg.value = `Klip "${clip.headline}" sedang dirender ke 9:16 dan akan disimpan di Drafts!`;
    closePreview();
  } catch (err) {
    error.value = (err as Error).message || "Gagal memulakan proses render klip.";
  } finally {
    renderingDraft.value = false;
  }
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-accent bg-accent-soft border-accent/30";
  if (score >= 60) return "text-review bg-review-soft border-review/30";
  return "text-muted bg-surface-2 border-line";
}

onMounted(() => {
  loadVideos();
});
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-6 space-y-6">
    <PageHeader
      title="Clip Factory"
      description="Cipta klip video pendek menegak (TikTok, Reels, Shorts) secara automatik dengan pemotongan berpandukan ayat, skor virality (0–99), dan kapsyen beranimasi."
    />

    <!-- Alerts -->
    <div
      v-if="error"
      class="p-4 rounded-xl bg-danger-soft border border-danger/30 text-danger text-sm flex items-center justify-between"
    >
      <div class="flex items-center gap-2">
        <AlertCircle class="w-4 h-4 shrink-0" />
        <span>{{ error }}</span>
      </div>
      <button @click="error = ''" class="text-xs hover:underline">Tutup</button>
    </div>

    <div
      v-if="successMsg"
      class="p-4 rounded-xl bg-accent-soft border border-accent/30 text-accent text-sm flex items-center justify-between"
    >
      <div class="flex items-center gap-2">
        <CheckCircle2 class="w-4 h-4 shrink-0" />
        <span>{{ successMsg }}</span>
      </div>
      <button @click="successMsg = ''" class="text-xs hover:underline">Tutup</button>
    </div>

    <!-- Top Control Bar: Video Selector & Upload -->
    <div class="card p-5 space-y-4">
      <div class="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <div class="flex-1 w-full md:w-auto">
          <label class="block text-xs font-semibold uppercase tracking-wider text-muted mb-2">
            Pilih Video Sumber
          </label>
          <div class="flex gap-2 items-center">
            <select
              v-model="selectedVideoId"
              class="input text-sm min-h-10 w-full"
              :disabled="loadingVideos || analyzing || uploading"
            >
              <option v-if="videos.length === 0" value="">Tiada video dijumpai</option>
              <option v-for="v in videos" :key="v.id" :value="v.id">
                {{ v.name }} ({{ fmtBytes(v.size) }})
              </option>
            </select>

            <label
              class="cursor-pointer shrink-0 inline-flex items-center gap-1.5 px-4 py-2 bg-surface-2 hover:bg-line text-fg text-sm font-medium rounded-xl transition"
            >
              <Upload class="w-4 h-4" />
              <span>Muat Naik</span>
              <input
                type="file"
                accept="video/*"
                class="hidden"
                @change="onFileSelected"
                :disabled="uploading || analyzing"
              />
            </label>
          </div>
        </div>

        <div v-if="uploading" class="w-full md:w-48 text-xs text-muted space-y-1">
          <div class="flex justify-between">
            <span>Memuat naik...</span>
            <span>{{ uploadProgress }}%</span>
          </div>
          <div class="w-full h-1.5 bg-surface-2 rounded-full overflow-hidden">
            <div
              class="h-full bg-accent transition-all duration-200"
              :style="{ width: `${uploadProgress}%` }"
            ></div>
          </div>
        </div>
      </div>

      <!-- Analysis Parameters -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4 pt-4 border-t border-line">
        <div class="md:col-span-2">
          <label class="block text-xs font-medium text-muted mb-1.5">
            Fokus Topik / Kata Kunci (Pilihan)
          </label>
          <input
            v-model="topicPrompt"
            type="text"
            placeholder="cth: harga dan struktur kandang, tips untung..."
            class="input text-sm min-h-10 w-full"
            :disabled="analyzing"
          />
        </div>

        <div>
          <label class="block text-xs font-medium text-muted mb-1.5">
            Gaya Kapsyen
          </label>
          <select
            v-model="captionPreset"
            class="input text-sm min-h-10 w-full"
          >
            <option value="pop">Pop (TikTok Highlight)</option>
            <option value="neon">Neon Glow</option>
            <option value="bold_box">Bold Box</option>
            <option value="karaoke">Karaoke</option>
            <option value="minimal">Minimalist</option>
          </select>
        </div>

        <div>
          <label class="block text-xs font-medium text-muted mb-1.5">
            Mod Reframe 9:16
          </label>
          <select
            v-model="reframeMode"
            class="input text-sm min-h-10 w-full"
          >
            <option value="blur_fit">Blur Background (Text-Safe)</option>
            <option value="crop_center">Center Crop</option>
            <option value="crop_speaker">Speaker Tracking</option>
          </select>
        </div>
      </div>

      <!-- Action Button -->
      <div class="flex items-center justify-between pt-2">
        <div class="flex items-center gap-2 text-xs text-muted">
          <Info class="w-4 h-4 shrink-0" />
          <span v-if="analyzing && analysisJob">
            {{ analysisJob.status === "queued" ? "Menunggu runner…" : analysisJob.status === "waiting_approval" ? "Menunggu kelulusan anda (Approvals)." : analysisRun?.step ? `Sedang: ${analysisRun.step}` : "Sedang berjalan…" }}
          </span>
          <span v-else>Skor virality adalah anggaran AI berdasarkan struktur ayat dan tenaga suara, bukan jaminan tontonan.</span>
        </div>

        <button
          @click="triggerFindClips"
          :disabled="analyzing || uploading || !selectedVideoId"
          class="inline-flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-ink font-medium rounded-xl text-sm transition"
        >
          <Loader2 v-if="analyzing" class="w-4 h-4 animate-spin" />
          <Sparkles v-else class="w-4 h-4" />
          <span>{{ analyzing ? "Sedang Menganalisis..." : "Cari Klip Viral" }}</span>
        </button>
      </div>
    </div>

    <!-- Main Results Section -->
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-base font-semibold text-fg flex items-center gap-2">
          <Scissors class="w-4 h-4 text-accent" />
          <span>Kandungan Klip Terpilih</span>
          <span
            v-if="clips.length > 0"
            class="text-xs px-2 py-0.5 rounded-full bg-surface-2 text-muted font-normal"
          >
            {{ clips.length }} klip
          </span>
        </h2>
        <button
          v-if="selectedVideoId"
          @click="loadClipsForVideo(selectedVideoId)"
          class="text-xs text-muted hover:text-fg inline-flex items-center gap-1 transition"
        >
          <RotateCcw class="w-3.5 h-3.5" />
          <span>Muat Semula</span>
        </button>
      </div>

      <!-- Loading State -->
      <div
        v-if="loadingClips"
        class="p-12 text-center rounded-2xl bg-surface border border-line text-muted space-y-2"
      >
        <Loader2 class="w-6 h-6 animate-spin mx-auto text-accent" />
        <p class="text-sm">Memuat klip video...</p>
      </div>

      <!-- Empty State (Honest: Zero hardcoded mock items) -->
      <div
        v-else-if="clips.length === 0"
        class="p-12 text-center rounded-2xl bg-surface border border-dashed border-line text-muted space-y-3"
      >
        <div class="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center mx-auto text-muted">
          <Scissors class="w-6 h-6" />
        </div>
        <div class="space-y-1">
          <p class="text-sm font-medium text-fg">Belum Ada Klip Dijumpai</p>
          <p class="text-xs text-muted max-w-md mx-auto">
            Pilih video panjang dan tekan "Cari Klip Viral" untuk memulakan analisis audio dan pembahagian ayat automatik.
          </p>
        </div>
      </div>

      <!-- Real Clips Grid -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="clip in clips"
          :key="clip.id"
          class="flex flex-col justify-between p-5 rounded-2xl bg-surface border border-line hover:border-line-strong transition space-y-4"
        >
          <div class="space-y-3">
            <!-- Header: Score + Duration -->
            <div class="flex items-center justify-between">
              <div
                class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border"
                :class="scoreColor(clip.score)"
              >
                <Flame class="w-3.5 h-3.5" />
                <span>{{ clip.score }}/99</span>
                <span class="text-[10px] font-normal opacity-70">Virality</span>
              </div>

              <div class="flex items-center gap-1 text-xs text-muted font-mono">
                <Clock class="w-3.5 h-3.5" />
                <span>{{ clip.duration }}s</span>
                <span class="text-faint">({{ clip.start }}s-{{ clip.end }}s)</span>
              </div>
            </div>

            <!-- Title & Hook -->
            <div>
              <h3 class="text-sm font-semibold text-fg line-clamp-1">
                {{ clip.headline }}
              </h3>
              <p class="text-xs text-accent mt-1 font-medium flex items-center gap-1">
                <span>Hook:</span>
                <span class="italic">"{{ clip.chosen_hook }}"</span>
              </p>
            </div>

            <!-- Reason & Subscores Breakdown -->
            <p class="text-xs text-muted line-clamp-2">
              {{ clip.summary_reason }}
            </p>

            <!-- Subscores Micro Bar -->
            <div class="grid grid-cols-5 gap-1 pt-1 text-[10px] text-muted text-center font-mono">
              <div class="bg-surface-2 rounded py-0.5" title="Hook (30%)">
                <span class="text-muted block text-[9px]">HK</span>
                {{ clip.subscores.hook }}
              </div>
              <div class="bg-surface-2 rounded py-0.5" title="Value (25%)">
                <span class="text-muted block text-[9px]">VL</span>
                {{ clip.subscores.value }}
              </div>
              <div class="bg-surface-2 rounded py-0.5" title="Emotion (20%)">
                <span class="text-muted block text-[9px]">EM</span>
                {{ clip.subscores.emotion }}
              </div>
              <div class="bg-surface-2 rounded py-0.5" title="Flow (15%)">
                <span class="text-muted block text-[9px]">FL</span>
                {{ clip.subscores.flow }}
              </div>
              <div class="bg-surface-2 rounded py-0.5" title="Trend (10%)">
                <span class="text-muted block text-[9px]">TR</span>
                {{ clip.subscores.trend }}
              </div>
            </div>

            <!-- Transcript Preview -->
            <div class="p-2.5 rounded-xl bg-sunken border border-line text-xs text-fg line-clamp-3 italic">
              "{{ clip.transcript }}"
            </div>
          </div>

          <!-- Card Actions -->
          <div class="pt-2 flex items-center gap-2">
            <button
              @click="openPreview(clip)"
              class="flex-1 py-2 px-3 bg-surface-2 hover:bg-line text-fg text-xs font-medium rounded-xl transition text-center"
            >
              Pratonton & Edit
            </button>
            <button
              @click="renderToDraft(clip)"
              class="py-2 px-3 bg-accent hover:bg-accent-hover text-accent-ink text-xs font-medium rounded-xl transition"
              title="Render ke 9:16 dan simpan draf"
            >
              Render 9:16
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Preview / Edit Modal -->
    <div
      v-if="activeClip"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
    >
      <div class="w-full max-w-xl bg-surface border border-line rounded-2xl p-6 space-y-5 shadow-2xl">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div
              class="px-2.5 py-1 rounded-lg text-xs font-bold border"
              :class="scoreColor(activeClip.score)"
            >
              {{ activeClip.score }}/99 Virality
            </div>
            <h3 class="text-sm font-semibold text-fg">
              {{ activeClip.headline }}
            </h3>
          </div>
          <button @click="closePreview" class="text-muted hover:text-fg">
            <X class="w-5 h-5" />
          </button>
        </div>

        <div class="space-y-4">
          <!-- Hook Selection -->
          <div>
            <label class="block text-xs font-medium text-muted mb-1.5">
              Pilih Hook Pembuka (3 Saat Pertama)
            </label>
            <div class="space-y-1.5">
              <label
                v-for="(h, idx) in activeClip.hooks"
                :key="idx"
                class="flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer transition text-xs"
                :class="
                  chosenHook === h
                    ? 'border-accent/50 bg-accent-soft text-accent'
                    : 'border-line bg-sunken/40 text-fg hover:border-line-strong'
                "
              >
                <input
                  type="radio"
                  :name="'hook-opt'"
                  :value="h"
                  v-model="chosenHook"
                  class="text-accent focus:ring-0"
                />
                <span>{{ h }}</span>
              </label>
            </div>
          </div>

          <!-- Transcript -->
          <div>
            <label class="block text-xs font-medium text-muted mb-1">
              Transkrip Ayat Penuh ({{ activeClip.start }}s - {{ activeClip.end }}s)
            </label>
            <div class="p-3 rounded-xl bg-sunken border border-line text-xs text-fg leading-relaxed max-h-32 overflow-y-auto">
              {{ activeClip.transcript }}
            </div>
          </div>
        </div>

        <!-- Modal Actions -->
        <div class="flex items-center justify-end gap-3 pt-2">
          <button
            @click="closePreview"
            class="px-4 py-2 text-xs font-medium text-muted hover:text-fg transition"
          >
            Batal
          </button>
          <button
            @click="renderToDraft(activeClip)"
            :disabled="renderingDraft"
            class="inline-flex items-center gap-2 px-5 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-ink text-xs font-medium rounded-xl transition"
          >
            <Loader2 v-if="renderingDraft" class="w-3.5 h-3.5 animate-spin" />
            <span>{{ renderingDraft ? "Sedang Render..." : "Render & Simpan Draft" }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

