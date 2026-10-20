<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { CircleCheck, CircleX, KeyRound, LoaderCircle, Pencil, Plug, Plus, ScanSearch } from "lucide-vue-next";
import type { ProviderPreset, ProviderPublic } from "@agent-office/shared";
import ConfirmButton from "../components/ConfirmButton.vue";
import PageHeader from "../components/PageHeader.vue";
import SettingsTabs from "../components/SettingsTabs.vue";
import SidePanel from "../components/SidePanel.vue";
import { api, type ScanResult } from "../api/http.ts";

const providers = ref<ProviderPublic[]>([]);
const presets = ref<ProviderPreset[]>([]);
/** A room on HQ's AI: the providers are HQ's and cannot be changed from here. */
const readOnly = ref(false);
const editing = ref<string | null>(null); // provider id, "new", or null
const preset = ref<ProviderPreset | null>(null);
const error = ref("");
const listError = ref("");

const form = reactive({
  slug: "",
  name: "",
  kind: "openai_compatible" as ProviderPublic["kind"],
  base_url: "",
  api_key: "",
  models: "",
  /** One per line: "model-id input_usd output_usd" (per 1M tokens). */
  pricing: "",
  enabled: true,
});

async function load() {
  const [list, pre] = await Promise.all([api.providers(), api.presets().then((r) => r.presets)]);
  providers.value = list.providers;
  readOnly.value = !!list.read_only;
  presets.value = pre;
}
onMounted(load);

const pricingToText = (p: ProviderPublic["pricing"]) =>
  Object.entries(p)
    .map(([m, v]) => `${m} ${v.input_per_mtok} ${v.output_per_mtok}`)
    .join("\n");

function parsePricing(text: string) {
  const out: Record<string, { input_per_mtok: number; output_per_mtok: number }> = {};
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [model, inp, outp] = line.split(/\s+/);
    if (!model || Number.isNaN(Number(inp)) || Number.isNaN(Number(outp))) throw new Error(`Pricing line not understood: "${line}"`);
    out[model] = { input_per_mtok: Number(inp), output_per_mtok: Number(outp) };
  }
  return out;
}

function startNew(p: ProviderPreset) {
  error.value = "";
  preset.value = p;
  const taken = new Set(providers.value.map((x) => x.slug));
  let slug = p.id;
  for (let i = 2; taken.has(slug); i++) slug = `${p.id}-${i}`;
  Object.assign(form, { slug, name: p.name, kind: p.kind, base_url: p.base_url ?? "", api_key: "", models: p.models.join("\n"), pricing: "", enabled: true });
  editing.value = "new";
  check.value = null;
  if (!p.needs_api_key && p.base_url) void checkNow();
}

function startEdit(p: ProviderPublic) {
  error.value = "";
  preset.value = null;
  Object.assign(form, {
    slug: p.slug,
    name: p.name,
    kind: p.kind,
    base_url: p.base_url ?? "",
    api_key: "",
    models: p.models.join("\n"),
    pricing: pricingToText(p.pricing),
    enabled: p.enabled,
  });
  editing.value = p.id;
  check.value = null;
}

// check the endpoint (local or outside) before saving
const check = ref<{ ok: boolean; models: number; error: string | null } | null>(null);
const checking = ref(false);
async function checkNow() {
  checking.value = true;
  check.value = null;
  try {
    check.value = (
      await api.checkProvider({
        kind: form.kind,
        base_url: form.base_url.trim() || null,
        api_key: form.api_key || null,
        provider_id: editing.value && editing.value !== "new" ? editing.value : undefined,
      })
    ).check;
  } catch (e) {
    check.value = { ok: false, models: 0, error: (e as Error).message };
  } finally {
    checking.value = false;
  }
}

// scan: test every model and keep the ones that work with tools
const scans = reactive<Record<string, { busy: boolean; results: ScanResult[] | null; error: string }>>({});
async function scan(id: string) {
  scans[id] = { busy: true, results: null, error: "" };
  try {
    scans[id] = { busy: false, results: (await api.scanProvider(id)).results, error: "" };
    await load();
  } catch (e) {
    scans[id] = { busy: false, results: null, error: (e as Error).message };
  }
}
const working = (id: string) => scans[id]?.results?.filter((r) => r.tool_calls) ?? [];

