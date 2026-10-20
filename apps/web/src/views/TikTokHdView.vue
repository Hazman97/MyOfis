<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { CheckCircle2, Download, LoaderCircle, Send, Sparkles, Upload, XCircle } from "lucide-vue-next";
import PageHeader from "../components/PageHeader.vue";
import { api, type TikTokHdItem } from "../api/http.ts";
import { fmtDateTime } from "../format.ts";
import { useOffice } from "../stores/office.ts";

/**
 * TikTok HD (owner request, 2026-10-20, like zilemmethod.com): drop a finished video (edited on the
 * phone, CapCut…). The runner PC checks it against what TikTok plays: if it already fits, the
 * streams are only copied into a clean MP4 (no quality change); otherwise it is re-encoded once to
 * 1080×1920. No AI, no tokens. Then download it, or hand it to TikTok Poster for a caption + post.
 */
const router = useRouter();
const office = useOffice();
const items = ref<TikTokHdItem[]>([]);
const error = ref("");
const progress = ref<number | null>(null);
const mode = ref<"auto" | "remux" | "reencode">("auto");
const sending = ref<string | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;

const poster = computed(() => office.agents.find((a) => a.slug === "tiktok-poster" && a.enabled));
const busy = computed(() => items.value.some((i) => i.status === "queued" || i.status === "running"));

async function load() {
  items.value = (await api.tiktokHdList()).items;
}

/** Poll while a job is queued or running, so the result shows up by itself. */
function watch() {
  if (timer) return;
  timer = setInterval(async () => {
    try {
      await load();
    } catch {
      /* next tick */
    }
    if (!busy.value && timer) {
      clearInterval(timer);
      timer = null;
    }
  }, 3000);
}

onMounted(async () => {
  try {
    await load();
    if (busy.value) watch();
  } catch (e) {
    error.value = (e as Error).message;
  }
});
onBeforeUnmount(() => timer && clearInterval(timer));

async function add(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  error.value = "";
  progress.value = 0;
  try {
    const up = await api.uploadVideo(file, (p) => (progress.value = p));
    await api.tiktokHd(up.id, mode.value);
    await load();
    watch();
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    progress.value = null;
  }
}

async function captionAndPost(item: TikTokHdItem) {
  if (!poster.value || !item.result) return;
  sending.value = item.job_id;
  error.value = "";
  try {
    await api.chat({
      agent_id: poster.value.id,
      text: `Video ni dah siap HD untuk TikTok (${item.result.name}). Tulis caption dan sediakan draf untuk post.`,
      attachments: [item.result.id],
    });
    await router.push({ path: "/chat", query: { agent: "tiktok-poster" } });
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    sending.value = null;
  }
}

const mb = (bytes: number) => `${Math.round((bytes / 1024 ** 2) * 10) / 10} MB`;
const remuxed = (i: TikTokHdItem) => i.note.startsWith("No re-encode");
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-6 pb-12">
    <PageHeader
      sign="TIKTOK HD"
      title="TikTok HD"
      description="Drop a finished video. If it already fits TikTok, it is kept untouched (only the file is cleaned up); if not, it is re-encoded once to 1080×1920. Runs on your PC, no AI tokens."
    />

    <!-- Upload -->
    <div class="card p-5 space-y-4">
      <div class="grid gap-3 sm:grid-cols-3">
        <label v-for="m in (['auto', 'remux', 'reencode'] as const)" :key="m" class="flex items-start gap-2.5 rounded-xl border p-3 cursor-pointer min-h-10" :class="mode === m ? 'border-accent bg-accent/5' : 'border-line'">
          <input v-model="mode" type="radio" :value="m" class="mt-0.5" />
          <span class="text-xs leading-relaxed">
            <span class="block font-semibold text-fg">{{ m === "auto" ? "Auto (recommended)" : m === "remux" ? "Keep as is" : "Always re-encode" }}</span>
            <span class="text-muted">{{
              m === "auto" ? "Untouched when it fits TikTok, else one clean re-encode." : m === "remux" ? "Never re-encode: only clean up the file (like Zilem)." : "Force 1080×1920 at 30/60 fps."
            }}</span>
          </span>
        </label>
      </div>
      <label class="btn btn-primary w-full min-h-11 justify-center gap-2 cursor-pointer" :class="progress !== null && 'opacity-60 cursor-not-allowed'">
        <LoaderCircle v-if="progress !== null" :size="16" class="animate-spin" />
        <Upload v-else :size="16" />
        <span>{{ progress === null ? "Choose a finished video" : `Uploading ${Math.round(progress * 100)}%` }}</span>
        <input type="file" accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mkv,.m4v,.mov" class="sr-only" :disabled="progress !== null" @change="add" />
      </label>
      <p class="text-xs text-muted">On your phone: open this page in the browser and pick the video from your gallery (Telegram only takes up to 20 MB).</p>
    </div>

    <div v-if="error" class="rounded-xl border border-danger/30 bg-danger-soft p-3.5 text-sm text-danger" role="alert">{{ error }}</div>

    <!-- Results -->
    <ul v-if="items.length" class="space-y-3">
      <li v-for="i in items" :key="i.job_id" class="card p-4 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="truncate text-sm font-semibold text-fg" :title="i.source.name">{{ i.source.name || "Video" }}</div>
            <div class="text-xs text-muted font-mono">{{ fmtDateTime(i.created_at) }} · {{ i.mode }}</div>
          </div>
          <span v-if="i.status === 'queued' || i.status === 'running'" class="chip text-xs flex items-center gap-1"><LoaderCircle :size="12" class="animate-spin" /> {{ i.status === "queued" ? "Waiting for the PC" : "Working" }}</span>
          <span v-else-if="i.status === 'done' && i.result" class="chip text-xs text-accent border-accent/30 flex items-center gap-1"><CheckCircle2 :size="12" /> {{ remuxed(i) ? "Untouched" : "Re-encoded" }}</span>
          <span v-else class="chip text-xs text-danger border-danger/30 flex items-center gap-1"><XCircle :size="12" /> {{ i.status === "cancelled" ? "Stopped" : "Failed" }}</span>
        </div>

        <p v-if="i.note" class="whitespace-pre-line text-xs text-muted leading-relaxed">{{ i.note }}</p>
        <p v-if="i.error" class="text-xs text-danger break-words">{{ i.error }}</p>

        <div v-if="i.result" class="grid gap-3 sm:grid-cols-[160px_1fr] items-start">
          <video :src="api.uploadUrl(i.result.id)" controls playsinline preload="metadata" class="w-40 max-w-full aspect-[9/16] rounded-lg bg-black object-contain" />
          <div class="space-y-2">
            <div class="text-xs text-muted font-mono break-all">{{ i.result.name }} · {{ mb(i.result.size) }}</div>
            <div class="flex flex-wrap gap-2">
              <a :href="api.uploadUrl(i.result.id, true)" class="btn btn-sm min-h-10 gap-1.5"><Download :size="14" /> Download</a>
              <button class="btn btn-sm btn-primary min-h-10 gap-1.5" :disabled="!poster || sending === i.job_id" @click="captionAndPost(i)">
                <LoaderCircle v-if="sending === i.job_id" :size="14" class="animate-spin" />
                <Send v-else :size="14" />
                Caption &amp; post with TikTok Poster
              </button>
            </div>
            <p v-if="!poster" class="text-xs text-muted flex items-center gap-1"><Sparkles :size="12" /> Turn on the TikTok Poster agent in Agents to write the caption and post.</p>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
