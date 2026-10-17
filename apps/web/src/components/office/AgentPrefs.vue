<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { SlidersHorizontal } from "lucide-vue-next";
import { AgentPreferences, preferencesPrompt, type Agent } from "@agent-office/shared";
import { api } from "../../api/http.ts";
import { useOffice } from "../../stores/office.ts";

/**
 * "How I like it": the owner sets how this agent should talk and work (language, tone,
 * length, emoji, format, free notes). Saved in the agent's config and added to its prompt
 * after the role, so the agent follows it on every job and chat.
 */
const props = defineProps<{ agent: Agent }>();
const office = useOffice();
const prefs = reactive<AgentPreferences>(AgentPreferences.parse({}));
const saving = ref(false);
const msg = ref("");
const error = ref("");

const load = () => Object.assign(prefs, AgentPreferences.parse(props.agent.config.preferences ?? {}));
watch(() => props.agent.id, load, { immediate: true });

const saved = computed(() => JSON.stringify(AgentPreferences.parse(props.agent.config.preferences ?? {})));
const dirty = computed(() => JSON.stringify(prefs) !== saved.value);
const preview = computed(() => preferencesPrompt(prefs).replace(/^\n\n## [^\n]*\n/, ""));

const OPTIONS = {
  language: [
    ["auto", "Auto"],
    ["manglish", "Manglish"],
    ["ms", "Bahasa Melayu"],
    ["en", "English"],
  ],
  tone: [
    ["auto", "Auto"],
    ["casual", "Santai"],
    ["friendly", "Mesra"],
    ["professional", "Profesional"],
    ["direct", "Terus terang"],
  ],
  length: [
    ["auto", "Auto"],
    ["short", "Pendek"],
    ["detailed", "Panjang & detail"],
  ],
  emoji: [
    ["auto", "Auto"],
    ["none", "Tiada"],
    ["some", "Sikit-sikit"],
  ],
  format: [
    ["auto", "Auto"],
    ["bullets", "Bullet points"],
    ["paragraphs", "Perenggan"],
  ],
} as const;
const LABELS: Record<keyof typeof OPTIONS, string> = { language: "Bahasa", tone: "Nada", length: "Panjang jawapan", emoji: "Emoji", format: "Format" };
const keys = Object.keys(OPTIONS) as (keyof typeof OPTIONS)[];

async function save() {
  error.value = msg.value = "";
  saving.value = true;
  try {
    await api.updateAgent(props.agent.id, { config: { ...props.agent.config, preferences: AgentPreferences.parse(prefs) } });
    await office.loadAgents();
    msg.value = "Saved. It applies from the next job or chat message.";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section aria-labelledby="pf-title" class="space-y-3.5">
    <div>
      <div class="flex items-center gap-1.5">
        <SlidersHorizontal :size="13" class="text-accent" />
        <h3 id="pf-title" class="sign text-accent">How you like it</h3>
      </div>
      <p class="mt-1 text-xs text-muted leading-relaxed">How {{ agent.name }} should talk and work for you. Applies to every job and chat.</p>
    </div>

    <div v-for="k in keys" :key="k">
      <div class="mb-1 text-[11px] font-medium text-muted">{{ LABELS[k] }}</div>
      <div class="flex flex-wrap gap-1.5" role="radiogroup" :aria-label="LABELS[k]">
        <button
          v-for="[value, label] in OPTIONS[k]"
          :key="value"
          type="button"
          role="radio"
          :aria-checked="prefs[k] === value"
          class="rounded-full border px-2.5 py-0.5 text-xs font-medium transition-all duration-150 cursor-pointer"
          :class="
            prefs[k] === value
              ? 'border-accent bg-accent text-accent-ink font-semibold shadow-xs'
              : value === 'auto'
                ? 'border-line/50 bg-transparent text-faint hover:border-line hover:text-muted'
                : 'border-line bg-surface/70 text-muted hover:border-line-strong hover:bg-surface-2 hover:text-fg'
          "
          @click="(prefs[k] as string) = value"
        >
          {{ label }}
        </button>
      </div>
    </div>

    <div>
      <label for="pf-notes" class="mb-1 block text-[11px] font-medium text-muted">Anything else</label>
      <textarea
        id="pf-notes"
        v-model="prefs.notes"
        maxlength="1500"
        class="input min-h-20 bg-sunken/80 border-line focus:bg-surface text-xs leading-relaxed p-2.5 shadow-inner"
        placeholder="e.g. Panggil saya boss. Selalu habiskan dengan next step. Harga mesti dalam RM."
      />
      <div class="mt-1 flex justify-end text-[10px] font-mono text-faint">
        {{ prefs.notes.length }}/1500
      </div>
    </div>

    <details v-if="preview" class="group text-xs text-muted">
      <summary class="cursor-pointer text-[11px] font-medium text-muted hover:text-fg select-none transition-colors">
        What the agent will be told
      </summary>
      <pre class="mt-1.5 whitespace-pre-wrap rounded-lg border border-line bg-sunken/80 p-2.5 font-mono text-[11px] leading-relaxed text-fg shadow-inner">{{ preview }}</pre>
    </details>

    <p v-if="!preview" class="text-xs text-muted/80">All on Auto: the agent uses its normal style.</p>
    <p v-if="msg" class="text-xs text-accent font-medium" role="status">{{ msg }}</p>
    <p v-if="error" class="text-xs text-danger font-medium" role="alert">{{ error }}</p>

    <div class="flex justify-end pt-1">
      <button type="button" class="btn btn-primary btn-sm shadow-sm" :disabled="!dirty || saving" @click="save">
        {{ saving ? "Saving…" : "Save" }}
      </button>
    </div>
  </section>
</template>
