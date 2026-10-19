<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { isOwner } from "../me.ts";

// members keep their own AI providers; integrations (Telegram, Gitea, search, backups) are the owner's
const tabs = computed(() => [
  { to: "/settings/providers", label: "AI providers" },
  ...(isOwner.value ? [{ to: "/settings/integrations", label: "Integrations" }, { to: "/members", label: "Members" }] : []),
]);
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
