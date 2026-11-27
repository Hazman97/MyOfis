<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AlertTriangle, Check, ChevronDown, ExternalLink, Link2, LoaderCircle, Plus, RefreshCw, Trash2, X } from "lucide-vue-next";
import { linkResultMessage, type Project } from "@agent-office/shared";
import ConfirmButton from "../components/ConfirmButton.vue";
import PageHeader from "../components/PageHeader.vue";
import SettingsTabs from "../components/SettingsTabs.vue";
import { api, type SocialTarget, type ZernioConnection, type ZernioPlatform } from "../api/http.ts";
import { fmtDateTime } from "../format.ts";

/**
 * Settings → Social accounts (Tasks 042 & 047):
 * - 3-step onboarding card when no Zernio key exists: 1. Zernio key -> 2. Link akaun -> 3. Pilih projek
 * - One-click OAuth Link / Reconnect per platform (TikTok, Instagram, Facebook, Threads, YouTube)
 * - Safe BM toast on OAuth return (?linked= / ?link=failed&reason=)
 * - Collapsed "add another key" for advanced multi-key use
 */
const PLATFORMS: { id: ZernioPlatform; label: string }[] = [
  { id: "tiktok", label: "TikTok" },
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "threads", label: "Threads" },
  { id: "youtube", label: "YouTube" },
];
const PLAT_LABEL = Object.fromEntries(PLATFORMS.map((p) => [p.id, p.label])) as Record<ZernioPlatform, string>;

const route = useRoute();
const router = useRouter();

const connections = ref<ZernioConnection[]>([]);
const targets = ref<SocialTarget[]>([]);
const projects = ref<Project[]>([]);
const projectMap = reactive<Record<string, Partial<Record<ZernioPlatform, string>>>>({});
const savedProj = ref<string | null>(null);
const error = ref("");
const busy = ref<string | null>(null);
const form = reactive({ label: "Zernio Utama", api_key: "" });
const addingAnother = ref(false);
const toastDismissed = ref(false);

const allAccounts = computed(() => connections.value.flatMap((c) => c.accounts));
const toast = computed(() => {
  if (toastDismissed.value) return null;
  const q = route.query;
  return linkResultMessage(
    {
      linked: typeof q.linked === "string" ? q.linked : null,
      link: typeof q.link === "string" ? q.link : null,
      reason: typeof q.reason === "string" ? q.reason : null,
    },
    allAccounts.value,
  );
});

const targetsByPlatform = computed(() => {
  const m: Record<ZernioPlatform, SocialTarget[]> = { tiktok: [], instagram: [], facebook: [], threads: [], youtube: [] };
  for (const t of targets.value) m[t.platform]?.push(t);
  return m;
});

function dismissToast() {
  toastDismissed.value = true;
  if (route.query.linked || route.query.link || route.query.reason) {
    void router.replace({ path: route.path, query: {} });
  }
}

async function load() {
  const [sa, pr] = await Promise.all([api.socialAccounts(), api.projects()]);
  connections.value = sa.connections;
  targets.value = sa.targets ?? sa.tiktok ?? [];
  projects.value = pr.projects;
  await Promise.all(
    pr.projects.map(async (p) => {
      const r = await api.projectSocialAccounts(p.id).catch(() => ({ accounts: {} }));
      projectMap[p.id] = { ...r.accounts };
    }),
  );
}
onMounted(() => load().catch((e) => (error.value = (e as Error).message)));

async function run(key: string, fn: () => Promise<unknown>) {
  busy.value = key;
  error.value = "";
  try {
    await fn();
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = null;
  }
}

const add = () =>
  run("add", async () => {
    await api.addZernio(form.label.trim() || "Zernio Utama", form.api_key.trim());
    form.label = "";
    form.api_key = "";
    addingAnother.value = false;
  });
const refresh = (c: ZernioConnection) => run(`refresh:${c.id}`, () => api.refreshZernio(c.id));
const remove = (c: ZernioConnection) => run(`remove:${c.id}`, () => api.removeZernio(c.id));
const rename = (c: ZernioConnection, accId: string, label: string) =>
  run(`acc:${accId}`, () => api.patchZernio(c.id, { accounts: { [accId]: { label: label.trim() } } }));
const toggle = (c: ZernioConnection, accId: string, enabled: boolean) =>
  run(`acc:${accId}`, () => api.patchZernio(c.id, { accounts: { [accId]: { enabled } } }));

async function linkPlatform(c: ZernioConnection, platform: ZernioPlatform) {
  busy.value = `link:${c.id}:${platform}`;
  error.value = "";
  try {
    const { url } = await api.linkZernio(c.id, platform);
    window.location.assign(url);
  } catch (e) {
    error.value = (e as Error).message;
    busy.value = null;
  }
}

