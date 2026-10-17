<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { GitBranch, Send } from "lucide-vue-next";
import ConfirmButton from "../components/ConfirmButton.vue";
import PageHeader from "../components/PageHeader.vue";
import SettingsTabs from "../components/SettingsTabs.vue";
import { api, type GiteaSettings, type TelegramSettings } from "../api/http.ts";

const gitea = ref<GiteaSettings | null>(null);
const telegram = ref<TelegramSettings | null>(null);
const tg = reactive({ token: "", chat_id: "", enabled: true });
const tgMsg = ref("");
const tgError = ref("");
const form = reactive({ url: "", token: "" });
const msg = ref("");
const error = ref("");

onMounted(async () => {
  const r = await api.integrations();
  gitea.value = r.gitea;
  form.url = gitea.value.url;
  telegram.value = r.telegram;
  tg.chat_id = r.telegram.chat_id;
  tg.enabled = r.telegram.enabled;
});

async function saveTelegram() {
  tgError.value = tgMsg.value = "";
  try {
    telegram.value = (await api.saveTelegram({ ...(tg.token ? { token: tg.token } : {}), chat_id: tg.chat_id.trim(), enabled: tg.enabled })).telegram;
    tg.token = "";
    tgMsg.value = "Saved.";
  } catch (e) {
    tgError.value = (e as Error).message;
  }
}

async function clearTelegram() {
  telegram.value = (await api.saveTelegram({ token: "" })).telegram;
}

async function testTelegram() {
  tgError.value = tgMsg.value = "";
  const r = await api.testTelegram();
  if (r.ok) tgMsg.value = "Sent. Check Telegram.";
  else tgError.value = `Could not send: ${r.error}`;
}

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

      <form class="card space-y-4 p-5" @submit.prevent="saveTelegram">
        <div class="flex items-center gap-2.5">
          <span class="flex size-9 items-center justify-center rounded-lg bg-info-soft text-info"><Send :size="18" /></span>
          <div>
            <h2 class="font-semibold">Telegram</h2>
            <p class="text-xs text-muted">{{ telegram?.has_token ? `Bot token stored ${telegram.token_hint}${telegram.chat_id ? "" : " · chat id missing"}` : "Not connected" }}</p>
          </div>
        </div>
        <p class="text-sm text-muted">Approve or reject from your phone with one tap; get morning reports, failures and new drafts as messages. Only your chat is ever answered.</p>
        <ol class="list-decimal space-y-1 pl-5 text-xs text-muted">
          <li>In Telegram, message <b>@BotFather</b>, send <code>/newbot</code> and copy the token.</li>
          <li>Paste the token below and save.</li>
          <li>Send <code>/id</code> to your new bot. It replies with your chat id: paste that below and save again.</li>
        </ol>
        <div>
          <label class="label" for="tg-token">Bot token</label>
          <input id="tg-token" v-model="tg.token" type="password" autocomplete="off" class="input font-mono" :placeholder="telegram?.has_token ? 'Leave empty to keep the stored token' : '123456:ABC…'" />
        </div>
        <div>
          <label class="label" for="tg-chat">Your chat id</label>
          <input id="tg-chat" v-model="tg.chat_id" inputmode="numeric" class="input font-mono" placeholder="e.g. 123456789" />
        </div>
        <label class="flex items-center gap-2 text-sm"><input v-model="tg.enabled" type="checkbox" class="accent-accent" /> Send messages</label>
        <p v-if="tgMsg" class="rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">{{ tgMsg }}</p>
        <p v-if="tgError" class="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{{ tgError }}</p>
        <div class="flex flex-wrap gap-2 border-t border-line pt-4">
          <ConfirmButton v-if="telegram?.has_token" small confirm-label="Remove token?" @confirm="clearTelegram">Remove token</ConfirmButton>
          <button type="button" class="btn btn-sm ml-auto" :disabled="!telegram?.has_token || !telegram?.chat_id" @click="testTelegram">Send test</button>
          <button class="btn btn-primary btn-sm">Save</button>
        </div>
      </form>
    </div>
  </div>
</template>
