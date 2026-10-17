<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { Check, LoaderCircle, Share2 } from "lucide-vue-next";
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
  <form class="card p-4 space-y-4" @submit.prevent="save">
    <!-- Header -->
    <div class="flex items-center justify-between gap-2 border-b border-line pb-3">
      <div class="flex items-center gap-2">
        <Share2 :size="16" class="text-info" />
        <h3 class="font-semibold text-sm text-fg">Facebook Page</h3>
      </div>
      <span v-if="fb?.page_name" class="chip border-accent/40 bg-accent/10 text-accent font-medium text-[11px]">Connected</span>
      <span v-else class="chip text-muted text-[11px]">Not connected</span>
    </div>

    <p class="text-xs leading-relaxed text-muted">
      When connected, approving a Facebook caption posts it to this Page (with its photo). Get the Page id and a long-lived <b>Page access token</b> as in
      <code>docs/facebook-page.md</code>.
    </p>

    <!-- Connected banner -->
    <div v-if="fb?.page_name" class="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-accent">
      <Check :size="14" class="shrink-0" />
      <span class="min-w-0 flex-1">Connected to <b>{{ fb.page_name }}</b></span>
    </div>

    <div>
      <label class="label" for="fb-page">Page id</label>
      <input id="fb-page" v-model="form.page_id" inputmode="numeric" class="input font-mono text-xs" placeholder="e.g. 123456789012345" />
      <p class="mt-1 text-xs text-faint">Found in your Facebook Page's About tab.</p>
    </div>

    <div>
      <label class="label" for="fb-token">Page access token</label>
      <input
        id="fb-token"
        v-model="form.token"
        type="password"
        autocomplete="off"
        class="input font-mono text-xs"
        :placeholder="fb?.has_token ? `Stored ${fb.token_hint}: leave empty to keep` : 'EAA…'"
      />
      <p class="mt-1 text-xs text-faint">
        {{ fb?.has_token ? `Stored ${fb.token_hint}: leave empty to keep.` : 'A long-lived Page access token with pages_manage_posts.' }}
      </p>
    </div>

    <p v-if="msg" class="rounded-md bg-accent-soft px-3 py-2 text-sm text-accent" role="status">{{ msg }}</p>
    <p v-if="error" class="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{{ error }}</p>

    <!-- Footer buttons -->
    <div class="flex flex-wrap items-center gap-2 border-t border-line pt-3.5">
      <ConfirmButton v-if="fb?.page_id" small confirm-label="Remove?" @confirm="clear">Remove</ConfirmButton>
      <div class="ml-auto flex items-center gap-2">
        <button type="button" class="btn btn-sm" :disabled="busy || !fb?.page_id || !fb?.has_token" @click="test">Test</button>
        <button class="btn btn-primary btn-sm shadow-sm" :disabled="busy">
          <LoaderCircle v-if="busy" :size="13" class="motion-safe:animate-spin" />
          Save
        </button>
      </div>
    </div>
  </form>
</template>