async function saveProject(projectId: string) {
  busy.value = `proj:${projectId}`;
  error.value = "";
  try {
    const raw = projectMap[projectId] ?? {};
    const payload: Partial<Record<ZernioPlatform, string | null>> = {};
    for (const p of PLATFORMS) payload[p.id] = raw[p.id] || null;
    await api.saveProjectSocialAccounts(projectId, payload);
    savedProj.value = projectId;
    setTimeout(() => {
      if (savedProj.value === projectId) savedProj.value = null;
    }, 2000);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div class="mx-auto max-w-4xl pb-10">
    <PageHeader sign="System" title="Settings" />
    <SettingsTabs class="mb-5" />

    <div class="space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-fg">Akaun sosial</h2>
          <p class="text-xs text-muted mt-0.5 leading-relaxed">
            Sambung TikTok, Instagram, Facebook, Threads dan YouTube terus dari MyOfis melalui
            <a href="https://zernio.com" target="_blank" rel="noopener" class="text-accent hover:underline">Zernio</a>.
          </p>
        </div>
        <RouterLink v-if="targetsByPlatform.tiktok.length" to="/post" class="btn btn-primary btn-sm min-h-10 self-start sm:self-auto gap-1.5">
          Buka Quick Post
        </RouterLink>
      </div>

      <!-- OAuth Return Toast -->
      <div
        v-if="toast"
        class="flex items-start justify-between gap-3 rounded-xl border p-3.5 text-sm"
        :class="toast.kind === 'success' ? 'border-accent/40 bg-accent-soft text-accent' : 'border-danger/30 bg-danger-soft text-danger'"
        role="status"
      >
        <div class="flex items-center gap-2 font-medium">
          <Check v-if="toast.kind === 'success'" :size="16" class="shrink-0" />
          <AlertTriangle v-else :size="16" class="shrink-0" />
          <span>{{ toast.text }}</span>
        </div>
        <button type="button" class="btn btn-ghost btn-sm p-1" aria-label="Tutup" @click="dismissToast">
          <X :size="14" />
        </button>
      </div>

      <div v-if="error" class="rounded-xl border border-danger/30 bg-danger-soft p-3.5 text-sm text-danger" role="alert">
        {{ error }}
      </div>

      <!-- 3-Step Onboarding Card (shown when no Zernio connection exists yet) -->
      <section v-if="!connections.length" class="card p-5 space-y-5">
        <div>
          <h3 class="text-sm font-semibold text-fg">Sambung akaun sosial dalam 3 langkah</h3>
          <p class="text-xs text-muted mt-0.5">Tampal kunci Zernio sekali sahaja, kemudian tekan Link untuk log masuk TikTok atau platform lain.</p>
        </div>

        <ol class="space-y-4">
          <!-- Step 1 -->
          <li class="rounded-xl border border-line bg-surface-2/30 p-4 space-y-3">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="flex size-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-ink">1</span>
                <span class="text-sm font-semibold text-fg">Kunci API Zernio</span>
              </div>
              <a
                href="https://zernio.com/dashboard"
                target="_blank"
                rel="noopener"
                class="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
              >
                Buka Zernio → API keys <ExternalLink :size="12" />
              </a>
            </div>
            <form class="space-y-3" @submit.prevent="add">
              <div class="grid gap-3 sm:grid-cols-2">
                <div>
                  <label class="label text-xs" for="zr-label-onboard">Label sambungan</label>
                  <input id="zr-label-onboard" v-model="form.label" class="input text-sm" required maxlength="60" placeholder="cth. Zernio Utama" />
                </div>
                <div>
                  <label class="label text-xs" for="zr-key-onboard">Kunci API Zernio</label>
                  <input id="zr-key-onboard" v-model="form.api_key" class="input font-mono text-sm" type="password" autocomplete="off" required minlength="8" placeholder="sk_…" />
                </div>
              </div>
              <p class="text-xs text-muted">Kunci disulitkan di hub dan tidak pernah dihantar semula ke pelayar.</p>
              <button class="btn btn-primary min-h-10 px-4" :disabled="busy === 'add'">
                <LoaderCircle v-if="busy === 'add'" :size="14" class="motion-safe:animate-spin" />
                Simpan &amp; Uji kunci
              </button>
            </form>
          </li>

          <!-- Step 2 (preview until Step 1 done) -->
          <li class="rounded-xl border border-line/70 bg-surface p-4 opacity-60 space-y-2">
            <div class="flex items-center gap-2">
              <span class="flex size-6 items-center justify-center rounded-full bg-surface-2 border border-line text-xs font-bold text-muted">2</span>
              <span class="text-sm font-semibold text-fg">Link akaun</span>
            </div>
            <p class="text-xs text-muted">Selepas kunci disimpan, tekan butang platform di bawah untuk log masuk terus dari MyOfis:</p>
            <div class="flex flex-wrap gap-2 pt-1">
              <button v-for="p in PLATFORMS" :key="p.id" type="button" disabled class="btn btn-sm min-h-9 gap-1.5">
                <Link2 :size="13" /> Link {{ p.label }}
              </button>
            </div>
          </li>

          <!-- Step 3 (preview until Step 2 done) -->
          <li class="rounded-xl border border-line/70 bg-surface p-4 opacity-60 space-y-1">
            <div class="flex items-center gap-2">
              <span class="flex size-6 items-center justify-center rounded-full bg-surface-2 border border-line text-xs font-bold text-muted">3</span>
              <span class="text-sm font-semibold text-fg">Pilih projek</span>
            </div>
            <p class="text-xs text-muted">Padankan akaun yang baru disambung ke projek anda (atau terus guna di Quick Post).</p>
          </li>
        </ol>
      </section>

      <!-- Connections list (once Step 1 is done) -->
      <div v-if="connections.length" class="space-y-4">
        <section v-for="c in connections" :key="c.id" class="card overflow-hidden">
          <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-2/30 px-4 py-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-semibold text-sm text-fg truncate">{{ c.label }}</span>
                <span class="chip chip-sm font-mono text-[10px] text-muted">key {{ c.key_hint }}</span>
              </div>
              <div class="mt-0.5 text-xs text-muted">Disemak {{ fmtDateTime(c.checked_at) }}</div>
            </div>
            <div class="flex items-center gap-2">
              <button
                class="btn btn-sm min-h-9 gap-1.5"
                :disabled="busy === `refresh:${c.id}`"
                title="Semak semula senarai akaun dari Zernio"
                @click="refresh(c)"
              >
                <LoaderCircle v-if="busy === `refresh:${c.id}`" :size="13" class="motion-safe:animate-spin" />
                <RefreshCw v-else :size="13" />
                <span>Refresh</span>
              </button>
              <ConfirmButton small class="min-h-9" confirm-label="Buang kunci?" @confirm="remove(c)">
                <Trash2 :size="13" /> Remove
              </ConfirmButton>
            </div>
          </div>

          <!-- Step 2: Direct Link buttons per platform -->
          <div class="border-b border-line bg-surface px-4 py-3 space-y-2">
            <div class="text-xs font-medium text-muted">Link akaun baru terus melalui Zernio:</div>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="p in PLATFORMS"
                :key="p.id"
                type="button"
                class="btn btn-sm min-h-9 gap-1.5"
                :class="p.id === 'tiktok' ? 'btn-primary' : ''"
                :disabled="busy === `link:${c.id}:${p.id}`"
                @click="linkPlatform(c, p.id)"
              >
                <LoaderCircle v-if="busy === `link:${c.id}:${p.id}`" :size="13" class="motion-safe:animate-spin" />
                <Link2 v-else :size="13" />
                <span>Link {{ p.label }}</span>
              </button>
            </div>
          </div>

          <ul class="divide-y divide-line">
            <li
              v-for="a in c.accounts"
              :key="a.id"
              class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 transition-colors"
              :class="!a.enabled ? 'opacity-60 bg-surface/50' : 'bg-surface'"
            >
              <div class="min-w-0 flex-1 space-y-1.5">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="chip chip-sm text-[11px] font-semibold">{{ PLAT_LABEL[a.platform] ?? a.platform }}</span>
                  <input
                    :value="a.label"
                    class="input h-9 text-sm font-medium w-full sm:max-w-xs"
                    maxlength="60"
                    :aria-label="`Name for @${a.username}`"
                    @change="rename(c, a.id, ($event.target as HTMLInputElement).value)"
                  />
                  <span v-if="a.needs_reconnection" class="chip chip-sm bg-signal-soft text-signal border border-signal/30 gap-1 text-[11px] font-medium">
                    <AlertTriangle :size="12" /> Perlu sambung semula
                  </span>
                  <button
                    v-if="a.needs_reconnection"
                    type="button"
                    class="btn btn-sm btn-signal min-h-8 gap-1"
                    :disabled="busy === `link:${c.id}:${a.platform}`"
                    @click="linkPlatform(c, a.platform)"
                  >
                    <Link2 :size="12" /> Reconnect
                  </button>
                </div>
                <div class="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span class="font-medium text-fg">{{ PLAT_LABEL[a.platform] ?? a.platform }} @{{ a.username }}</span>
                  <span v-if="a.followers !== null" class="text-faint">·</span>
                  <span v-if="a.followers !== null">{{ a.followers.toLocaleString() }} pengikut</span>
                </div>
              </div>

              <div class="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-line/60 shrink-0">
                <span class="text-xs font-medium text-muted sm:text-right">Aktif untuk post</span>
                <label class="relative inline-flex items-center cursor-pointer select-none" :aria-label="`Enable @${a.username}`">
                  <input
                    type="checkbox"
                    class="sr-only peer"
                    :checked="a.enabled"
                    :disabled="busy === `acc:${a.id}`"
                    @change="toggle(c, a.id, ($event.target as HTMLInputElement).checked)"
                  />
                  <div class="h-5 w-9 rounded-full bg-surface-2 border border-line peer-checked:bg-accent peer-checked:border-accent transition-colors duration-200" />
                  <div class="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-fg peer-checked:bg-accent-ink peer-checked:translate-x-4 transition-transform duration-200 shadow-sm" />
                </label>
              </div>
            </li>
            <li v-if="!c.accounts.length" class="p-6 text-center text-xs text-muted">
              Belum ada akaun disambung. Tekan butang <strong>Link TikTok</strong> (atau platform lain) di atas.
            </li>
          </ul>
        </section>

        <!-- Collapsed advanced "Add another Zernio key" -->
        <div class="card overflow-hidden">
          <button
            type="button"
            class="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-medium text-muted hover:text-fg transition-colors"
            @click="addingAnother = !addingAnother"
          >
            <span class="inline-flex items-center gap-1.5"><Plus :size="14" /> Tambah kunci Zernio lain (lanjutan)</span>
            <ChevronDown :size="14" class="transition-transform" :class="addingAnother ? 'rotate-180' : ''" />
          </button>
          <form v-if="addingAnother" class="border-t border-line p-4 space-y-3" @submit.prevent="add">
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <label class="label text-xs" for="zr-label-extra">Label sambungan</label>
                <input id="zr-label-extra" v-model="form.label" class="input text-sm" required maxlength="60" placeholder="cth. Zernio Kedai 2" />
              </div>
              <div>
                <label class="label text-xs" for="zr-key-extra">Kunci API Zernio</label>
                <input id="zr-key-extra" v-model="form.api_key" class="input font-mono text-sm" type="password" autocomplete="off" required minlength="8" placeholder="sk_…" />
              </div>
            </div>
            <div class="flex gap-2">
              <button class="btn btn-primary btn-sm min-h-9 px-4" :disabled="busy === 'add'">
                <LoaderCircle v-if="busy === 'add'" :size="13" class="motion-safe:animate-spin" /> Tambah kunci
              </button>
              <button type="button" class="btn btn-sm min-h-9" @click="addingAnother = false">Batal</button>
            </div>
          </form>
        </div>
      </div>

      <!-- Step 3: Per-project default accounts -->
      <section v-if="projects.length && targets.length" class="card p-5 space-y-4">
        <div>
          <h3 class="text-sm font-semibold text-fg">Langkah 3 · Pilih akaun mengikut projek</h3>
          <p class="text-xs text-muted mt-0.5">
            Pilih akaun Zernio bagi setiap platform untuk setiap projek. Jika dibiarkan lalai, sistem menggunakan satu-satunya akaun aktif platform tersebut (atau sambungan Meta lama untuk foto/teks tunggal).
          </p>
        </div>

        <div class="space-y-4 divide-y divide-line">
          <div v-for="p in projects" :key="p.id" class="pt-4 first:pt-0 space-y-3">
            <div class="flex items-center justify-between gap-2">
              <span class="font-semibold text-sm text-fg">{{ p.name }}</span>
              <button
                type="button"
                class="btn btn-sm btn-primary min-h-9 gap-1.5"
                :disabled="busy === `proj:${p.id}`"
                @click="saveProject(p.id)"
              >
                <LoaderCircle v-if="busy === `proj:${p.id}`" :size="13" class="animate-spin" />
                <Check v-else-if="savedProj === p.id" :size="13" />
                {{ savedProj === p.id ? "Disimpan" : "Simpan projek" }}
              </button>
            </div>
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div v-for="plat in PLATFORMS" :key="plat.id">
                <label class="label text-xs" :for="`pa-${p.id}-${plat.id}`">{{ plat.label }}</label>
                <select
                  :id="`pa-${p.id}-${plat.id}`"
                  :value="projectMap[p.id]?.[plat.id] ?? ''"
                  class="input h-9 text-xs"
                  :disabled="!targetsByPlatform[plat.id].length"
                  @change="projectMap[p.id] = { ...(projectMap[p.id] ?? {}), [plat.id]: ($event.target as HTMLSelectElement).value || undefined }"
                >
                  <option value="">{{ targetsByPlatform[plat.id].length === 1 ? `Lalai (${targetsByPlatform[plat.id][0]!.label})` : "Tiada pilihan / lalai" }}</option>
                  <option v-for="t in targetsByPlatform[plat.id]" :key="t.id" :value="t.id">
                    {{ t.label }} (@{{ t.username }})
                  </option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
