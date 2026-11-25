<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch as vueWatch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AlertTriangle, CheckCircle2, Download, Info, LoaderCircle, Play, Send, Sparkles, Upload, X, XCircle } from "lucide-vue-next";
import {
  HD_TARGETS,
  PLACEMENT_INFO,
  SOCIAL_PLACEMENTS,
  hdOutputsFor,
  type HdTarget,
  type SocialPlacement,
} from "@agent-office/shared";
import PageHeader from "../components/PageHeader.vue";
import { api, type VideoHdItem } from "../api/http.ts";
import { fmtDateTime } from "../format.ts";
import { useOffice } from "../stores/office.ts";

const ALL_PLACEMENTS: SocialPlacement[] = SOCIAL_PLACEMENTS.map((p) => p.id);
const PLATFORM_GROUPS = ["TikTok", "Instagram", "Facebook", "YouTube", "Threads", "WhatsApp"] as const;
const LS_PLACEMENTS_KEY = "ao:videohd:placements";

function loadStoredPlacements(): SocialPlacement[] {
  try {
    const raw = localStorage.getItem(LS_PLACEMENTS_KEY);
    if (!raw) return ["tiktok", "ig_reels", "yt_shorts", "whatsapp"];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const valid = parsed.filter((p): p is SocialPlacement => ALL_PLACEMENTS.includes(p as SocialPlacement));
      if (valid.length) return [...new Set(valid)];
    }
  } catch {}
  return ["tiktok", "ig_reels", "yt_shorts", "whatsapp"];
}

function saveStoredPlacements(placements: SocialPlacement[]) {
  try {
    localStorage.setItem(LS_PLACEMENTS_KEY, JSON.stringify(placements));
  } catch {}
}

const route = useRoute();
const router = useRouter();
const office = useOffice();

const items = ref<VideoHdItem[]>([]);
const error = ref("");
const progress = ref<number | null>(null);
const mode = ref<"auto" | "remux" | "reencode">("auto");
const selectedPlacements = ref<SocialPlacement[]>(loadStoredPlacements());
const sending = ref<string | null>(null);
const playingIds = ref<Set<string>>(new Set());
let timer: ReturnType<typeof setInterval> | null = null;

// Respect ?target=tiktok (e.g. redirect from /tiktok-hd)
const queryTarget = route.query.target;
if (queryTarget === "tiktok") selectedPlacements.value = ["tiktok"];
else if (queryTarget === "whatsapp") selectedPlacements.value = ["whatsapp"];
else if (queryTarget === "whatsapp_status") selectedPlacements.value = ["whatsapp_status"];

vueWatch(selectedPlacements, (val) => saveStoredPlacements(val), { deep: true });

function togglePlacement(p: SocialPlacement) {
  if (selectedPlacements.value.includes(p)) {
    if (selectedPlacements.value.length <= 1) return;
    selectedPlacements.value = selectedPlacements.value.filter((x) => x !== p);
  } else {
    selectedPlacements.value = ALL_PLACEMENTS.filter((x) => x === p || selectedPlacements.value.includes(x));
  }
}

const allSelected = computed(() => selectedPlacements.value.length === ALL_PLACEMENTS.length);
function toggleAllPlatforms() {
  selectedPlacements.value = allSelected.value ? ["tiktok"] : [...ALL_PLACEMENTS];
}

const plannedOutputs = computed(() => hdOutputsFor(selectedPlacements.value));

const planSummary = computed(() => {
  const groups = plannedOutputs.value;
  const parts = groups.map((g) => {
    const label = HD_TARGETS[g.target].label;
    const names = g.covers.map((c) => PLACEMENT_INFO[c].short).join(", ");
    if (g.target === "story") return `${label} (${names}; pecah ≤60s jika panjang)`;
    if (g.covers.length > 1) return `${label} (${names})`;
    return label;
  });
  return `${groups.length} fail akan dibuat: ${parts.join(" · ")}`;
});

