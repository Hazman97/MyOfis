<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { AlertTriangle, CheckCircle2, Download, ImagePlus, LoaderCircle, Save, Sparkles, Upload } from "lucide-vue-next";
import {
  DEFAULT_BRAND_KIT,
  DESIGN_ICON_NAMES,
  DESIGN_SIZES,
  DesignSizeId,
  DesignTemplateId,
  renderDesignPages,
  type BrandKit,
  type DesignSizeId as DesignSizeType,
  type DesignTemplateId as DesignTemplateType,
  type DraftKind,
  type Platform,
  type Project,
} from "@agent-office/shared";
import PageHeader from "../components/PageHeader.vue";
import { api } from "../api/http.ts";
import { isOwner } from "../me.ts";

const projects = ref<Project[]>([]);
const projectId = ref<string>("");
const brand = ref<BrandKit>(DEFAULT_BRAND_KIT);
const hasBrandKit = ref<boolean>(true);
const lastProjectName = ref<string>("");

const template = ref<DesignTemplateType>("quote");
const size = ref<DesignSizeType>("post_4x5");
const slideIdx = ref(0);

const fields = reactive({
  quote: "",
  author: "",
  title: "",
  subtitle: "",
  headline: "",
  body: "",
  price: "",
  cta: "",
  eyebrow: "",
  before_label: "",
  after_label: "",
  role: "",
  rating: 5,
  icon: "star",
  label: "",
  itemsText: "",
  slidesText: "",
});

// Photo slot: uploaded or AI-generated upload IDs + local preview data URLs
const photoUploadIds = ref<string[]>([]);
const photoPreviewDataUrls = ref<string[]>([]);
const uploadingPhoto = ref(false);

// AI Image generation state
const aiPrompt = ref("");
const aiCount = ref(2);
const aiBusy = ref(false);
const aiChoices = ref<{ upload_id: string; seed: number }[]>([]);

// Render & Save Draft state
const renderBusy = ref(false);
const renderedIds = ref<string[]>([]);
const error = ref("");
const statusMsg = ref("");

const draftForm = reactive({
  platform: "instagram" as Platform,
  kind: "caption" as DraftKind,
  title: "Post Grafik Baru",
  body: "Kapsyen sedia untuk disemak dan dijadualkan.",
});
const savingDraft = ref(false);
const savedDraftId = ref<string | null>(null);

const selectedProject = computed(() => projects.value.find((p) => p.id === projectId.value) ?? null);
const selectedProjectName = computed(() => selectedProject.value?.name ?? "");

/** Send ONLY the chosen template's fields to design_render (no leftover fields from other templates). */
const builtFields = computed<Record<string, unknown>>(() => {
  switch (template.value) {
    case "quote":
      return {
        quote: fields.quote,
        author: fields.author,
      };
    case "tip_carousel": {
      const slides = fields.slidesText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [h, ...rest] = line.split("|");
          return { heading: (h ?? "").trim(), body: rest.join("|").trim() };
        });
      return {
        title: fields.title,
        subtitle: fields.subtitle,
        cta: fields.cta,
        slides,
      };
    }
    case "list_top": {
      const items = fields.itemsText.split("\n").map((s) => s.trim()).filter(Boolean);
      return {
        title: fields.title,
        items,
      };
    }
    case "before_after":
      return {
        title: fields.title,
        before_label: fields.before_label,
        after_label: fields.after_label,
      };
    case "promo":
      return {
        headline: fields.headline,
        price: fields.price,
        subtitle: fields.body,
        cta: fields.cta,
      };
    case "announcement":
      return {
        eyebrow: fields.eyebrow,
        headline: fields.headline,
        body: fields.body,
        cta: fields.cta,
      };
    case "testimonial":
      return {
        body: fields.body,
        author: fields.author,
        role: fields.role,
        rating: fields.rating,
      };
    case "story_frame":
      return {
        headline: fields.headline,
        body: fields.body,
        cta: fields.cta,
      };
    case "highlight_cover":
      return {
        icon: fields.icon,
        label: fields.label,
      };
  }
});

const preview = computed(() =>
  renderDesignPages(template.value, brand.value, builtFields.value, size.value, {
    photoDataUrls: photoPreviewDataUrls.value,
    projectName: selectedProjectName.value,
  }),
);

watch(
  () => preview.value.pages.length,
  (len) => {
    if (slideIdx.value >= len) slideIdx.value = 0;
  },
);

const previewScale = computed(() => Math.min(300 / preview.value.width, 460 / preview.value.height));

