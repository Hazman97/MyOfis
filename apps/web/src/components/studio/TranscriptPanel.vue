<script setup lang="ts">
import { computed, watch } from "vue";
import { AudioLines, LoaderCircle, Mic, Play, Sparkles } from "lucide-vue-next";
import { isFiller, type Transcript } from "@agent-office/shared";

/**
 * TranscriptPanel (Task 015):
 * Displays speech in the source video word-by-word with timestamps (whisper.cpp).
 * - Highlights current active word and scrolls it into view.
 * - Shows pauses >= 1s as pause chips.
 * - Strikethrough and dimming on filler words.
 * - Clicking a word seeks the video player.
 */
const props = withDefaults(
  defineProps<{
    transcript: Transcript | null;
    fileNumber?: number;
    currentTime?: number;
    busy?: boolean;
  }>(),
  {
    fileNumber: 1,
    currentTime: 0,
    busy: false,
  },
);

const emit = defineEmits<{
  (e: "seek", seconds: number): void;
  (e: "transcribe"): void;
}>();

const words = computed(() => props.transcript?.words ?? []);

const activeIndex = computed(() => {
  if (!words.value.length) return -1;
  const t = props.currentTime;
  return words.value.findIndex((w) => w.s <= t && t <= w.e);
});

// Auto-scroll the active word into view smoothly
watch(activeIndex, (idx) => {
  if (idx >= 0) {
    const el = document.getElementById(`tw-${idx}`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }
});

function getPauseGap(idx: number): number | null {
  if (idx === 0) return null;
  const prev = words.value[idx - 1];
  const curr = words.value[idx];
  if (!prev || !curr) return null;
  const gap = Math.round((curr.s - prev.e) * 10) / 10;
  return gap >= 1.0 ? gap : null;
}
</script>

<template>
  <div class="card p-3.5 space-y-3 border-line/80 bg-surface/50">
    <!-- Header -->
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line/40 pb-2.5">
      <div class="flex items-center gap-2">
        <span class="sign flex items-center gap-1.5 font-semibold text-xs text-fg">
          <AudioLines :size="14" class="text-accent" />
          Transcript
        </span>
        <span v-if="fileNumber > 1" class="chip chip-sm text-[10px]">
          File #{{ fileNumber }}
        </span>
      </div>

      <!-- Stats or Transcribe Status -->
      <div v-if="transcript" class="flex items-center gap-1.5 text-xs">
        <span class="chip chip-sm text-[10px] uppercase font-mono">{{ transcript.language }}</span>
        <span class="chip chip-sm text-[10px] font-mono">{{ Math.round(transcript.duration * 10) / 10 }}s</span>
        <span class="chip chip-sm text-[10px]">{{ words.length }} words</span>
      </div>
      <button
        v-if="transcript"
        type="button"
        class="text-[11px] text-accent hover:underline flex items-center gap-1 min-h-7"
        :disabled="busy"
        title="Re-run whisper transcription"
        @click="$emit('transcribe')"
      >
        <LoaderCircle v-if="busy" :size="12" class="animate-spin" />
        <span v-else>Re-transcribe</span>
      </button>
    </div>

    <!-- Active transcript words view -->
    <div
      v-if="transcript && words.length"
      class="max-h-60 overflow-y-auto rounded-lg border border-line bg-surface-2/40 p-3 leading-relaxed select-text space-y-2 text-xs scroll-smooth"
    >
      <div class="flex flex-wrap items-center gap-x-1 gap-y-1">
        <template v-for="(w, idx) in words" :key="idx">
          <!-- Pause chip between words -->
          <span
            v-if="getPauseGap(idx) !== null"
            class="chip chip-sm mx-1 px-1.5 py-0 text-[10px] text-muted bg-sunken/80 border-line/60 font-mono inline-flex items-center gap-0.5 select-none"
            :title="`Pause ${getPauseGap(idx)}s`"
          >
            ⏸ {{ getPauseGap(idx) }}s
          </span>

          <!-- Word -->
          <button
            :id="`tw-${idx}`"
            type="button"
            class="cursor-pointer select-none rounded px-1 py-0.5 text-left transition-all leading-normal text-xs"
            :class="[
              isFiller(w.w)
                ? 'line-through text-muted/50 hover:text-muted'
                : 'text-fg hover:bg-surface hover:shadow-xs',
              activeIndex === idx
                ? 'bg-accent text-accent-ink font-semibold ring-1 ring-accent shadow-xs scale-105'
                : ''
            ]"
            :title="`Seek to ${w.s.toFixed(1)}s`"
            @click="$emit('seek', w.s)"
          >
            {{ w.w }}
          </button>
        </template>
      </div>
    </div>

    <!-- Transcript available but no words found -->
    <div v-else-if="transcript && !words.length" class="p-4 text-center text-xs text-muted">
      No speech detected in this video.
    </div>

    <!-- No transcript yet state -->
    <div v-else class="space-y-3 p-2 text-center">
      <div class="mx-auto flex size-10 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Mic :size="18" />
      </div>
      <div class="space-y-1 max-w-sm mx-auto">
        <h4 class="text-xs sm:text-sm font-semibold text-fg">No transcript yet</h4>
        <p class="text-[11px] text-muted leading-relaxed">
          whisper.cpp turns speech into timed words on your PC runner. Free, private, and uses no AI tokens.
        </p>
      </div>

      <div>
        <button
          type="button"
          class="btn btn-sm btn-primary min-h-9 px-4 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
          :disabled="busy"
          @click="$emit('transcribe')"
        >
          <LoaderCircle v-if="busy" :size="14" class="animate-spin" />
          <AudioLines v-else :size="14" />
          <span>{{ busy ? "Transcribing on your PC…" : "Transcribe (free, on your PC)" }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
