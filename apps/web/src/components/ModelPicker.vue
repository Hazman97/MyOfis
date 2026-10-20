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
    // save the raw list only when the provider has none: it must never replace the ranked, tested
    // list a scan saved (auto would then try paid / non-tool models first)
    const save = !current.value.models?.length;
    loaded.value = { ...loaded.value, [provider.value]: (await api.providerModels(current.value.id, save)).models };
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
    <!-- Provider and Model: side by side on desktop, stacked on phone -->
    <div class="grid grid-cols-1 gap-2" :class="compact ? 'grid-cols-1' : 'sm:grid-cols-2'">
      <label class="block min-w-0">
        <span class="label">Provider</span>
        <select v-model="provider" class="input w-full min-h-10 sm:min-h-8 text-sm">
          <option v-for="p in providers" :key="p.id" :value="p.slug">{{ p.name }}</option>
          <option v-if="provider && !current" :value="provider">{{ provider }} (unavailable)</option>
        </select>
      </label>
      <label class="block min-w-0">
        <span class="label">Model</span>
        <select v-model="choice" class="input w-full min-h-10 sm:min-h-8 font-mono text-xs">
          <option v-if="options.length" :value="AUTO_MODEL">Auto · best available, falls back when one fails</option>
          <option v-for="m in options" :key="m" :value="m">{{ m }}</option>
          <option value="__other">Other (type a model id)…</option>
        </select>
        <input v-if="choice === '__other'" v-model="model" class="input mt-1.5 w-full min-h-10 sm:min-h-8 font-mono text-xs" placeholder="model id" spellcheck="false" />
      </label>
    </div>

    <!-- Actions: Load and Test buttons -->
    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="btn btn-sm min-h-10 sm:min-h-8 font-medium cursor-pointer"
        :disabled="!current || loading"
        title="Ask the provider which models it has"
        @click="loadModels"
      >
        <LoaderCircle v-if="loading" :size="13" class="motion-safe:animate-spin" />
        <Download v-else :size="13" />
        Load models
      </button>
      <button
        type="button"
        class="btn btn-sm min-h-10 sm:min-h-8 font-medium cursor-pointer"
        :disabled="!current || !model || testing"
        title="Send one small request with a tool"
        @click="test"
      >
        <LoaderCircle v-if="testing" :size="13" class="motion-safe:animate-spin" />
        <FlaskConical v-else :size="13" />
        Test model
      </button>
      <span v-if="loaded[provider]" class="text-[11px] text-faint font-mono">{{ loaded[provider]!.length }} models</span>
    </div>

    <!-- When Model = Auto, show a small "Auto" badge plus try-order line -->
    <div
      v-if="model === AUTO_MODEL && autoFirst.length"
      class="flex items-start gap-2 rounded-lg border border-line bg-surface-2/50 p-2 text-[11.5px] leading-relaxed text-muted"
    >
      <span class="chip chip-sm shrink-0 border-accent/40 bg-accent/10 font-mono font-bold text-accent text-[10px]">Auto</span>
      <div class="min-w-0 flex-1">
        <span>Auto tries, in order: </span>
        <span class="font-mono font-semibold text-fg">{{ autoFirst.join(" → ") }}</span>
        <span v-if="options.length > 3"> …</span>
        <p class="mt-0.5 text-[10.5px] text-faint">A model that hits its limit is skipped for the next.</p>
      </div>
    </div>
    <p v-if="current && !options.length" class="text-[11px] text-signal font-medium">No model list yet: press Load models, or Scan models in Settings → AI providers.</p>

    <!-- Test result small card: ✅ works with tools / ⚠️ answers but no tools / ❌ error -->
    <div
      v-if="result"
      class="rounded-xl border p-2.5 text-xs transition-all space-y-1.5"
      :class="!result.ok
        ? 'border-danger/45 bg-danger-soft/70 text-danger'
        : result.tool_calls
          ? 'border-accent/40 bg-accent/10 text-fg'
          : 'border-signal/50 bg-signal-soft/70 text-fg'"
    >
      <div class="flex items-center gap-1.5 font-medium leading-snug">
        <CircleAlert v-if="!result.ok" :size="14" class="text-danger shrink-0" />
        <CircleCheck v-else-if="result.tool_calls" :size="14" class="text-accent shrink-0" />
        <TriangleAlert v-else :size="14" class="text-signal shrink-0" />

        <span v-if="!result.ok" class="font-semibold text-danger">
          Error: {{ result.error }}
        </span>
        <span v-else-if="result.tool_calls" class="font-semibold text-accent">
          Works with tools ({{ (result.ms / 1000).toFixed(1) }}s)
        </span>
        <span v-else class="font-semibold text-signal">
          Answers, but no tools ({{ (result.ms / 1000).toFixed(1) }}s)
        </span>
      </div>

      <p v-if="result.ok && result.tool_calls" class="text-[11px] text-muted">
        Successfully called tool. Good for agents.
      </p>
      <p v-else-if="result.ok && !result.tool_calls" class="text-[11px] text-muted">
        Fine for chat, weak for agents that use tools.
      </p>

      <div
        v-if="result.reply"
        class="mt-1 rounded-md border border-line/60 bg-surface/80 p-2 font-mono text-[11px] leading-relaxed text-fg break-words whitespace-pre-wrap select-text"
      >
        {{ result.reply }}
      </div>
    </div>

    <p v-if="error" class="text-xs text-danger font-medium break-words">{{ error }}</p>
    <p v-if="current && !current.has_api_key && current.kind !== 'openai_compatible'" class="text-[11px] text-signal font-medium">This provider has no API key yet: add it in Settings → Providers.</p>
  </div>
</template>
