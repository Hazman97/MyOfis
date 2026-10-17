<script setup lang="ts">
/** A tiny pixel office block: the app's mark. Pixels are rects on a 12x12 grid. */
defineProps<{ size?: number }>();
const windows: [number, number][] = [
  [3, 4], [5, 4], [7, 4],
  [3, 6], [7, 6],
  [3, 8], [5, 8], [7, 8],
];
</script>

<template>
  <svg :width="size ?? 28" :height="size ?? 28" viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="1" y="2" width="10" height="9" fill="var(--accent)" />
    <rect x="2" y="1" width="8" height="1" fill="var(--accent)" />
    <rect x="1" y="11" width="10" height="1" fill="var(--fg)" opacity="0.25" />
    <rect v-for="([x, y], i) in windows" :key="i" :x="x" :y="y" width="1" height="1" fill="var(--accent-ink)" />
    <rect x="5" y="6" width="1" height="1" fill="var(--signal)" />
    <rect x="5" y="9" width="2" height="2" fill="var(--accent-ink)" />
  </svg>
</template>
