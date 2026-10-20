<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { FolderOpen, HardDrive, LoaderCircle, RefreshCw } from "lucide-vue-next";
import PageHeader from "../components/PageHeader.vue";
import SettingsTabs from "../components/SettingsTabs.vue";
import { api, type StoragePlace } from "../api/http.ts";
import { fmtDateTime } from "../format.ts";

/**
 * Settings → Storage (owner request, 2026-10-20): every place on the hub PC where the office keeps
 * data, how much space it takes, and "Open folder" (opens the file manager on that PC).
 */
const items = ref<StoragePlace[]>([]);
const measuredAt = ref<string | null>(null);
const loading = ref(false);
const error = ref("");
const opened = ref("");

const GROUPS: { key: StoragePlace["group"]; label: string }[] = [
  { key: "data", label: "Office data (hub)" },
  { key: "runner", label: "Runner on this PC" },
  { key: "tools", label: "Programs" },
];
const total = computed(() => items.value.reduce((s, i) => s + (i.bytes ?? 0), 0));

async function load(wait = false) {
  loading.value = true;
  error.value = "";
  try {
    const r = await api.storage(wait);
    items.value = r.items;
    measuredAt.value = r.measured_at;
    // the first answer comes before the sizes are measured: ask again once they are ready
    if (!r.measured_at && !wait) await load(true);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(() => load());

async function open(p: StoragePlace) {
  error.value = "";
  opened.value = "";
  try {
    opened.value = (await api.openStorage(p.key)).opened;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

function size(b: number | null): string {
  if (b === null) return "…";
  if (b < 1024 ** 2) return `${Math.round(b / 1024)} KB`;
  if (b < 1024 ** 3) return `${Math.round((b / 1024 ** 2) * 10) / 10} MB`;
  return `${Math.round((b / 1024 ** 3) * 100) / 100} GB`;
}
</script>

<template>
  <div>
    <PageHeader sign="System" title="Settings" />
    <SettingsTabs />

    <div class="mt-5 max-w-4xl space-y-4">
      <div class="card p-4 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <HardDrive :size="20" class="text-accent" />
          <div>
            <div class="text-sm font-semibold text-fg">{{ measuredAt ? size(total) : "Measuring…" }} used by the office</div>
            <div class="text-xs text-muted">{{ measuredAt ? `Measured ${fmtDateTime(measuredAt)}` : "Big folders take a few seconds." }} "Open folder" opens it on the hub PC.</div>
          </div>
        </div>
        <button class="btn btn-sm min-h-10 gap-1.5" :disabled="loading" @click="load(true)">
          <LoaderCircle v-if="loading" :size="14" class="animate-spin" />
          <RefreshCw v-else :size="14" />
          Refresh
        </button>
      </div>

      <div v-if="error" class="rounded-xl border border-danger/30 bg-danger-soft p-3.5 text-sm text-danger" role="alert">{{ error }}</div>
      <div v-if="opened" class="rounded-xl border border-line bg-surface-2 p-3 text-xs text-muted break-all">Opened on the PC: {{ opened }}</div>

      <section v-for="g in GROUPS" :key="g.key" class="space-y-2">
        <h2 class="sign px-1 text-xs font-semibold text-fg">{{ g.label }}</h2>
        <ul class="card divide-y divide-line">
          <li v-for="p in items.filter((i) => i.group === g.key)" :key="p.key" class="flex flex-wrap items-center gap-3 p-3.5">
            <div class="min-w-0 flex-1 basis-60">
              <div class="flex items-center gap-2 text-sm font-medium text-fg">
                {{ p.label }}
                <span v-if="!p.exists" class="chip text-[11px] text-muted">not created yet</span>
              </div>
              <div class="text-xs text-muted">{{ p.what }}</div>
              <div class="mt-1 text-xs font-mono text-faint break-all">{{ p.path }}</div>
            </div>
            <div class="text-right text-xs font-mono text-muted min-w-20">
              <div class="text-sm text-fg">{{ p.exists ? size(p.bytes) + (p.partial ? "+" : "") : "–" }}</div>
              <div v-if="p.exists && p.files !== null">{{ p.files.toLocaleString() }} files</div>
            </div>
            <button class="btn btn-sm min-h-10 gap-1.5" :disabled="!p.exists" @click="open(p)">
              <FolderOpen :size="14" /> Open folder
            </button>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
