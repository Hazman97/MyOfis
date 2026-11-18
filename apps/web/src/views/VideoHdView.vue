<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch as vueWatch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AlertTriangle, CheckCircle2, Download, Info, LoaderCircle, Send, Sparkles, Upload, XCircle } from "lucide-vue-next";
import { HD_TARGETS, type HdTarget } from "@agent-office/shared";
import PageHeader from "../components/PageHeader.vue";
import { api, type VideoHdItem } from "../api/http.ts";
import { fmtDateTime } from "../format.ts";
import { useOffice } from "../stores/office.ts";

const TARGET_ORDER: HdTarget[] = ["tiktok", "whatsapp", "whatsapp_status"];
const LS_TARGETS_KEY = "ao:videohd:targets";

function loadStoredTargets(): HdTarget[] {
  try {
    const raw = localStorage.getItem(LS_TARGETS_KEY);
    if (!raw) return ["tiktok", "whatsapp"];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const valid = parsed.filter((t): t is HdTarget => TARGET_ORDER.includes(t as HdTarget));
      if (valid.length) return [...new Set(valid)];
    }
  } catch {}
  return ["tiktok", "whatsapp"];
}

function saveStoredTargets(targets: HdTarget[]) {
  try {
    localStorage.setItem(LS_TARGETS_KEY, JSON.stringify(targets));
  } catch {}
}

const route = useRoute();
const router = useRouter();
const office = useOffice();

const items = ref<VideoHdItem[]>([]);
const error = ref("");
const progress = ref<number | null>(null);
const mode = ref<"auto" | "remux" | "reencode">("auto");
const selectedTargets = ref<HdTarget[]>(loadStoredTargets());
const sending = ref<string | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;

// Respect ?target=tiktok (e.g. redirect from /tiktok-hd)
const queryTarget = route.query.target;
if (typeof queryTarget === "string" && TARGET_ORDER.includes(queryTarget as HdTarget)) {
  selectedTargets.value = [queryTarget as HdTarget];
}

vueWatch(selectedTargets, (val) => saveStoredTargets(val), { deep: true });

function toggleTarget(t: HdTarget) {
  if (selectedTargets.value.includes(t)) {
    if (selectedTargets.value.length <= 1) return; // keep at least one target
    selectedTargets.value = selectedTargets.value.filter((x) => x !== t);
  } else {
    selectedTargets.value = TARGET_ORDER.filter((x) => x === t || selectedTargets.value.includes(x));
  }
}

const poster = computed(() => office.agents.find((a) => a.slug === "tiktok-poster" && a.enabled));
const busy = computed(() => items.value.some((i) => i.status === "queued" || i.status === "running"));

interface SourceGroup {
  key: string;
  name: string;
  created_at: string;
  rows: VideoHdItem[];
}

const groups = computed<SourceGroup[]>(() => {
  const map = new Map<string, SourceGroup>();
  for (const item of items.value) {
    const key = item.source.id || `${item.source.name}:${item.created_at.slice(0, 16)}`;
    let g = map.get(key);
    if (!g) {
      g = { key, name: item.source.name || "Video", created_at: item.created_at, rows: [] };
      map.set(key, g);
    }
    g.rows.push(item);
  }
  return [...map.values()];
});

async function load() {
  items.value = (await api.videoHdList()).items;
}

/** Poll while a job is queued or running, so the result shows up by itself. */
function watchJobs() {
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
    if (busy.value) watchJobs();
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
    await api.videoHd(up.id, selectedTargets.value, mode.value);
    await load();
    watchJobs();
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    progress.value = null;
  }
}

