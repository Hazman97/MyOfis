<script setup lang="ts">
defineProps<{ title: string; sign?: string; description?: string }>();
</script>

<template>
  <header class="mb-5 flex flex-wrap items-end gap-x-4 gap-y-3">
    <div class="min-w-0 flex-1">
      <div v-if="sign" class="sign mb-1">{{ sign }}</div>
      <h1 class="text-[22px] leading-tight font-semibold tracking-tight sm:text-2xl">{{ title }}</h1>
      <p v-if="description" class="mt-1 max-w-[65ch] text-sm text-muted">{{ description }}</p>
    </div>
    <div v-if="$slots.default" class="flex flex-wrap items-center gap-2"><slot /></div>
  </header>
</template>
