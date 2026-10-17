<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import BrandMark from "../components/shell/BrandMark.vue";
import { api } from "../api/http.ts";
import { resetAuthCheck } from "../router.ts";

const token = ref("");
const error = ref("");
const busy = ref(false);
const router = useRouter();
const route = useRoute();
const mode = ref<"local" | "cf-access">("local");
onMounted(async () => {
  try {
    mode.value = (await api.authMode()).mode;
  } catch {
    /* keep the token form */
  }
});

async function submit() {
  busy.value = true;
  error.value = "";
  try {
    await api.login(token.value);
    resetAuthCheck();
    const next = typeof route.query.next === "string" && route.query.next.startsWith("/") ? route.query.next : "/";
    await router.replace(next);
  } catch (e) {
    error.value = (e as Error).message === "wrong token" ? "That token doesn't match LOCAL_AUTH_TOKEN in your .env." : (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center px-4">
    <form class="w-full max-w-sm" @submit.prevent="submit">
      <div class="mb-6 flex flex-col items-center text-center">
        <BrandMark :size="48" />
        <h1 class="mt-3 text-xl font-semibold tracking-tight">Agent Office</h1>
        <p class="sign mt-1">Owner entrance</p>
      </div>
      <div v-if="mode === 'cf-access'" class="card-raised space-y-4 p-6 text-center">
        <p class="text-sm text-muted">This office signs in through Cloudflare Access with your email.</p>
        <a href="/" class="btn btn-primary w-full">Sign in with Cloudflare Access</a>
      </div>
      <div v-else class="card-raised space-y-4 p-6">
        <div>
          <label class="label" for="token">Owner token</label>
          <input id="token" v-model="token" type="password" autocomplete="current-password" class="input font-mono" autofocus required />
          <p class="mt-1.5 text-xs text-faint">The <code>LOCAL_AUTH_TOKEN</code> value from your <code>.env</code> file.</p>
        </div>
        <p v-if="error" class="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{{ error }}</p>
        <button class="btn btn-primary w-full" :disabled="busy || !token">{{ busy ? "Checking…" : "Enter the office" }}</button>
      </div>
    </form>
  </div>
</template>
