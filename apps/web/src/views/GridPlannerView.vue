<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Calendar, Download, GripVertical, Images, LoaderCircle, Palette, Sparkles } from "lucide-vue-next";
import {
  DEFAULT_BRAND_KIT,
  DESIGN_ICONS,
  TIMEZONE,
  type BrandHighlight,
  type BrandKit,
  type ContentDraft,
  type Project,
} from "@agent-office/shared";
import PageHeader from "../components/PageHeader.vue";
import { api } from "../api/http.ts";
import { fmtDateTime } from "../format.ts";

const projects = ref<Project[]>([]);
const selectedId = ref<string>("");
const brand = ref<BrandKit>(DEFAULT_BRAND_KIT);
const drafts = ref<ContentDraft[]>([]);
const loading = ref(false);
const error = ref("");
const swapping = ref(false);
const dragId = ref<string | null>(null);
const dragOverId = ref<string | null>(null);

const selectedProject = computed(() => projects.value.find((p) => p.id === selectedId.value) ?? null);

function firstImage(d: ContentDraft): string | null {
  return d.meta?.images?.[0] || d.meta?.cover_upload_id || null;
}

function isScheduled(d: ContentDraft): boolean {
  return !!d.publish_at && (d.status === "approved" || d.status === "edited");
}

function isStoryDraft(d: ContentDraft): boolean {
  const title = d.title.toLowerCase();
  const kind = d.kind.toLowerCase();
  return title.includes("story") || kind.includes("story");
}

/**
 * Instagram 3-column grid order (newest first):
 * Pending -> Scheduled (by publish_at) -> Published drafts with an image for instagram.
 */
const gridItems = computed(() => {
  const ig = drafts.value.filter((d) => d.platform === "instagram" && d.status !== "rejected" && !!firstImage(d));
  const pending = ig
    .filter((d) => d.status === "draft")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const scheduled = ig
    .filter((d) => isScheduled(d))
    .sort((a, b) => Date.parse(b.publish_at!) - Date.parse(a.publish_at!));
  const published = ig
    .filter((d) => d.status === "published")
    .sort((a, b) => Date.parse(b.decided_at ?? b.created_at) - Date.parse(a.decided_at ?? a.created_at));
  return [...pending, ...scheduled, ...published];
});

interface StoryDay {
  key: string;
  label: string;
  items: ContentDraft[];
}

const storyWeek = computed<StoryDay[]>(() => {
  const fmtDay = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE });
  const fmtLabel = new Intl.DateTimeFormat("ms-MY", { timeZone: TIMEZONE, weekday: "short", day: "numeric", month: "short" });
  const now = Date.now();
  const days: StoryDay[] = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(now + i * 86_400_000);
    days.push({ key: fmtDay.format(dt), label: fmtLabel.format(dt), items: [] });
  }
  const byKey = new Map(days.map((d) => [d.key, d]));
  const stories = drafts.value.filter((d) => (d.platform === "instagram" || d.platform === "facebook") && d.status !== "rejected" && isStoryDraft(d));
  for (const s of stories) {
    const when = s.publish_at || s.created_at;
    const k = fmtDay.format(new Date(when));
    const bucket = byKey.get(k);
    if (bucket) bucket.items.push(s);
  }
  return days;
});

async function loadProject() {
  if (!selectedId.value) return;
  loading.value = true;
  error.value = "";
  try {
    const [bRes, dRes] = await Promise.all([
      api.brief(selectedId.value),
      api.drafts({ project_id: selectedId.value }),
    ]);
    brand.value = bRes.brief?.brand ?? DEFAULT_BRAND_KIT;
    drafts.value = dRes.drafts;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    const res = await api.projects();
    projects.value = res.projects;
    if (res.projects.length) {
      selectedId.value = res.projects[0]!.id;
    }
  } catch (e) {
    error.value = (e as Error).message;
  }
});

watch(selectedId, () => {
  void loadProject();
});

function onDragStart(d: ContentDraft) {
  if (!isScheduled(d)) return;
  dragId.value = d.id;
}

function onDragOver(e: DragEvent, d: ContentDraft) {
  if (!dragId.value || dragId.value === d.id || !isScheduled(d)) return;
  e.preventDefault();
  dragOverId.value = d.id;
}

function onDragLeave(d: ContentDraft) {
  if (dragOverId.value === d.id) dragOverId.value = null;
}

async function onDrop(d: ContentDraft) {
  const from = dragId.value;
  dragId.value = null;
  dragOverId.value = null;
  if (!from || from === d.id || !isScheduled(d)) return;
  swapping.value = true;
  error.value = "";
  try {
    await api.swapDraftSchedule(from, d.id);
    await loadProject();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    swapping.value = false;
  }
}