function togglePlay(uploadId: string) {
  const next = new Set(playingIds.value);
  if (next.has(uploadId)) next.delete(uploadId);
  else next.add(uploadId);
  playingIds.value = next;
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

function filesOf(item: VideoHdItem): { id: string; name: string; size: number }[] {
  if (item.results?.length) return item.results;
  return item.result ? [item.result] : [];
}

function canCaptionTikTok(item: VideoHdItem): boolean {
  return item.target === "tiktok" || (item.target === "vertical" && (item.covers?.includes("tiktok") ?? true));
}

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
    await api.videoHd(up.id, { placements: selectedPlacements.value }, mode.value);
    await load();
    watchJobs();
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    progress.value = null;
  }
}

async function captionAndPost(item: VideoHdItem) {
  const first = filesOf(item)[0];
  if (!poster.value || !first) return;
  sending.value = item.job_id;
  error.value = "";
  try {
    await api.chat({
      agent_id: poster.value.id,
      text: `Video ni dah siap HD untuk TikTok (${first.name}). Tulis caption dan sediakan draf untuk post.`,
      attachments: [first.id],
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
const targetLabel = (t: HdTarget) => HD_TARGETS[t]?.label ?? t;

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
      description="Tanda platform yang anda mahu. Sistem hanya buat fail yang betul-betul berbeza dan label setiap fail dengan platform yang diliputinya."
    />

    <!-- Upload -->
    <div class="card p-5 space-y-4">
      <!-- Platform chips grouped by platform -->
      <div class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-xs font-semibold uppercase tracking-wide text-muted">Platform (pilih satu atau lebih)</span>
          <button
            type="button"
            class="btn btn-sm min-h-9 rounded-full border px-3 text-xs"
            :class="allSelected ? 'border-accent bg-accent/12 text-accent font-semibold' : 'border-line bg-surface-2/60 text-muted hover:text-fg'"
            @click="toggleAllPlatforms"
          >
            {{ allSelected ? "✓ Semua platform" : "Semua platform" }}
          </button>
        </div>

        <div class="grid gap-2.5 sm:grid-cols-2">
          <div
            v-for="group in PLATFORM_GROUPS"
            :key="group"
            class="rounded-xl border border-line/80 bg-surface-2/30 p-3 space-y-2"
          >
            <div class="text-[11px] font-semibold uppercase tracking-wide text-muted">{{ group }}</div>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="p in SOCIAL_PLACEMENTS.filter((x) => x.platform === group)"
                :key="p.id"
                type="button"
                class="btn btn-sm min-h-9 gap-1.5 rounded-full border px-3 text-xs transition-colors"
                :class="selectedPlacements.includes(p.id) ? 'border-accent bg-accent/12 text-accent font-semibold' : 'border-line bg-surface text-muted hover:text-fg'"
                :aria-pressed="selectedPlacements.includes(p.id)"
                @click="togglePlacement(p.id)"
              >
                <CheckCircle2 v-if="selectedPlacements.includes(p.id)" :size="13" />
                <span>{{ p.label }}</span>
              </button>
            </div>
          </div>
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

      <!-- Plan preview line -->
      <div class="rounded-xl border border-accent/25 bg-accent/5 px-3.5 py-2.5 text-xs text-fg leading-relaxed">
        {{ planSummary }}
      </div>

      <label class="btn btn-primary w-full min-h-11 justify-center gap-2 cursor-pointer" :class="progress !== null && 'opacity-60 cursor-not-allowed'">
        <LoaderCircle v-if="progress !== null" :size="16" class="animate-spin" />
        <Upload v-else :size="16" />
        <span>{{ progress === null ? `Pilih video siap (${plannedOutputs.length} fail)` : `Uploading ${Math.round(progress * 100)}%` }}</span>
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
          <span class="chip text-xs">{{ g.rows.length }} fail</span>
        </div>

        <ul class="space-y-3">
          <li v-for="i in g.rows" :key="i.job_id" class="rounded-xl border border-line bg-surface-2/40 p-3.5 space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="chip text-xs font-semibold border-accent/30 bg-accent/10 text-accent">{{ targetLabel(i.target) }}</span>
                <span
                  v-for="c in i.covers ?? []"
                  :key="c"
                  class="chip text-[11px] bg-surface border-line text-muted"
                >
                  {{ PLACEMENT_INFO[c]?.short ?? c }}
                </span>
                <span class="text-xs text-muted font-mono">{{ i.mode }}</span>
              </div>
              <span v-if="i.status === 'queued' || i.status === 'running'" class="chip text-xs flex items-center gap-1"><LoaderCircle :size="12" class="animate-spin" /> {{ i.status === "queued" ? "Waiting for the PC" : "Working" }}</span>
              <span v-else-if="i.status === 'done' && filesOf(i).length" class="chip text-xs text-accent border-accent/30 flex items-center gap-1"><CheckCircle2 :size="12" /> {{ remuxed(i) ? "Untouched" : "Re-encoded" }}</span>
              <span v-else class="chip text-xs text-danger border-danger/30 flex items-center gap-1"><XCircle :size="12" /> {{ i.status === "cancelled" ? "Stopped" : "Failed" }}</span>
            </div>

            <p v-if="i.note" class="whitespace-pre-line text-xs text-muted leading-relaxed">{{ splitNote(i.note).main }}</p>
            <div v-if="i.note && splitNote(i.note).warnings" class="flex items-start gap-2 rounded-lg border border-signal/30 bg-signal-soft p-2.5 text-xs text-fg">
              <AlertTriangle :size="14" class="mt-0.5 shrink-0 text-signal" />
              <span>{{ splitNote(i.note).warnings }}</span>
            </div>
            <p v-if="i.error" class="text-xs text-danger break-words">{{ i.error }}</p>

            <div v-if="filesOf(i).length" class="space-y-2.5">
              <div v-for="(f, idx) in filesOf(i)" :key="f.id" class="space-y-2 rounded-lg border border-line/70 bg-surface p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="min-w-0">
                    <div class="text-xs font-semibold text-fg" v-if="filesOf(i).length > 1">Bahagian {{ idx + 1 }} / {{ filesOf(i).length }}</div>
                    <div class="text-xs text-muted font-mono break-all">{{ f.name }} · {{ mb(f.size) }}</div>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <button type="button" class="btn btn-sm min-h-10 gap-1.5" @click="togglePlay(f.id)">
                      <X v-if="playingIds.has(f.id)" :size="14" />
                      <Play v-else :size="14" />
                      {{ playingIds.has(f.id) ? "Tutup" : "Tengok" }}
                    </button>
                    <a :href="api.uploadUrl(f.id, true)" class="btn btn-sm min-h-10 gap-1.5"><Download :size="14" /> Download</a>
                    <button
                      v-if="idx === 0 && canCaptionTikTok(i)"
                      class="btn btn-sm btn-primary min-h-10 gap-1.5"
                      :disabled="!poster || sending === i.job_id"
                      @click="captionAndPost(i)"
                    >
                      <LoaderCircle v-if="sending === i.job_id" :size="14" class="animate-spin" />
                      <Send v-else :size="14" />
                      Caption &amp; post
                    </button>
                  </div>
                </div>
                <video
                  v-if="playingIds.has(f.id)"
                  :src="api.uploadUrl(f.id)"
                  controls
                  playsinline
                  preload="metadata"
                  class="max-h-72 w-full rounded-lg bg-black object-contain"
                />
              </div>
              <p v-if="canCaptionTikTok(i) && !poster" class="text-xs text-muted flex items-center gap-1"><Sparkles :size="12" /> Turn on the TikTok Poster agent in Agents to write the caption and post.</p>
              <p v-if="i.target === 'whatsapp' || i.target === 'whatsapp_status'" class="flex items-start gap-1.5 text-xs text-muted">
                <Info :size="13" class="mt-0.5 shrink-0 text-accent" />
                <span>Nak kualiti asal 100%? Hantar fail asal sebagai <strong>Document</strong>.</span>
              </p>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
