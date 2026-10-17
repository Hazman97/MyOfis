<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { KeyRound, Pencil, Plus } from "lucide-vue-next";
import type { ProviderPreset, ProviderPublic } from "@agent-office/shared";
import ConfirmButton from "../components/ConfirmButton.vue";
import PageHeader from "../components/PageHeader.vue";
import SettingsTabs from "../components/SettingsTabs.vue";
import SidePanel from "../components/SidePanel.vue";
import { api } from "../api/http.ts";

const providers = ref<ProviderPublic[]>([]);
const presets = ref<ProviderPreset[]>([]);
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
  [providers.value, presets.value] = await Promise.all([api.providers().then((r) => r.providers), api.presets().then((r) => r.presets)]);
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
}

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
    if (editing.value === "new") await api.createProvider({ ...body, slug: form.slug });
    else await api.updateProvider(editing.value!, body);
    editing.value = null;
    await load();
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
          </div>
          <div class="flex gap-2 max-sm:w-full max-sm:justify-end">
            <ConfirmButton v-if="p.has_api_key" small confirm-label="Remove key?" @confirm="clearKey(p)">Remove key</ConfirmButton>
            <button class="btn btn-sm" @click="startEdit(p)"><Pencil :size="13" /> Edit</button>
            <ConfirmButton v-if="p.slug !== 'mock'" small confirm-label="Delete?" @confirm="remove(p)">Delete</ConfirmButton>
          </div>
        </div>
      </div>
    </section>

    <section class="mt-8">
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
          <p class="mt-1 text-xs text-faint">Local addresses (127.0.0.1) are resolved on the runner's machine.</p>
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
