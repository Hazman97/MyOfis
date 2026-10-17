<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { Project } from "@agent-office/shared";
import { api, type InstagramSettings, type ThreadsSettings } from "../api/http.ts";

/**
 * Instagram (through the Facebook Page connected above) and Threads (its own token).
 * Approving an Instagram or Threads caption posts it there; photos go through the
 * website's storage first, because both only accept photos by public URL.
 */
const props = defineProps<{ project: Project }>();
const ig = ref<InstagramSettings | null>(null);
const th = ref<ThreadsSettings | null>(null);
const threadsToken = ref("");
const busy = ref<string | null>(null);
const msg = ref("");
const error = ref("");

onMounted(async () => {
  [ig.value, th.value] = await Promise.all([
    api.instagramSettings(props.project.id).then((r) => r.instagram),
    api.threadsSettings(props.project.id).then((r) => r.threads),
  ]);
});

async function run(key: string, fn: () => Promise<void>, ok: string) {
  busy.value = key;
  error.value = msg.value = "";
  try {
    await fn();
    msg.value = ok;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = null;
  }
}
const connectIg = () => run("ig", async () => void (ig.value = (await api.connectInstagram(props.project.id)).instagram), "Instagram connected.");
const toggleIg = () => run("ig", async () => void (ig.value = (await api.setInstagramEnabled(props.project.id, !ig.value?.enabled)).instagram), "Saved.");
const saveThreads = () =>
  run(
    "th",
    async () => {
      th.value = (await api.saveThreads(props.project.id, threadsToken.value.trim())).threads;
      threadsToken.value = "";
    },
    "Threads connected.",
  );
const removeThreads = () => run("th", async () => void (th.value = (await api.saveThreads(props.project.id, "")).threads), "Threads removed.");
</script>

<template>
  <section class="space-y-4 border-t border-line pt-5" aria-labelledby="soc-title">
    <div>
      <h3 id="soc-title" class="text-sm font-semibold">Instagram & Threads</h3>
      <p class="mt-1 text-xs leading-relaxed text-muted">
        Approving an Instagram or Threads caption posts it there. Both take photos only from a public link, so the photo is first put on this project's website storage
        (the website endpoint above must be connected). Setup: <code>docs/facebook-page.md</code>.
      </p>
    </div>

    <div class="card space-y-2 p-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm font-medium">Instagram</span>
        <span v-if="ig?.connected" class="chip text-[11px]" :class="ig.enabled ? 'text-accent' : 'text-muted'">@{{ ig.username }} · {{ ig.enabled ? "posting on" : "posting off" }}</span>
        <span v-else class="chip text-[11px] text-muted">not connected</span>
      </div>
      <p class="text-xs text-muted">Uses the Facebook Page token. The Instagram account must be Business or Creator and linked to that Page.</p>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-sm" :disabled="busy === 'ig'" @click="connectIg">{{ ig?.connected ? "Check again" : "Connect Instagram" }}</button>
        <button v-if="ig?.connected" type="button" class="btn btn-sm" :disabled="busy === 'ig'" @click="toggleIg">{{ ig.enabled ? "Turn posting off" : "Turn posting on" }}</button>
      </div>
    </div>

    <form class="card space-y-2 p-3" @submit.prevent="saveThreads">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm font-medium">Threads</span>
        <span v-if="th?.has_token" class="chip text-[11px] text-accent">@{{ th.username }} · {{ th.token_hint }}</span>
        <span v-else class="chip text-[11px] text-muted">not connected</span>
      </div>
      <p v-if="th?.has_token" class="text-xs text-muted">
        The hub renews this token every week by itself<template v-if="th.expires_at">; it now works until {{ new Date(th.expires_at).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) }}</template>. If renewing fails, Telegram tells you.
      </p>
      <label class="label" for="th-token">Threads access token</label>
      <input id="th-token" v-model="threadsToken" type="password" autocomplete="off" class="input font-mono" :placeholder="th?.has_token ? 'Paste a new token to replace it' : 'THQ…'" />
      <div class="flex flex-wrap gap-2">
        <button v-if="th?.has_token" type="button" class="btn btn-sm btn-ghost" :disabled="busy === 'th'" @click="removeThreads">Remove</button>
        <button class="btn btn-primary btn-sm ml-auto" :disabled="busy === 'th' || !threadsToken.trim()">Save & check</button>
      </div>
    </form>

    <p v-if="msg" class="rounded-md bg-accent-soft px-3 py-2 text-sm text-accent" role="status">{{ msg }}</p>
    <p v-if="error" class="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{{ error }}</p>
  </section>
</template>
