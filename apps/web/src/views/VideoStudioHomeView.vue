<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import {
  ArrowRight,
  AudioLines,
  Bot,
  Clapperboard,
  Film,
  LoaderCircle,
  Plus,
  Upload,
  Wand2,
} from "lucide-vue-next";
import PageHeader from "../components/PageHeader.vue";
import { api, type VideoListItem } from "../api/http.ts";
import { fmtDateTime } from "../format.ts";

/**
 * Video Studio home (owner request: "two ways in"): send a video here and open it in the studio,
 * or pick one you sent before / Editor made. The other way in is chatting with Editor.
 */
const router = useRouter();
const videos = ref<VideoListItem[]>([]);
const error = ref("");
const progress = ref<number | null>(null);

async function load() {
  videos.value = (await api.videos()).videos;
}
onMounted(() => load().catch((e) => (error.value = (e as Error).message)));

async function add(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  error.value = "";
  progress.value = 0;
  try {
    const up = await api.uploadVideo(file, (p) => (progress.value = p));
    await router.push({ name: "studio", params: { id: up.id } });
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    progress.value = null;
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6 pb-12">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <PageHeader
        sign="VIDEO STUDIO"
        title="Video Studio"
        description="Cut, polish, and re-render videos on your PC without AI tokens. Let Editor suggest edits or tweak timelines manually."
      />

      <div class="flex flex-wrap items-center gap-2.5 shrink-0">
        <RouterLink
          to="/chat?agent=editor"
          class="btn btn-sm min-h-10 px-3.5 flex items-center gap-2"
        >
          <Bot :size="15" class="text-accent" />
          <span>Chat with Editor</span>
        </RouterLink>

        <label
          class="btn btn-sm btn-primary min-h-10 px-4 flex items-center gap-2 cursor-pointer shadow-xs"
          :class="progress !== null && 'opacity-60 cursor-not-allowed'"
        >
          <LoaderCircle v-if="progress !== null" :size="15" class="animate-spin" />
          <Plus v-else :size="15" />
          <span>{{ progress === null ? "Add video" : `Uploading ${Math.round(progress * 100)}%` }}</span>
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mkv,.m4v"
            class="sr-only"
            :disabled="progress !== null"
            @change="add"
          />
        </label>
      </div>
    </div>

    <!-- Error notice -->
    <div
      v-if="error"
      class="rounded-xl border border-danger/30 bg-danger-soft p-3.5 text-sm text-danger"
      role="alert"
    >
      {{ error }}
    </div>

    <!-- Empty State explaining the two ways in -->
    <div v-if="!videos.length" class="space-y-6">
      <div class="card p-6 sm:p-8 space-y-6 border-line bg-surface/80 text-center max-w-2xl mx-auto">
        <div class="mx-auto flex size-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
          <Clapperboard :size="24" />
        </div>
        <div class="space-y-1.5">
          <h2 class="text-base sm:text-lg font-semibold text-fg">Two ways into the Video Studio</h2>
          <p class="text-xs sm:text-sm text-muted max-w-md mx-auto leading-relaxed">
            Create content with Editor in Chat or bring your own raw recordings to refine and export.
          </p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2 text-left">
          <!-- Way 1 -->
          <div class="rounded-xl border border-line bg-surface-2/40 p-4 space-y-3 flex flex-col justify-between">
            <div class="space-y-2">
              <div class="flex items-center gap-2 text-xs font-semibold text-fg">
                <span class="flex size-5 items-center justify-center rounded-full bg-accent/15 text-accent text-[11px] font-bold">1</span>
                <span>Chat with Editor</span>
              </div>
              <p class="text-xs text-muted leading-relaxed">
                Send a clip to Editor in Chat to brainstorm edits, ask for 30s TikTok/Reels cuts, or get edit options.
              </p>
            </div>
            <RouterLink
              to="/chat?agent=editor"
              class="btn btn-sm w-full min-h-9 text-xs justify-center gap-1.5 font-medium"
            >
              <Bot :size="13" class="text-accent" /> Open Editor Chat
            </RouterLink>
          </div>

          <!-- Way 2 -->
          <div class="rounded-xl border border-line bg-surface-2/40 p-4 space-y-3 flex flex-col justify-between">
            <div class="space-y-2">
              <div class="flex items-center gap-2 text-xs font-semibold text-fg">
                <span class="flex size-5 items-center justify-center rounded-full bg-accent/15 text-accent text-[11px] font-bold">2</span>
                <span>Upload video directly</span>
              </div>
              <p class="text-xs text-muted leading-relaxed">
                Upload your raw footage here. Whisper speech recognition turns speech into timed words so you can drop pauses and add subtitles.
              </p>
            </div>
            <label
              class="btn btn-sm btn-primary w-full min-h-9 text-xs justify-center gap-1.5 font-medium cursor-pointer"
              :class="progress !== null && 'opacity-60 cursor-not-allowed'"
            >
              <Upload :size="13" />
              <span>{{ progress === null ? "Upload video file" : `Uploading ${Math.round(progress * 100)}%` }}</span>
              <input
                type="file"
                accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mkv,.m4v"
                class="sr-only"
                :disabled="progress !== null"
                @change="add"
              />
            </label>
          </div>
        </div>
      </div>
    </div>

    <!-- Video Cards Grid -->
    <div v-else class="space-y-3">
      <div class="flex items-center justify-between px-1">
        <span class="sign text-xs font-semibold text-fg">
          Recent videos ({{ videos.length }})
        </span>
      </div>

      <ul class="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        <li v-for="v in videos" :key="v.id">
          <RouterLink
            :to="{ name: 'studio', params: { id: v.id } }"
            class="card p-4 space-y-3 hover:border-accent hover:shadow-card group transition-all bg-surface/80 h-full flex flex-col justify-between"
          >
            <div class="space-y-2.5">
              <!-- Card Top Badges -->
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-1.5">
                  <span
                    v-if="v.run_id"
                    class="chip chip-sm text-[10px] text-accent bg-accent/10 border-accent/25 flex items-center gap-1 font-medium"
                  >
                    <Wand2 :size="10" /> Made by Editor
                  </span>
                  <span
                    v-else
                    class="chip chip-sm text-[10px] text-muted flex items-center gap-1"
                  >
                    <Film :size="10" /> Your video
                  </span>
                </div>

                <span
                  v-if="v.has_transcript"
                  class="chip chip-sm text-[10px] text-accent border-accent/30 bg-accent/5 flex items-center gap-1 font-mono"
                  title="Whisper speech transcript available"
                >
                  <AudioLines :size="10" /> Transcript
                </span>
              </div>

              <!-- Title -->
              <h3 class="font-semibold text-sm text-fg group-hover:text-accent transition-colors truncate" :title="v.name">
                {{ v.name }}
              </h3>
            </div>

            <!-- Card Bottom Meta -->
            <div class="pt-2 border-t border-line/50 flex items-center justify-between text-xs text-muted">
              <span class="text-[11px] font-mono">{{ fmtDateTime(v.created_at) }}</span>
              <div class="flex items-center gap-2">
                <span class="text-[11px] font-mono">{{ Math.round(v.size / (1024 * 1024)) }} MB</span>
                <ArrowRight :size="13" class="text-faint group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
              </div>
            </div>
          </RouterLink>
        </li>
      </ul>
    </div>
  </div>
</template>
