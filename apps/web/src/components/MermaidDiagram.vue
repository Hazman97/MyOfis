<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

/**
 * Renders a mermaid diagram. Mermaid is big, so it is loaded only when a diagram is shown
 * (its own chunk). The theme follows the app's light/dark setting and re-renders when it changes.
 */
const props = withDefaults(
  defineProps<{
    code: string;
    label: string;
    full?: boolean;
  }>(),
  {
    full: false,
  },
);
const svg = ref("");
const error = ref("");
let n = 0;

const dark = () => {
  const t = document.documentElement.dataset.theme;
  return t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
};

async function render() {
  try {
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({
      startOnLoad: false,
      theme: dark() ? "dark" : "neutral",
      securityLevel: "strict",
      fontFamily: "IBM Plex Sans, sans-serif",
      er: { useMaxWidth: false },
      flowchart: { useMaxWidth: false },
    });
    const out = await mermaid.render(`mmd-${Math.random().toString(36).slice(2)}-${n++}`, props.code);
    svg.value = out.svg;
    error.value = "";
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const themeWatch = new MutationObserver(() => void render());
const media = matchMedia("(prefers-color-scheme: dark)");
const onMedia = () => void render();
onMounted(() => {
  void render();
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  media.addEventListener("change", onMedia);
});
onBeforeUnmount(() => {
  themeWatch.disconnect();
  media.removeEventListener("change", onMedia);
});
watch(() => props.code, () => void render());
</script>

<template>
  <figure
    class="diagram-figure overflow-x-auto rounded-xl border border-line/60 bg-surface/60 p-3 sm:p-5 transition-colors"
    :class="full && 'border-0! bg-transparent! p-0!'"
    :aria-label="label"
    tabindex="0"
  >
    <!-- mermaid output with securityLevel "strict" (no scripts, no HTML labels) -->
    <div v-if="svg" class="mermaid-diagram flex justify-start lg:justify-center" :class="{ 'is-full': full }" v-html="svg" />
    <p v-else-if="error" class="text-xs text-danger">Diagram error: {{ error }}</p>
    <p v-else class="text-xs text-muted">Drawing…</p>
  </figure>
</template>

<style scoped>
.diagram-figure {
  -webkit-overflow-scrolling: touch;
}

/* fills the card; on a phone it keeps a readable width and the figure scrolls sideways */
.mermaid-diagram :deep(svg) {
  width: 100%;
  min-width: 720px;
  max-width: 1100px;
  height: auto;
  padding: 4px;
}

.mermaid-diagram.is-full :deep(svg) {
  min-width: 900px;
  max-width: 1600px;
  padding: 12px;
}
</style>
