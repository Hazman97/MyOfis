<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { CircleAlert, CircleCheck, Download, FlaskConical, LoaderCircle, TriangleAlert } from "lucide-vue-next";
import { AUTO_MODEL, rankModels, type ProviderPublic } from "@agent-office/shared";
import { api, type ModelTest } from "../api/http.ts";

/**
 * Pick an agent's provider + model, load the provider's model list, and test a model before using
 * it ("can it call tools?"). Used in the Agents form, the Chat header and the office agent panel.
 * v-model:provider / v-model:model; it saves nothing itself.
 */
const provider = defineModel<string>("provider", { required: true });
const model = defineModel<string>("model", { required: true });
defineProps<{ compact?: boolean }>();

const providers = ref<ProviderPublic[]>([]);
const loading = ref(false);
const testing = ref(false);
const error = ref("");
const result = ref<ModelTest | null>(null);
const loaded = ref<Record<string, string[]>>({});

onMounted(async () => {
  try {
    providers.value = (await api.providers()).providers.filter((p) => p.enabled && p.kind !== "mock");
  } catch (e) {
    error.value = (e as Error).message;
  }
});

const current = computed(() => providers.value.find((p) => p.slug === provider.value));
/** The provider's models, best first (scanned lists are already in that order). */
const options = computed(() => rankModels([...new Set([...(current.value?.models ?? []), ...(loaded.value[provider.value] ?? [])])]));
// a model not in the list (typed by hand, or from another provider) shows the free-text box
const custom = ref(false);
const choice = computed({
  get: () => (custom.value || (model.value && model.value !== AUTO_MODEL && !options.value.includes(model.value)) ? "__other" : model.value),
  set: (v: string) => {
    if (v === "__other") {
      custom.value = true;
      return;
    }
    custom.value = false;
    model.value = v;
  },
});
// a different model or provider: the old test result no longer applies
watch([provider, model], () => (result.value = null));
// switching provider: "auto" when it has a model list, else its first model
watch(provider, (_now, before) => {
  if (!before || !current.value) return;
  custom.value = false;
  model.value = current.value.models.length ? AUTO_MODEL : "";
});
/** What "auto" will use first (shown under the picker). */
const autoFirst = computed(() => (model.value === AUTO_MODEL ? options.value.slice(0, 3) : []));

async function loadModels() {
  if (!current.value) return;
  loading.value = true;
  error.value = "";
  try {
    loaded.value = { ...loaded.value, [provider.value]: (await api.providerModels(current.value.id, true)).models };
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

async function test() {
  if (!current.value || !model.value.trim()) return;
  // "auto": test the model it would use first
  const target = model.value === AUTO_MODEL ? options.value[0] : model.value.trim();
  if (!target) return;
  testing.value = true;
  error.value = "";
  result.value = null;
  try {
    result.value = (await api.testModel(current.value.id, target)).test;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    testing.value = false;
  }
}

</script>

<template>
  <div class="space-y-2">
    <div class="grid gap-2" :class="compact ? 'grid-cols-1' : 'sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]'">
      <label class="block min-w-0">
        <span class="label">Provider</span>
        <select v-model="provider" class="input w-full text-sm">
          <option v-for="p in providers" :key="p.id" :value="p.slug">{{ p.name }}</option>
          <option v-if="provider && !current" :value="provider">{{ provider }} (unavailable)</option>
        </select>
      </label>
      <label class="block min-w-0">
        <span class="label">Model</span>
        <select v-model="choice" class="input w-full font-mono text-xs">
          <option v-if="options.length" :value="AUTO_MODEL">Auto · best available, falls back when one fails</option>
          <option v-for="m in options" :key="m" :value="m">{{ m }}</option>
          <option value="__other">Other (type a model id)…</option>
        </select>
        <input v-if="choice === '__other'" v-model="model" class="input mt-1.5 w-full font-mono text-xs" placeholder="model id" spellcheck="false" />
      </label>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <button type="button" class="btn btn-sm min-h-9" :disabled="!current || loading" title="Ask the provider which models it has" @click="loadModels">
        <LoaderCircle v-if="loading" :size="13" class="motion-safe:animate-spin" />
        <Download v-else :size="13" />
        Load models
      </button>
      <button type="button" class="btn btn-sm min-h-9" :disabled="!current || !model || testing" title="Send one small request with a tool" @click="test">
        <LoaderCircle v-if="testing" :size="13" class="motion-safe:animate-spin" />
        <FlaskConical v-else :size="13" />
        Test model
      </button>
      <span v-if="loaded[provider]" class="text-[11px] text-faint">{{ loaded[provider]!.length }} models</span>
    </div>
    <p v-if="autoFirst.length" class="text-[11px] text-muted">
      Auto tries, in order: <span class="font-mono">{{ autoFirst.join(" → ") }}</span>{{ options.length > 3 ? " …" : "" }}. A model that hits its limit is skipped for the next.
    </p>
    <p v-if="current && !options.length" class="text-[11px] text-signal">No model list yet: press Load models, or Scan models in Settings → AI providers.</p>

    <div v-if="result" class="rounded-md border px-2.5 py-2 text-xs" :class="!result.ok ? 'border-danger/40 bg-danger-soft text-danger' : result.tool_calls ? 'border-accent/30 bg-accent/5' : 'border-signal/40 bg-signal-soft'">
      <p class="flex items-center gap-1.5 font-medium">
        <CircleAlert v-if="!result.ok" :size="13" />
        <CircleCheck v-else-if="result.tool_calls" :size="13" class="text-accent" />
        <TriangleAlert v-else :size="13" class="text-signal" />
        <template v-if="!result.ok">Not working: {{ result.error }}</template>
        <template v-else-if="result.tool_calls">Works and calls tools ({{ (result.ms / 1000).toFixed(1) }} s). Good for agents.</template>
        <template v-else>Answers, but did not call the tool ({{ (result.ms / 1000).toFixed(1) }} s). Fine for chat, weak for agents that use tools.</template>
      </p>
      <p v-if="result.reply" class="mt-1 break-words font-mono text-[11px] text-muted">{{ result.reply }}</p>
    </div>
    <p v-if="error" class="text-xs text-danger break-words">{{ error }}</p>
    <p v-if="current && !current.has_api_key && current.kind !== 'openai_compatible'" class="text-[11px] text-signal">This provider has no API key yet: add it in Settings → Providers.</p>
  </div>
</template>