async function captionAndPost(item: VideoHdItem) {
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
const remuxed = (i: VideoHdItem) => i.note.includes("No re-encode") || i.note.includes("no re-encode");

function splitNote(note: string): { main: string; warnings: string | null } {
  const idx = note.indexOf("\nWarnings: ");
  if (idx < 0) return { main: note, warnings: null };
  return { main: note.slice(0, idx), warnings: note.slice(idx + "\nWarnings: ".length) };
}
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-6 pb-12">
    <PageHeader
      sign="VIDEO HD"
      title="Video HD"
      description="Prepare one upload for TikTok HD, WhatsApp HD, or WhatsApp Status. Clean matches are remuxed untouched; others are re-encoded once on your PC with zero AI tokens."
    />

    <!-- Upload -->
    <div class="card p-5 space-y-4">
      <!-- Target chips -->
      <div class="space-y-2">
        <span class="block text-xs font-semibold uppercase tracking-wide text-muted">Targets (pick one or more)</span>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="t in TARGET_ORDER"
            :key="t"
            type="button"
            class="btn btn-sm min-h-10 gap-2 rounded-full border px-3.5 transition-colors"
            :class="selectedTargets.includes(t) ? 'border-accent bg-accent/12 text-accent font-semibold' : 'border-line bg-surface-2/60 text-muted hover:text-fg'"
            :aria-pressed="selectedTargets.includes(t)"
            @click="toggleTarget(t)"
          >
            <CheckCircle2 v-if="selectedTargets.includes(t)" :size="14" />
            <span>{{ HD_TARGETS[t].label }}</span>
          </button>
        </div>
      </div>

      <!-- Mode select -->
      <div class="grid gap-3 sm:grid-cols-3">
        <label v-for="m in (['auto', 'remux', 'reencode'] as const)" :key="m" class="flex items-start gap-2.5 rounded-xl border p-3 cursor-pointer min-h-10" :class="mode === m ? 'border-accent bg-accent/5' : 'border-line'">
          <input v-model="mode" type="radio" :value="m" class="mt-0.5" />
          <span class="text-xs leading-relaxed">
            <span class="block font-semibold text-fg">{{ m === "auto" ? "Auto (recommended)" : m === "remux" ? "Keep as is" : "Always re-encode" }}</span>
            <span class="text-muted">{{
              m === "auto" ? "Untouched when it already fits the target, else one clean re-encode." : m === "remux" ? "Never re-encode: only copy streams into a clean MP4." : "Force re-encode to the target spec."
            }}</span>
          </span>
        </label>
      </div>

      <label class="btn btn-primary w-full min-h-11 justify-center gap-2 cursor-pointer" :class="progress !== null && 'opacity-60 cursor-not-allowed'">
        <LoaderCircle v-if="progress !== null" :size="16" class="animate-spin" />
        <Upload v-else :size="16" />
        <span>{{ progress === null ? `Choose a finished video (${selectedTargets.length} target${selectedTargets.length > 1 ? 's' : ''})` : `Uploading ${Math.round(progress * 100)}%` }}</span>
        <input type="file" accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mkv,.m4v,.mov" class="sr-only" :disabled="progress !== null" @change="add" />
      </label>
      <p class="text-xs text-muted">On your phone: open this page in the browser and pick the video from your gallery (Telegram only takes up to 20 MB).</p>
    </div>

    <div v-if="error" class="rounded-xl border border-danger/30 bg-danger-soft p-3.5 text-sm text-danger" role="alert">{{ error }}</div>

    <!-- Results grouped by source video -->
    <div v-if="groups.length" class="space-y-4">
      <section v-for="g in groups" :key="g.key" class="card p-4 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
          <div class="min-w-0">
            <div class="truncate text-sm font-semibold text-fg" :title="g.name">{{ g.name }}</div>
            <div class="text-xs text-muted font-mono">{{ fmtDateTime(g.created_at) }}</div>
          </div>
          <span class="chip text-xs">{{ g.rows.length }} target{{ g.rows.length > 1 ? "s" : "" }}</span>
        </div>

        <ul class="space-y-3">
          <li v-for="i in g.rows" :key="i.job_id" class="rounded-xl border border-line bg-surface-2/40 p-3.5 space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="chip text-xs font-semibold border-accent/30 bg-accent/10 text-accent">{{ HD_TARGETS[i.target].label }}</span>
                <span class="text-xs text-muted font-mono">{{ i.mode }}</span>
              </div>
              <span v-if="i.status === 'queued' || i.status === 'running'" class="chip text-xs flex items-center gap-1"><LoaderCircle :size="12" class="animate-spin" /> {{ i.status === "queued" ? "Waiting for the PC" : "Working" }}</span>
              <span v-else-if="i.status === 'done' && i.result" class="chip text-xs text-accent border-accent/30 flex items-center gap-1"><CheckCircle2 :size="12" /> {{ remuxed(i) ? "Untouched" : "Re-encoded" }}</span>
              <span v-else class="chip text-xs text-danger border-danger/30 flex items-center gap-1"><XCircle :size="12" /> {{ i.status === "cancelled" ? "Stopped" : "Failed" }}</span>
            </div>

            <p v-if="i.note" class="whitespace-pre-line text-xs text-muted leading-relaxed">{{ splitNote(i.note).main }}</p>
            <div v-if="i.note && splitNote(i.note).warnings" class="flex items-start gap-2 rounded-lg border border-signal/30 bg-signal-soft p-2.5 text-xs text-fg">
              <AlertTriangle :size="14" class="mt-0.5 shrink-0 text-signal" />
              <span>{{ splitNote(i.note).warnings }}</span>
            </div>
            <p v-if="i.error" class="text-xs text-danger break-words">{{ i.error }}</p>

            <div v-if="i.result" class="grid gap-3 sm:grid-cols-[176px_1fr] items-start">
              <video
                :src="api.uploadUrl(i.result.id)"
                controls
                playsinline
                preload="metadata"
                class="max-h-56 w-full rounded-lg bg-black object-contain"
                :class="i.target === 'whatsapp' ? 'aspect-video' : 'aspect-9/16'"
              />
              <div class="space-y-2.5">
                <div class="text-xs text-muted font-mono break-all">{{ i.result.name }} · {{ mb(i.result.size) }}</div>
                <div class="flex flex-wrap gap-2">
                  <a :href="api.uploadUrl(i.result.id, true)" class="btn btn-sm min-h-10 gap-1.5"><Download :size="14" /> Download</a>
                  <button
                    v-if="i.target === 'tiktok'"
                    class="btn btn-sm btn-primary min-h-10 gap-1.5"
                    :disabled="!poster || sending === i.job_id"
                    @click="captionAndPost(i)"
                  >
                    <LoaderCircle v-if="sending === i.job_id" :size="14" class="animate-spin" />
                    <Send v-else :size="14" />
                    Caption &amp; post with TikTok Poster
                  </button>
                </div>
                <p v-if="i.target === 'tiktok' && !poster" class="text-xs text-muted flex items-center gap-1"><Sparkles :size="12" /> Turn on the TikTok Poster agent in Agents to write the caption and post.</p>
                <p v-if="i.target === 'whatsapp' || i.target === 'whatsapp_status'" class="flex items-start gap-1.5 text-xs text-muted">
                  <Info :size="13" class="mt-0.5 shrink-0 text-accent" />
                  <span>Nak kualiti asal 100%? Hantar fail asal sebagai <strong>Document</strong>.</span>
                </p>
              </div>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
