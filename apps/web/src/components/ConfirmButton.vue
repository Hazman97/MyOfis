<script setup lang="ts">
import { ref } from "vue";

/** Destructive action: first click arms it ("Click to confirm"), second click within 4 s runs it. */
const props = defineProps<{ confirmLabel?: string; small?: boolean }>();
const emit = defineEmits<{ confirm: [] }>();
const armed = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

function click() {
  if (!armed.value) {
    armed.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => (armed.value = false), 4000);
    return;
  }
  armed.value = false;
  clearTimeout(timer);
  emit("confirm");
}
</script>

<template>
  <button type="button" class="btn" :class="[armed ? 'btn-signal' : 'btn-danger', props.small && 'btn-sm']" @click="click">
    <template v-if="armed">{{ confirmLabel ?? "Click to confirm" }}</template>
    <slot v-else />
  </button>
</template>