/** Render a 1080×1920 Highlight cover PNG in-browser from the Brand Kit + inline SVG icon. */
async function downloadHighlightPng(h: BrandHighlight) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { primary, secondary, accent, background } = brand.value.colors;
  const grad = ctx.createLinearGradient(0, 0, 1080, 1920);
  grad.addColorStop(0, primary);
  grad.addColorStop(1, secondary);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1080, 1920);

  // Circle-safe area centered at (540, 960), radius 320
  ctx.save();
  ctx.beginPath();
  ctx.arc(540, 960, 320, 0, Math.PI * 2);
  ctx.fillStyle = `${background}1A`;
  ctx.fill();
  ctx.lineWidth = 12;
  ctx.strokeStyle = accent;
  ctx.stroke();
  ctx.restore();

  // Draw inline SVG icon
  const path = DESIGN_ICONS[h.icon] ?? DESIGN_ICONS.star!;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("SVG render failed"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  ctx.drawImage(img, 540 - 130, 960 - 165, 260, 260);

  if (h.label) {
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "700 44px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(h.label.toUpperCase().slice(0, 18), 540, 960 + 160);
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const slug = h.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || h.icon;
  a.href = url;
  a.download = `highlight-${slug}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadAllHighlights() {
  for (const h of brand.value.highlights) {
    await downloadHighlightPng(h);
  }
}

function badgeOf(d: ContentDraft): { text: string; cls: string } {
  if (d.status === "draft") return { text: "Pending", cls: "bg-amber-500/90 text-white" };
  if (isScheduled(d)) {
    const t = new Intl.DateTimeFormat("ms-MY", { timeZone: TIMEZONE, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(d.publish_at!));
    return { text: t, cls: "bg-accent/90 text-accent-ink" };
  }
  return { text: "Posted", cls: "bg-black/70 text-white" };
}
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6 pb-12">
    <PageHeader
      sign="GRID PLANNER"
      title="Grid Planner"
      description="Pratonton profil Instagram 3-lajur, kulit Highlight mengikut Brand Kit, dan tukar jadual siaran dengan seret-dan-lepas."
    />

    <!-- Project selector -->
    <div class="card p-4 flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2.5 min-w-0">
        <label for="gp-project" class="text-xs font-semibold uppercase tracking-wide text-muted">Projek</label>
        <select id="gp-project" v-model="selectedId" class="input text-sm min-w-48">
          <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-if="brand.highlights.length"
          type="button"
          class="btn btn-sm min-h-9 gap-1.5"
          @click="downloadAllHighlights"
        >
          <Download :size="14" /> Muat turun semua Highlight PNG
        </button>
        <RouterLink to="/projects" class="btn btn-sm min-h-9 gap-1.5">
          <Palette :size="14" /> Edit Brand Kit
        </RouterLink>
      </div>
    </div>

    <div v-if="error" class="rounded-xl border border-danger/30 bg-danger-soft p-3.5 text-sm text-danger" role="alert">{{ error }}</div>

    <div v-if="loading" class="card p-10 flex items-center justify-center gap-2 text-sm text-muted">
      <LoaderCircle :size="16" class="animate-spin" /> Memuatkan grid…
    </div>

    <template v-else-if="selectedProject">
      <!-- Phone-like Instagram profile preview -->
      <div class="mx-auto max-w-md rounded-3xl border border-line bg-surface shadow-sm overflow-hidden">
        <!-- Profile header -->
        <div class="p-4 border-b border-line flex items-center gap-3.5">
          <div
            class="h-14 w-14 rounded-full border-2 flex items-center justify-center overflow-hidden shrink-0 font-bold text-lg text-white"
            :style="{ backgroundColor: brand.colors.primary, borderColor: brand.colors.accent }"
          >
            <img v-if="brand.logo_upload_id" :src="api.uploadUrl(brand.logo_upload_id)" alt="Logo" class="h-full w-full object-cover" />
            <span v-else>{{ (selectedProject.name || "P").slice(0, 1).toUpperCase() }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="font-semibold text-sm text-fg truncate">{{ brand.handle || `@${selectedProject.slug}` }}</div>
            <div class="text-xs text-muted truncate">{{ selectedProject.name }}</div>
            <div class="mt-1 flex items-center gap-1.5">
              <span class="chip text-[10px] py-0">{{ brand.style }}</span>
              <span class="inline-block h-3 w-3 rounded-full border border-line" :style="{ backgroundColor: brand.colors.primary }" />
              <span class="inline-block h-3 w-3 rounded-full border border-line" :style="{ backgroundColor: brand.colors.secondary }" />
              <span class="inline-block h-3 w-3 rounded-full border border-line" :style="{ backgroundColor: brand.colors.accent }" />
            </div>
          </div>
        </div>

        <!-- Highlight covers row -->
        <div class="px-4 py-3 border-b border-line bg-surface-2/30">
          <div v-if="brand.highlights.length" class="flex gap-3 overflow-x-auto pb-1">
            <div v-for="(h, idx) in brand.highlights" :key="idx" class="flex flex-col items-center gap-1 shrink-0 w-16">
              <button
                type="button"
                class="h-14 w-14 rounded-full p-0.5 border-2 flex items-center justify-center transition-transform hover:scale-105 cursor-pointer"
                :style="{ background: `linear-gradient(150deg, ${brand.colors.primary}, ${brand.colors.secondary})`, borderColor: brand.colors.accent }"
                :title="`Muat turun ${h.label} PNG (1080×1920)`"
                @click="downloadHighlightPng(h)"
              >
                <svg class="h-6 w-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" v-html="DESIGN_ICONS[h.icon] ?? DESIGN_ICONS.star" />
              </button>
              <span class="text-[10px] text-muted truncate w-full text-center">{{ h.label }}</span>
            </div>
          </div>
          <p v-else class="text-xs text-muted flex items-center gap-1.5">
            <Sparkles :size="13" class="text-accent" /> Tambah Highlight dalam Projects → Brand untuk lihat &amp; muat turun kulit bulatan.
          </p>
        </div>

        <!-- 3-column Instagram grid -->
        <div class="p-1.5">
          <div v-if="gridItems.length" class="grid grid-cols-3 gap-1">
            <div
              v-for="d in gridItems"
              :key="d.id"
              :draggable="isScheduled(d)"
              class="relative aspect-4/5 overflow-hidden rounded bg-sunken border transition-all"
              :class="[
                isScheduled(d) ? 'cursor-grab active:cursor-grabbing' : '',
                dragOverId === d.id ? 'border-accent ring-2 ring-accent/40 scale-98' : 'border-line/50',
              ]"
              :title="isScheduled(d) ? `${d.title} — seret ke jubin berjadual lain untuk tukar masa` : d.title"
              @dragstart="onDragStart(d)"
              @dragover="onDragOver($event, d)"
              @dragleave="onDragLeave(d)"
              @drop="onDrop(d)"
            >
              <img :src="api.uploadUrl(firstImage(d)!)" :alt="d.title" class="h-full w-full object-cover" />
              <span class="absolute top-1 left-1 rounded px-1.5 py-0.5 text-[9px] font-semibold leading-tight" :class="badgeOf(d).cls">
                {{ badgeOf(d).text }}
              </span>
              <span
                v-if="(d.meta?.images?.length ?? 0) > 1"
                class="absolute top-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[9px] font-mono text-white flex items-center gap-0.5"
              >
                <Images :size="10" /> {{ d.meta!.images.length }}
              </span>
              <span v-if="isScheduled(d)" class="absolute bottom-1 right-1 rounded bg-black/60 p-0.5 text-white/90">
                <GripVertical :size="11" />
              </span>
            </div>
          </div>
          <div v-else class="py-14 text-center text-xs text-muted px-4">
            Tiada draf Instagram bergambar untuk projek ini lagi.
          </div>
        </div>
        <div v-if="swapping" class="px-4 py-2 text-xs text-accent flex items-center gap-1.5 border-t border-line">
          <LoaderCircle :size="12" class="animate-spin" /> Menukar jadual…
        </div>
      </div>

      <!-- Story this week lane -->
      <section class="card p-4 space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-fg flex items-center gap-1.5">
            <Calendar :size="15" class="text-accent" /> Story minggu ini
          </h2>
          <span class="text-xs text-muted">7 hari ke depan</span>
        </div>
        <div class="grid gap-2 sm:grid-cols-7">
          <div v-for="day in storyWeek" :key="day.key" class="rounded-xl border border-line bg-surface-2/30 p-2.5 space-y-2 min-h-24">
            <div class="text-[11px] font-semibold text-muted">{{ day.label }}</div>
            <div v-if="day.items.length" class="space-y-1.5">
              <div v-for="s in day.items" :key="s.id" class="rounded-lg border border-line bg-surface p-1.5 text-[11px]">
                <div class="font-medium text-fg truncate">{{ s.title }}</div>
                <div class="text-[10px] text-muted font-mono">{{ s.publish_at ? fmtDateTime(s.publish_at) : s.status }}</div>
              </div>
            </div>
            <div v-else class="text-[10px] text-faint">—</div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