async function save() {
  error.value = "";
  try {
    const body: Record<string, unknown> = {
      name: form.name,
      kind: form.kind,
      base_url: form.base_url.trim() || null,
      models: form.models.split(/[\n,]/).map((m) => m.trim()).filter(Boolean),
      pricing: parsePricing(form.pricing),
      enabled: form.enabled,
    };
    // Only send the key when typed: empty means "keep the current key".
    if (form.api_key) body.api_key = form.api_key;
    let scanId: string | null = null;
    if (editing.value === "new") {
      const { provider } = await api.createProvider({ ...body, slug: form.slug });
      // a gateway with many models (9Router, a custom endpoint): find the ones that work right away
      if (provider.kind !== "mock" && !(body.models as string[]).length) scanId = provider.id;
    } else await api.updateProvider(editing.value!, body);
    editing.value = null;
    await load();
    if (scanId) void scan(scanId);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function clearKey(p: ProviderPublic) {
  await api.updateProvider(p.id, { api_key: "" });
  await load();
}

async function remove(p: ProviderPublic) {
  listError.value = "";
  try {
    await api.deleteProvider(p.id);
    await load();
  } catch (e) {
    listError.value = (e as Error).message;
  }
}
</script>

<template>
  <div>
    <PageHeader sign="System" title="Settings" />
    <SettingsTabs />

    <section class="mt-5">
      <p class="mb-3 max-w-[65ch] text-sm text-muted">The AI brains your agents can use. Keys are encrypted on the hub and never sent back to the browser.</p>
      <p v-if="listError" class="mb-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{{ listError }}</p>
      <p v-if="readOnly" class="mb-3 rounded-md bg-surface-2 px-3 py-2 text-sm text-muted">This room uses HQ's AI providers. Change them from HQ.</p>
      <div class="card divide-y divide-line">
        <div v-for="p in providers" :key="p.id" class="flex flex-wrap items-center gap-3 px-4 py-3" :class="!p.enabled && 'opacity-60'">
          <div class="min-w-0 flex-1 max-sm:basis-full">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium">{{ p.name }}</span>
              <span class="font-mono text-[11px] text-faint">{{ p.slug }}</span>
              <span v-if="!p.enabled" class="chip text-[11px]">off</span>
            </div>
            <div class="mt-1 flex flex-wrap gap-1.5 text-[11px]">
              <span class="chip">{{ p.kind.replace("_", "-") }}</span>
              <span class="chip" :class="p.has_api_key ? 'border-accent/40 text-accent' : ''"><KeyRound :size="11" />{{ p.has_api_key ? p.api_key_hint : "no key" }}</span>
              <span v-if="p.models.length" class="chip">{{ p.models.length }} model{{ p.models.length > 1 ? "s" : "" }}</span>
              <span v-if="p.base_url" class="chip max-w-64 truncate font-mono">{{ p.base_url }}</span>
            </div>
            <!-- scan results: which models really work with tools -->
            <div v-if="scans[p.id]?.busy" class="mt-2.5 rounded-lg border border-accent/30 bg-accent/5 p-2.5 space-y-2">
              <div class="flex items-center gap-2 text-xs text-fg font-medium">
                <LoaderCircle :size="14" class="motion-safe:animate-spin text-accent shrink-0" />
                <span>Testing each model with a small tool call… this takes up to a minute</span>
              </div>
              <div class="h-1 w-full overflow-hidden rounded-full bg-accent/20" aria-hidden="true">
                <div class="h-full w-2/5 rounded-full bg-accent motion-safe:animate-pulse" />
              </div>
            </div>

            <p v-if="scans[p.id]?.error" class="mt-2 text-xs text-danger font-medium">{{ scans[p.id]!.error }}</p>

            <div v-if="scans[p.id]?.results" class="mt-2.5 rounded-xl border border-line bg-surface-2/40 p-2.5 space-y-2">
              <div class="flex items-center justify-between gap-2 text-xs">
                <span class="font-medium" :class="working(p.id).length ? 'text-accent' : 'text-danger'">
                  {{ working(p.id).length }} of {{ scans[p.id]!.results!.length }} models work with tools · saved
                </span>
                <span
                  class="chip chip-sm text-[10px] font-mono font-semibold"
                  :class="working(p.id).length ? 'border-accent/40 bg-accent/10 text-accent' : 'border-danger/40 bg-danger/10 text-danger'"
                >
                  {{ working(p.id).length ? 'saved' : 'none working' }}
                </span>
              </div>

              <!-- Working models as chips with their seconds, best first -->
              <div v-if="working(p.id).length" class="flex flex-wrap gap-1.5">
                <span
                  v-for="r in working(p.id)"
                  :key="r.model"
                  class="chip border-accent/40 bg-accent/10 font-mono text-[11px] text-fg inline-flex items-center gap-1.5"
                  :title="`${(r.ms / 1000).toFixed(1)} s`"
                >
                  <CircleCheck :size="12" class="text-accent shrink-0" />
                  <span>{{ r.model }}</span>
                  <span class="font-mono tabular-nums text-faint text-[10px]">{{ (r.ms / 1000).toFixed(1) }}s</span>
                </span>
              </div>

              <!-- Collapsible Not working list with short reason -->
              <details v-if="scans[p.id]!.results!.length > working(p.id).length" class="group text-[11px] pt-1 border-t border-line/50">
                <summary class="cursor-pointer font-medium text-muted hover:text-fg select-none transition-colors py-0.5">
                  Not working ({{ scans[p.id]!.results!.length - working(p.id).length }})
                </summary>
                <ul class="mt-1.5 space-y-1 pl-1">
                  <li
                    v-for="r in scans[p.id]!.results!.filter((x) => !x.tool_calls)"
                    :key="r.model"
                    class="break-words font-mono text-muted flex items-start gap-1.5"
                  >
                    <CircleX :size="12" class="text-danger shrink-0 mt-0.5" />
                    <span><strong class="text-fg">{{ r.model }}</strong>: {{ (r.error ?? "answers but does not call tools").slice(0, 90) }}</span>
                  </li>
                </ul>
              </details>
            </div>
          </div>
          <div v-if="!readOnly" class="flex flex-wrap items-center gap-2 max-sm:w-full max-sm:justify-end">
            <ConfirmButton v-if="p.has_api_key" small class="min-h-10 sm:min-h-7" confirm-label="Remove key?" @confirm="clearKey(p)">Remove key</ConfirmButton>
            <button
              v-if="p.kind !== 'mock'"
              class="btn btn-sm min-h-10 sm:min-h-7"
              :disabled="scans[p.id]?.busy"
              title="Test every model and keep the ones that work with tools"
              @click="scan(p.id)"
            >
              <LoaderCircle v-if="scans[p.id]?.busy" :size="13" class="motion-safe:animate-spin" />
              <ScanSearch v-else :size="13" /> {{ scans[p.id]?.busy ? "Scanning…" : "Scan models" }}
            </button>
            <button class="btn btn-sm min-h-10 sm:min-h-7" @click="startEdit(p)"><Pencil :size="13" /> Edit</button>
            <ConfirmButton v-if="p.slug !== 'mock'" small class="min-h-10 sm:min-h-7" confirm-label="Delete?" @confirm="remove(p)">Delete</ConfirmButton>
          </div>
        </div>
      </div>
    </section>

    <section v-if="!readOnly" class="mt-8">
      <h2 class="sign mb-2">Add a provider</h2>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <button
          v-for="p in presets"
          :key="p.id"
          class="flex items-center gap-2 rounded-lg border bg-surface px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-surface-2"
          :class="p.id === 'custom' ? 'border-dashed border-line-strong' : 'border-line'"
          @click="startNew(p)"
        >
          <Plus :size="14" class="shrink-0 text-accent" /><span class="truncate">{{ p.name }}</span>
        </button>
      </div>
    </section>

    <SidePanel v-if="editing" :sign="editing === 'new' ? 'Add provider' : 'Edit provider'" :title="form.name || 'Provider'" @close="editing = null">
      <form id="prov-form" class="space-y-4" @submit.prevent="save">
        <p v-if="preset?.hint" class="rounded-md bg-info-soft px-3 py-2 text-xs text-info">{{ preset.hint }}</p>
        <div class="grid gap-3 sm:grid-cols-2">
          <div><label class="label" for="pv-name">Name</label><input id="pv-name" v-model="form.name" class="input" required /></div>
          <div>
            <label class="label" for="pv-slug">Slug · agents refer to this</label>
            <input id="pv-slug" v-model="form.slug" class="input font-mono" :disabled="editing !== 'new'" pattern="[a-z0-9][a-z0-9\-]*" required />
          </div>
        </div>
        <div v-if="form.kind === 'openai_compatible' || form.base_url">
          <label class="label" for="pv-url">Base URL</label>
          <input id="pv-url" v-model="form.base_url" class="input font-mono" placeholder="https://…/v1" :required="form.kind === 'openai_compatible'" />
          <div class="mt-1.5 space-y-0.5 text-xs text-faint leading-relaxed">
            <p>Local addresses (127.0.0.1, localhost) run on this PC.</p>
            <p>Running elsewhere (server/LAN)? Use e.g. <code>http://192.168.1.20:20128/v1</code> or <code>https://router.example.com/v1</code>.</p>
          </div>
        </div>
        <div>
          <label class="label" for="pv-key">API key</label>
          <input
            id="pv-key"
            v-model="form.api_key"
            type="password"
            autocomplete="off"
            class="input font-mono"
            :placeholder="editing === 'new' ? (preset?.needs_api_key ? 'Required' : 'Optional') : 'Leave empty to keep the current key'"
          />
        </div>
        <div v-if="form.kind !== 'mock'" class="space-y-2">
          <div class="flex items-center gap-2">
            <button type="button" class="btn btn-sm min-h-10 sm:min-h-8" :disabled="checking" @click="checkNow">
              <LoaderCircle v-if="checking" :size="13" class="motion-safe:animate-spin" />
              <Plug v-else :size="13" /> Check connection
            </button>
          </div>
          <!-- Clear green / red line with model count or error -->
          <div
            v-if="check?.ok"
            class="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs font-medium text-accent"
          >
            <CircleCheck :size="14" class="shrink-0 text-accent" />
            <span>Connected · {{ check.models }} model{{ check.models === 1 ? '' : 's' }} listed</span>
          </div>
          <div
            v-else-if="check"
            class="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs font-medium text-danger break-words"
          >
            <CircleX :size="14" class="shrink-0 text-danger mt-0.5" />
            <span>{{ check.error }}</span>
          </div>
        </div>
        <p v-if="editing === 'new'" class="text-xs text-faint">Leave Models empty: after you save, every model is tested and the ones that work with tools are kept.</p>
        <div>
          <label class="label" for="pv-models">Models · one per line</label>
          <textarea id="pv-models" v-model="form.models" class="input min-h-28 font-mono text-xs" />
        </div>
        <div>
          <label class="label" for="pv-price">Prices per 1M tokens · <code>model input output</code></label>
          <textarea id="pv-price" v-model="form.pricing" class="input min-h-24 font-mono text-xs" placeholder="my-model 0.5 1.5" />
          <p class="mt-1 text-xs text-faint">Claude models have built-in prices. Others show "no price" until set.</p>
        </div>
        <label class="flex items-center gap-2 text-sm"><input v-model="form.enabled" type="checkbox" class="accent-accent" /> Enabled</label>
      </form>
      <template #footer>
        <p v-if="error" class="min-w-0 flex-1 truncate text-sm text-danger" :title="error">{{ error }}</p>
        <button type="button" class="btn ml-auto" @click="editing = null">Cancel</button>
        <button form="prov-form" class="btn btn-primary">Save</button>
      </template>
    </SidePanel>
  </div>
</template>