async function loadBrand() {
  if (!projectId.value) return;
  const projName = selectedProjectName.value;
  if (!fields.author.trim() || fields.author.trim() === lastProjectName.value) {
    fields.author = projName;
  }
  lastProjectName.value = projName;
  try {
    const r = await api.brief(projectId.value);
    hasBrandKit.value = !!r.brief?.brand;
    brand.value = r.brief?.brand ?? DEFAULT_BRAND_KIT;
  } catch {
    hasBrandKit.value = false;
    brand.value = DEFAULT_BRAND_KIT;
  }
}

onMounted(async () => {
  try {
    const r = await api.projects();
    projects.value = r.projects;
    if (r.projects.length) projectId.value = r.projects[0]!.id;
  } catch (e) {
    error.value = (e as Error).message;
  }
});

watch(projectId, () => {
  void loadBrand();
});

async function uploadPhoto(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  uploadingPhoto.value = true;
  error.value = "";
  try {
    const up = await api.uploadImage(file);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result ?? ""));
      fr.onerror = () => reject(new Error("read failed"));
      fr.readAsDataURL(file);
    });
    photoUploadIds.value = [...photoUploadIds.value.slice(-3), up.id];
    photoPreviewDataUrls.value = [...photoPreviewDataUrls.value.slice(-3), dataUrl];
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    uploadingPhoto.value = false;
  }
}

async function pollDirectJob(jobId: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 240; i++) {
    const { runs } = await api.runs(jobId);
    const lastRun = runs[0];
    if (lastRun) {
      if (lastRun.status === "failed" || lastRun.status === "cancelled") {
        const detail = await api.run(lastRun.id).catch(() => null);
        const failEv = detail?.events.find((e) => e.type === "run.failed");
        const msg = (failEv?.payload as { error?: string } | undefined)?.error;
        throw new Error(msg || `Tugasan ${lastRun.status}`);
      }
      if (lastRun.status === "done") {
        const detail = await api.run(lastRun.id);
        const text = detail.events
          .filter((e) => e.type === "agent.message")
          .map((e) => String((e.payload as { text?: string }).text ?? ""))
          .join("");
        return JSON.parse(text);
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Tugasan melebihi masa menunggu");
}

async function generateAi() {
  if (!aiPrompt.value.trim()) return;
  aiBusy.value = true;
  error.value = "";
  statusMsg.value = "Menjana gambar AI pada GPU tempatan…";
  try {
    const { job } = await api.designGenerate({
      project_id: projectId.value || null,
      prompt: aiPrompt.value.trim(),
      size: size.value,
      count: aiCount.value,
    });
    const out = (await pollDirectJob(job.id)) as { images?: { upload_id: string; seed: number }[] };
    aiChoices.value = out.images ?? [];
    statusMsg.value = `Siap: ${aiChoices.value.length} pilihan gambar AI.`;
  } catch (err) {
    error.value = (err as Error).message;
    statusMsg.value = "";
  } finally {
    aiBusy.value = false;
  }
}

async function pickAiChoice(uploadId: string) {
  try {
    const res = await fetch(api.uploadUrl(uploadId));
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result ?? ""));
      fr.readAsDataURL(blob);
    });
    photoUploadIds.value = [uploadId, ...photoUploadIds.value.filter((x) => x !== uploadId)].slice(0, 4);
    photoPreviewDataUrls.value = [dataUrl, ...photoPreviewDataUrls.value].slice(0, 4);
  } catch (err) {
    error.value = (err as Error).message;
  }
}

async function renderPng() {
  renderBusy.value = true;
  error.value = "";
  savedDraftId.value = null;
  statusMsg.value = "Merender PNG luar talian…";
  try {
    const { job } = await api.designRender({
      project_id: projectId.value || null,
      template: template.value,
      size: size.value,
      fields: builtFields.value,
      photos: photoUploadIds.value.length ? photoUploadIds.value : undefined,
    });
    const out = (await pollDirectJob(job.id)) as { upload_ids?: string[]; upload_id?: string };
    renderedIds.value = out.upload_ids?.length ? out.upload_ids : out.upload_id ? [out.upload_id] : [];
    statusMsg.value = `PNG siap (${renderedIds.value.length} fail).`;
  } catch (err) {
    error.value = (err as Error).message;
    statusMsg.value = "";
  } finally {
    renderBusy.value = false;
  }
}

