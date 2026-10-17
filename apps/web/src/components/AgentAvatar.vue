<script setup lang="ts">
import { computed } from "vue";
import { outfitFor } from "../office/art/characters.ts";
import { OFFICE_ASSETS, useCharacterArt } from "../office/assets.ts";
import { useOffice } from "../stores/office.ts";

/** Agent face: head and shoulders of the agent's office sprite, initials until the art has loaded. */
const props = defineProps<{ name: string; slug?: string; size?: number }>();
const office = useOffice();
const art = useCharacterArt();

const px = computed(() => props.size ?? 36);
const hues = [158, 32, 205, 280, 12, 95, 340, 185];
const hue = computed(() => {
  let h = 0;
  for (const ch of props.slug ?? props.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return hues[h % hues.length];
});
const initials = computed(() =>
  props.name
    .split(/[\s()-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join(""),
);

const face = computed(() => {
  const m = art.value;
  if (!m || !props.slug) return null;
  const agent = office.agents.find((a) => a.slug === props.slug);
  const look = outfitFor({ slug: props.slug, sprite: agent?.sprite }, m.meta.outfits);
  const f = m.frames[`${look}/down`]?.frame;
  if (!f) return null;
  // integer scale keeps pixels crisp; show art rows 1..15 (head + shoulders)
  const s = Math.max(1, Math.round(px.value / f.w));
  const shown = 15 * s;
  return {
    left: `${Math.round((px.value - f.w * s) / 2)}px`,
    top: `${Math.max(0, px.value - shown)}px`,
    width: `${f.w * s}px`,
    height: `${shown}px`,
    backgroundImage: `url(${OFFICE_ASSETS}${m.meta.image})`,
    backgroundSize: `${m.meta.size.w * s}px ${m.meta.size.h * s}px`,
    backgroundPosition: `${-f.x * s}px ${-(f.y + 1) * s}px`,
    imageRendering: "pixelated" as const,
  };
});
</script>

<template>
  <span
    class="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md font-pixel"
    :style="{
      width: `${px}px`,
      height: `${px}px`,
      fontSize: `${Math.round(px * 0.36)}px`,
      background: `hsl(${hue} 45% 50% / 0.16)`,
      color: `hsl(${hue} 55% 38%)`,
    }"
    aria-hidden="true"
  >
    <span v-if="face" class="absolute bg-no-repeat" :style="face" />
    <template v-else>{{ initials }}</template>
  </span>
</template>
