<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { GitBranch, Send } from "lucide-vue-next";
import ConfirmButton from "../components/ConfirmButton.vue";
import PageHeader from "../components/PageHeader.vue";
import SettingsTabs from "../components/SettingsTabs.vue";
import { api, type GiteaSettings } from "../api/http.ts";

const gitea = ref<GiteaSettings | null>(null);
const form = reactive({ url: "", token: "" });
const msg = ref("");
const error = ref("");

onMounted(async () => {
  gitea.value = (await api.integrations()).gitea;
  form.url = gitea.value.url;
});

async function save() {
  error.value = msg.value = "";
  try {
    // Empty token field = keep the stored one.
    gitea.value = (await api.saveGitea(form.token ? { url: form.url, token: form.token } : { url: form.url })).gitea;
    form.token = "";
    msg.value = "Saved.";
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function clearToken() {
  gitea.value = (await api.saveGitea({ url: form.url, token: "" })).gitea;
}

async function test() {
  error.value = msg.value = "";
  const r = await api.testGitea();
  if (r.ok) msg.value = `Connected as ${r.login ?? "unknown user"}.`;
  else error.value = `Connection failed: ${r.error}`;
}
</script>

<template>
  <div>
    <PageHeader sign="System" title="Settings" />
    <SettingsTabs />

    <div class="mt-5 grid max-w-4xl gap-4 lg:grid-cols-2">
      <form class="card space-y-4 p-5" @submit.prevent="save">
        <div class="flex items-center gap-2.5">
          <span class="flex size-9 items-center justify-center rounded-lg bg-accent-soft text-accent"><GitBranch :size="18" /></span>
          <div>
            <h2 class="font-semibold">Gitea</h2>
            <p class="text-xs text-muted">{{ gitea?.has_token ? `Token stored ${gitea.token_hint}` : "Not connected" }}</p>
          </div>
        </div>
        <p class="text-sm text-muted">
          Coder uses this to clone, push branches and open pull requests. In Gitea go to Settings → Applications and create a token with repository read/write and
          issue access. It is encrypted here and only sent to runs that need it.
        </p>
        <div>
          <label class="label" for="gt-url">Gitea address</label>
          <input id="gt-url" v-model="form.url" type="url" class="input font-mono" placeholder="https://git.example.com" />
        </div>
        <div>
          <label class="label" for="gt-token">Access token</label>
          <input
            id="gt-token"
            v-model="form.token"
            type="password"
            autocomplete="off"
            class="input font-mono"
            :placeholder="gitea?.has_token ? 'Leave empty to keep the stored token' : 'Paste token'"
          />
        </div>
        <p v-if="msg" class="rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">{{ msg }}</p>
        <p v-if="error" class="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{{ error }}</p>
        <div class="flex flex-wrap gap-2 border-t border-line pt-4">
          <ConfirmButton v-if="gitea?.has_token" small confirm-label="Remove token?" @confirm="clearToken">Remove token</ConfirmButton>
          <button type="button" class="btn btn-sm ml-auto" :disabled="!gitea?.has_token" @click="test">Test connection</button>
          <button class="btn btn-primary btn-sm">Save</button>
        </div>
      </form>

      <section class="card space-y-3 p-5">
        <div class="flex items-center gap-2.5">
          <span class="flex size-9 items-center justify-center rounded-lg bg-surface-2 text-faint"><Send :size="18" /></span>
          <div>
            <h2 class="font-semibold">Telegram</h2>
            <p class="text-xs text-muted">Coming in Phase 4</p>
          </div>
        </div>
        <p class="text-sm text-muted">Approve or reject from your phone with one tap, and get Pak Guard's morning report as a message.</p>
      </section>
    </div>
  </div>
</template>