async function saveAsDraft() {
  if (!projectId.value || !renderedIds.value.length) return;
  savingDraft.value = true;
  error.value = "";
  try {
    const { draft } = await api.designSaveDraft({
      project_id: projectId.value,
      platform: draftForm.platform,
      kind: draftForm.kind,
      title: draftForm.title.trim() || `${template.value} post`,
      body: draftForm.body.trim() || "Draf grafik",
      images: renderedIds.value,
    });
    savedDraftId.value = draft.id;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    savingDraft.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-6 pb-12">
    <PageHeader
      sign="DESIGN STUDIO"
      title="Design Studio"
      description="Pratonton langsung templat Brand Kit luar talian, jana latar belakang AI atas permintaan (ComfyUI GPU tempatan), render PNG, dan simpan sebagai draf."
    />

    <div v-if="error" class="rounded-xl border border-danger/30 bg-danger-soft p-3.5 text-sm text-danger" role="alert">{{ error }}</div>

    <div class="grid gap-6 lg:grid-cols-[1fr_420px] items-start">
      <!-- Left: Controls -->
      <div class="space-y-4">
        <div class="card p-5 space-y-4">
          <div class="grid gap-3 sm:grid-cols-3">
            <div>
              <label class="label" for="ds-proj">Projek (Brand Kit)</label>
              <select id="ds-proj" v-model="projectId" class="input text-sm">
                <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
            </div>
            <div>
              <label class="label" for="ds-tpl">Templat</label>
              <select id="ds-tpl" v-model="template" class="input text-sm">
                <option v-for="t in DesignTemplateId.options" :key="t" :value="t">{{ t }}</option>
              </select>
            </div>
            <div>
              <label class="label" for="ds-sz">Saiz</label>
              <select id="ds-sz" v-model="size" class="input text-sm">
                <option v-for="s in DesignSizeId.options" :key="s" :value="s">{{ DESIGN_SIZES[s].label }}</option>
              </select>
            </div>
          </div>

          <!-- Template fields -->
          <div class="space-y-3 pt-2 border-t border-line">
            <template v-if="template === 'quote'">
              <div>
                <label class="label" for="ds-quote">Petikan (Quote)</label>
                <textarea id="ds-quote" v-model="fields.quote" rows="3" class="input text-sm" placeholder="Tulis petikan utama di sini…" />
              </div>
              <div>
                <label class="label" for="ds-author">Nama / Sumber</label>
                <input id="ds-author" v-model="fields.author" class="input text-sm" :placeholder="selectedProjectName || 'Nama projek atau penulis'" />
              </div>
            </template>

            <template v-else-if="template === 'tip_carousel'">
              <div class="grid gap-3 sm:grid-cols-2">
                <div>
                  <label class="label" for="ds-ctitle">Tajuk Kulit</label>
                  <input id="ds-ctitle" v-model="fields.title" class="input text-sm" placeholder="cth. 3 Tip Penting Minggu Ini" />
                </div>
                <div>
                  <label class="label" for="ds-ccta">CTA Slaid Akhir</label>
                  <input id="ds-ccta" v-model="fields.cta" class="input text-sm" placeholder="cth. Simpan & kongsi post ini!" />
                </div>
              </div>
              <div>
                <label class="label" for="ds-slides">Slaid (satu baris setiap slaid: Tajuk | Isi)</label>
                <textarea id="ds-slides" v-model="fields.slidesText" rows="4" class="input text-xs font-mono" placeholder="Tip 1 | Terangkan langkah pertama secara ringkas." />
              </div>
            </template>

            <template v-else-if="template === 'list_top'">
              <div>
                <label class="label" for="ds-ltitle">Tajuk Senarai</label>
                <input id="ds-ltitle" v-model="fields.title" class="input text-sm" placeholder="cth. Top 5 Pilihan Terbaik" />
              </div>
              <div>
                <label class="label" for="ds-litems">Item (satu baris setiap item, ≤ 10)</label>
                <textarea id="ds-litems" v-model="fields.itemsText" rows="4" class="input text-sm" placeholder="Item pertama&#10;Item kedua&#10;Item ketiga" />
              </div>
            </template>

            <template v-else-if="template === 'before_after'">
              <div>
                <label class="label" for="ds-batitle">Tajuk</label>
                <input id="ds-batitle" v-model="fields.title" class="input text-sm" placeholder="cth. Sebelum & Selepas" />
              </div>
              <div class="grid gap-3 sm:grid-cols-2">
                <div>
                  <label class="label" for="ds-bl">Label Kiri</label>
                  <input id="ds-bl" v-model="fields.before_label" class="input text-sm" placeholder="SEBELUM" />
                </div>
                <div>
                  <label class="label" for="ds-al">Label Kanan</label>
                  <input id="ds-al" v-model="fields.after_label" class="input text-sm" placeholder="SELEPAS" />
                </div>
              </div>
            </template>

            <template v-else-if="template === 'highlight_cover'">
              <div class="grid gap-3 sm:grid-cols-2">
                <div>
                  <label class="label" for="ds-hicon">Ikon</label>
                  <select id="ds-hicon" v-model="fields.icon" class="input text-sm">
                    <option v-for="ic in DESIGN_ICON_NAMES" :key="ic" :value="ic">{{ ic }}</option>
                  </select>
                </div>
                <div>
                  <label class="label" for="ds-hlabel">Label</label>
                  <input id="ds-hlabel" v-model="fields.label" class="input text-sm" maxlength="30" placeholder="cth. Harga" />
                </div>
              </div>
            </template>

            <template v-else>
              <div class="grid gap-3 sm:grid-cols-2">
                <div>
                  <label class="label" for="ds-hl">Tajuk Utama</label>
                  <input id="ds-hl" v-model="fields.headline" class="input text-sm" placeholder="Tulis tajuk utama…" />
                </div>
                <div v-if="template === 'promo'">
                  <label class="label" for="ds-price">Harga</label>
                  <input id="ds-price" v-model="fields.price" class="input text-sm" placeholder="cth. RM50" />
                </div>
                <div v-else-if="template === 'testimonial'">
                  <label class="label" for="ds-tauthor">Pelanggan</label>
                  <input id="ds-tauthor" v-model="fields.author" class="input text-sm" :placeholder="selectedProjectName || 'Nama pelanggan'" />
                </div>
                <div v-else>
                  <label class="label" for="ds-cta">CTA</label>
                  <input id="ds-cta" v-model="fields.cta" class="input text-sm" placeholder="cth. Tempah Sekarang" />
                </div>
              </div>
              <div>
                <label class="label" for="ds-body">Isi / Huraian</label>
                <textarea id="ds-body" v-model="fields.body" rows="3" class="input text-sm" placeholder="Tulis huraian ringkas…" />
              </div>
            </template>
          </div>
        </div>

        <!-- Photo Slot + Generate with AI -->
        <div class="card p-5 space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="text-xs font-semibold uppercase tracking-wide text-muted flex items-center gap-1.5">
              <ImagePlus :size="14" class="text-accent" /> Slot Foto / Latar Belakang
            </span>
            <label class="btn btn-sm min-h-9 cursor-pointer gap-1.5">
              <LoaderCircle v-if="uploadingPhoto" :size="14" class="animate-spin" />
              <Upload v-else :size="14" />
              <span>Muat naik foto</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" @change="uploadPhoto" />
            </label>
          </div>

          <div v-if="photoPreviewDataUrls.length" class="flex flex-wrap gap-2">
            <div v-for="(src, i) in photoPreviewDataUrls" :key="i" class="relative">
              <img :src="src" alt="Selected photo" class="h-16 w-16 rounded-lg border border-line object-cover" />
              <button
                type="button"
                class="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-danger text-white text-[10px] font-bold"
                @click="photoUploadIds.splice(i, 1); photoPreviewDataUrls.splice(i, 1)"
              >
                ×
              </button>
            </div>
          </div>

          <!-- Generate with AI (Owner GPU) -->
          <div v-if="isOwner" class="space-y-2.5 pt-3 border-t border-line">
            <div class="text-xs font-semibold text-fg flex items-center gap-1.5">
              <Sparkles :size="14" class="text-accent" /> Jana dengan AI (ComfyUI GPU tempatan — gambar sahaja)
            </div>
            <div class="flex flex-wrap gap-2">
              <input
                v-model="aiPrompt"
                class="input text-sm flex-1 min-w-52"
                placeholder="cth. minimalist studio table with vlog camera, warm morning light"
              />
              <select v-model.number="aiCount" class="input text-sm w-32">
                <option :value="1">1 gambar</option>
                <option :value="2">2 gambar</option>
                <option :value="4">4 gambar</option>
              </select>
              <button type="button" class="btn btn-sm btn-primary min-h-10 gap-1.5" :disabled="aiBusy || !aiPrompt.trim()" @click="generateAi">
                <LoaderCircle v-if="aiBusy" :size="14" class="animate-spin" />
                <Sparkles v-else :size="14" />
                Jana AI
              </button>
            </div>
            <div v-if="aiChoices.length" class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              <button
                v-for="ch in aiChoices"
                :key="ch.upload_id"
                type="button"
                class="rounded-lg border border-line overflow-hidden hover:border-accent transition-colors text-left"
                @click="pickAiChoice(ch.upload_id)"
              >
                <img :src="api.uploadUrl(ch.upload_id)" alt="AI choice" class="aspect-4/5 w-full object-cover" />
                <div class="px-2 py-1 text-[10px] font-mono text-muted">seed {{ ch.seed }}</div>
              </button>
            </div>
          </div>
        </div>

        <!-- Render & Save as Draft -->
        <div class="card p-5 space-y-4">
          <div class="flex flex-wrap items-center gap-3">
            <button type="button" class="btn btn-primary min-h-11 gap-2" :disabled="renderBusy" @click="renderPng">
              <LoaderCircle v-if="renderBusy" :size="16" class="animate-spin" />
              <Download v-else :size="16" />
              Render PNG (0 token)
            </button>
            <span v-if="statusMsg" class="text-xs text-muted">{{ statusMsg }}</span>
          </div>

          <div v-if="renderedIds.length" class="space-y-3 pt-3 border-t border-line">
            <div class="flex flex-wrap gap-2">
              <a
                v-for="(rid, idx) in renderedIds"
                :key="rid"
                :href="api.uploadUrl(rid, true)"
                class="btn btn-sm min-h-9 gap-1.5"
                download
              >
                <Download :size="13" /> Muat turun {{ renderedIds.length > 1 ? `Slaid ${idx + 1}` : "PNG" }}
              </a>
            </div>

            <div class="grid gap-2.5 sm:grid-cols-2">
              <div>
                <label class="label" for="ds-plat">Platform draf</label>
                <select id="ds-plat" v-model="draftForm.platform" class="input text-sm">
                  <option value="instagram">Instagram</option>
                  <option value="facebook">Facebook</option>
                  <option value="threads">Threads</option>
                  <option value="tiktok">TikTok</option>
                </select>
              </div>
              <div>
                <label class="label" for="ds-dtitle">Tajuk draf</label>
                <input id="ds-dtitle" v-model="draftForm.title" class="input text-sm" />
              </div>
            </div>
            <div>
              <label class="label" for="ds-dbody">Kapsyen</label>
              <textarea id="ds-dbody" v-model="draftForm.body" rows="2" class="input text-sm" />
            </div>
            <div class="flex items-center gap-3">
              <button type="button" class="btn btn-sm btn-primary min-h-10 gap-1.5" :disabled="savingDraft || !projectId" @click="saveAsDraft">
                <LoaderCircle v-if="savingDraft" :size="14" class="animate-spin" />
                <Save v-else :size="14" />
                Simpan sebagai draf
              </button>
              <span v-if="savedDraftId" class="text-xs text-accent font-semibold flex items-center gap-1">
                <CheckCircle2 :size="14" /> Disimpan ke Drafts!
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Right: Sandboxed Live Preview -->
      <div class="card p-4 space-y-3 lg:sticky lg:top-6">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold uppercase tracking-wide text-muted">Pratonton Langsung</span>
          <span class="text-[11px] font-mono text-muted">{{ preview.width }}×{{ preview.height }}</span>
        </div>

        <div
          v-if="!hasBrandKit && projectId"
          class="rounded-lg border border-signal/35 bg-signal-soft px-3 py-2 text-xs text-fg leading-relaxed"
        >
          Projek ini belum ada Brand Kit — guna warna asal. Tetapkan di
          <RouterLink :to="{ path: '/projects', query: { id: projectId, tab: 'brand' } }" class="font-semibold text-accent underline">
            Projects → Brand
          </RouterLink>.
        </div>

        <div
          class="mx-auto overflow-hidden rounded-xl border border-line bg-sunken relative"
          :style="{ width: `${Math.round(preview.width * previewScale)}px`, height: `${Math.round(preview.height * previewScale)}px` }"
        >
          <iframe
            sandbox=""
            :srcdoc="preview.pages[slideIdx] ?? ''"
            title="Live template preview"
            class="border-0 origin-top-left pointer-events-none"
            :style="{
              width: `${preview.width}px`,
              height: `${preview.height}px`,
              transform: `scale(${previewScale})`,
            }"
          />
        </div>

        <div v-if="preview.pages.length > 1" class="flex items-center justify-center gap-1.5">
          <button
            v-for="(_, idx) in preview.pages"
            :key="idx"
            type="button"
            class="btn btn-sm min-h-8 px-2.5 text-xs"
            :class="slideIdx === idx ? 'btn-primary' : ''"
            @click="slideIdx = idx"
          >
            {{ idx + 1 }}
          </button>
        </div>

        <div v-if="preview.warnings.length" class="flex items-start gap-2 rounded-lg border border-signal/40 bg-signal-soft p-2.5 text-xs text-fg">
          <AlertTriangle :size="14" class="mt-0.5 shrink-0 text-signal" />
          <span>{{ preview.warnings.join("; ") }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
