<script setup lang="ts">
import { computed, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import AppShell from "./components/shell/AppShell.vue";
import { useOffice } from "./stores/office.ts";

const office = useOffice();
const route = useRoute();
const router = useRouter();
const isLogin = computed(() => route.name === "login");

watch(
  isLogin,
  (login) => {
    if (login) office.stop();
    else office.start(() => void router.push({ name: "login" }));
  },
  { immediate: true },
);
</script>

<template>
  <RouterView v-if="isLogin" />
  <AppShell v-else>
    <RouterView />
  </AppShell>
</template>
