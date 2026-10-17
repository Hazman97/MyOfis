<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import type { Project } from "@agent-office/shared";
import ConfirmButton from "./ConfirmButton.vue";
import { api, type FacebookSettings } from "../api/http.ts";

/**
 * The project's Facebook Page: approved Facebook captions (with their photo) are posted there.
 * The Page access token is stored encrypted in the hub and never shown again.
 */
const props = defineProps<{ project: Project }>();
const fb = ref<FacebookSettings | null>(null);
const form = reactive({ page_id: "", token: "" });
const busy = ref(false);
const msg = ref("");
const error = ref("");

onMounted(async () => {
  fb.value = (await api.facebookSettings(props.project.id)).facebook;
  form.page_id = fb.value.page_id;
});

async function run(fn: () => Promise<{ facebook: FacebookSettings }>, ok: string) {
  busy.value = true;
  error.value = msg.value = "";
  try {
    fb.value = (await fn()).facebook;
    form.page_id = fb.value.page_id;
    form.token = "";
    msg.value = ok;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const save = () => run(() => api.saveFacebookSettings(props.project.id, { page_id: form.page_id.trim(), ...(form.token ? { token: form.token.trim() } : {}) }), "Saved. Press Test.");
const test = () => run(() => api.testFacebookSettings(props.project.id), "Connected.");
const clear = () => run(() => api.saveFacebookSettings(props.project.id, { page_id: "", token: "" }), "Facebook Page removed.");
</script>

<template>
  <form class="space-y-4 border-t border-line pt-5" @submit.prevent="save">
    <div>
      <h3 class="text-sm font-semibold">Facebook Page</h3>
      <p class="mt-1 text-xs leading-relaxed text-muted">
        When connected, approving a Facebook caption posts it to this Page (with its photo). Get the Page id and a long-lived <b>Page access token</b> as in
        <code>docs/facebook-page.md</code>.
      </p>
    </div>
    <div v-if="fb?.page_name" class="rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-accent">Connected to <b>{{ fb.page_name }}</b></div>
    <div>
      <label class="label" for="fb-page">Page id</label>
      <input id="fb-page" v-model="form.page_id" inputmode="numeric" class="input font-mono" placeholder="e.g. 123456789012345" />
    </div>
    <div>
      <label class="label" for="fb-token">Page access token</label>
      <input
        id="fb-token"
        v-model="form.token"
        type="password"
        autocomplete="off"
        class="input font-mono"
        :placeholder="fb?.has_token ? `Stored ${fb.token_hint}: leave empty to keep` : 'EAA…'"
      />
    </div>
    <p v-if="msg" class="rounded-md bg-accent-soft px-3 py-2 text-sm text-accent" role="status">{{ msg }}</p>
    <p v-if="error" class="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{{ error }}</p>
    <div class="flex flex-wrap gap-2 border-t border-line pt-4">
      <ConfirmButton v-if="fb?.page_id" small confirm-label="Remove?" @confirm="clear">Remove</ConfirmButton>
      <button type="button" class="btn btn-sm ml-auto" :disabled="busy || !fb?.page_id || !fb?.has_token" @click="test">Test</button>
      <button class="btn btn-primary btn-sm" :disabled="busy">Save</button>
    </div>
  </form>
</template>
