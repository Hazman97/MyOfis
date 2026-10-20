<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { CircleAlert, CircleCheck, Download, FlaskConical, LoaderCircle, TriangleAlert } from "lucide-vue-next";
import type { ProviderPublic } from "@agent-office/shared";
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
const options = computed(() => [...new Set([...(loaded.value[provider.value] ?? []), ...(current.value?.models ?? [])])]);
// a different model or provider: the old test result no longer applies
watch([provider, model], () => (result.value = null));

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
  testing.value = true;
  error.value = "";
  result.value = null;
  try {
    result.value = (await api.testModel(current.value.id, model.value.trim())).test;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    testing.value = false;
  }
}

const listId = `models-${Math.random().toString(36).slice(2, 8)}`;
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
        <input v-model="model" class="input w-full font-mono text-xs" :list="listId" placeholder="model id" spellcheck="false" />
        <datalist :id="listId"><option v-for="m in options" :key="m" :value="m" /></datalist>
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
