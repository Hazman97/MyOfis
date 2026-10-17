<script setup lang="ts">
import { RouterLink } from "vue-router";

const tabs = [
  { to: "/settings/providers", label: "AI providers" },
  { to: "/settings/integrations", label: "Integrations" },
];
</script>

<template>
  <nav class="flex gap-1 border-b border-line text-sm" aria-label="Settings">
    <RouterLink
      v-for="t in tabs"
      :key="t.to"
      :to="t.to"
      class="-mb-px border-b-2 border-transparent px-3 py-2 font-medium text-muted hover:text-fg"
      active-class="border-accent! text-fg!"
    >
      {{ t.label }}
    </RouterLink>
  </nav>
</template>
