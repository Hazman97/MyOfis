<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { LoaderCircle } from "lucide-vue-next";
import type { Project } from "@agent-office/shared";
import ConfirmButton from "./ConfirmButton.vue";
import { api, type PublishSettings } from "../api/http.ts";
import { fmtDateTime } from "../format.ts";

/**
 * Website publishing for one project (Publisher): the site's /agent-office/publish endpoint and
 * the shared secret both sides sign with. "Test" asks the site which post types it accepts;
 * Publisher only offers projects that passed a test.
 */
const props = defineProps<{ project: Project }>();
const settings = ref<PublishSettings | null>(null);
const form = reactive({ url: "", secret: "" });
const busy = ref(false);
const msg = ref("");
const error = ref("");

onMounted(async () => {
  settings.value = (await api.publishSettings(props.project.id)).publish;
  form.url = settings.value.url;
});

async function run(fn: () => Promise<{ publish: PublishSettings }>, ok: string) {
  busy.value = true;
  error.value = msg.value = "";
  try {
    settings.value = (await fn()).publish;
    form.url = settings.value.url;
    form.secret = "";
    msg.value = ok;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const save = () => run(() => api.savePublishSettings(props.project.id, { url: form.url.trim(), ...(form.secret ? { secret: form.secret } : {}) }), "Saved. Press Test.");
const test = () => run(() => api.testPublishSettings(props.project.id), "Connected.");
const clear = () => run(() => api.savePublishSettings(props.project.id, { url: "", secret: "" }), "Website publishing removed.");
</script>

<template>
  <form class="space-y-4" @submit.prevent="save">
    <p class="text-xs leading-relaxed text-muted">
      Let <b>Publisher</b> post news, events and vlogs to {{ project.name }}'s website. A post goes live only when you approve it in Drafts.
      The website needs one endpoint (<code>/agent-office/publish</code>) that checks a shared secret. See <code>docs/website-publishing.md</code>.
    </p>

    <div v-if="settings?.info" class="rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-accent">
      Connected to <b>{{ settings.info.site_name }}</b> · post types: {{ settings.info.post_types.join(", ") }}
      <span v-if="settings.checked_at" class="text-faint"> · checked {{ fmtDateTime(settings.checked_at) }}</span>
    </div>
    <p v-else-if="settings?.url" class="rounded-md border border-signal/30 bg-signal-soft px-3 py-2 text-xs text-signal">Not tested yet: press Test so Publisher can use it.</p>

    <div>
      <label class="label" for="pub-url">Publish endpoint</label>
      <input id="pub-url" v-model="form.url" type="url" class="input font-mono" placeholder="https://smashpoint-api.example.workers.dev/agent-office/publish" />
    </div>
    <div>
      <label class="label" for="pub-secret">Shared secret</label>
      <input
        id="pub-secret"
        v-model="form.secret"
        type="password"
        autocomplete="off"
        class="input font-mono"
        :placeholder="settings?.has_secret ? `Stored ${settings.secret_hint}: leave empty to keep` : 'The same value as AGENT_OFFICE_SECRET on the website'"
      />
    </div>

    <p v-if="msg" class="rounded-md bg-accent-soft px-3 py-2 text-sm text-accent" role="status">{{ msg }}</p>
    <p v-if="error" class="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{{ error }}</p>
    <div class="flex flex-wrap gap-2 border-t border-line pt-4">
      <ConfirmButton v-if="settings?.url" small confirm-label="Remove?" @confirm="clear">Remove</ConfirmButton>
      <button type="button" class="btn btn-sm ml-auto" :disabled="busy || !settings?.url || !settings?.has_secret" @click="test">Test</button>
      <button class="btn btn-primary btn-sm" :disabled="busy">
        <LoaderCircle v-if="busy" :size="13" class="motion-safe:animate-spin" />
        Save
      </button>
    </div>
  </form>
</template>
