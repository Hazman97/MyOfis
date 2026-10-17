<script setup lang="ts">
import { ExternalLink } from "lucide-vue-next";

/** The owner's manual (docs/manual.html, served by the hub). It has its own search, contents and theme. */
const src = "/api/manual";
</script>

<template>
  <div class="flex h-[calc(100dvh-3.5rem-6rem)] flex-col lg:h-dvh">
    <div class="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
      <h1 class="text-sm font-semibold">User manual</h1>
      <a :href="src" target="_blank" rel="noopener" class="btn btn-sm"><ExternalLink :size="14" /> Full screen</a>
    </div>
    <iframe :src="src" title="User manual" class="min-h-0 w-full flex-1 border-0 bg-surface" />
  </div>
</template>
