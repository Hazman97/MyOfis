<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { Archive, GitBranch, Globe, LoaderCircle, Send, Volume2 } from "lucide-vue-next";
import ConfirmButton from "../components/ConfirmButton.vue";
import PageHeader from "../components/PageHeader.vue";
import SettingsTabs from "../components/SettingsTabs.vue";
import { api, type BackupInfo, type GiteaSettings, type TelegramSettings, type TtsSettings, type WebSearchProvider, type WebSearchSettings } from "../api/http.ts";
import { fmtDateTime } from "../format.ts";

const gitea = ref<GiteaSettings | null>(null);
const telegram = ref<TelegramSettings | null>(null);
const tts = ref<TtsSettings | null>(null);
const assistant = ref<{ enabled: boolean; tokens: string[] } | null>(null);
const tg = reactive({ token: "", chat_id: "", enabled: true });
const tgMsg = ref("");
const tgError = ref("");
const form = reactive({ url: "", token: "" });
const ttsForm = reactive({ base_url: "", api_key: "", voice: "af_sarah", speed: 1.0 });
const ttsMsg = ref("");
const ttsError = ref("");
const ttsTesting = ref(false);
const msg = ref("");
const error = ref("");

onMounted(async () => {
  const r = await api.integrations();
  gitea.value = r.gitea;
  form.url = gitea.value.url;
  telegram.value = r.telegram;
  tg.chat_id = r.telegram.chat_id;
  tg.enabled = r.telegram.enabled;
  if (r.tts) {
    tts.value = r.tts;
    ttsForm.base_url = r.tts.base_url;
    ttsForm.voice = r.tts.voice;
    ttsForm.speed = r.tts.speed;
  }
  fillWebSearch(r.web_search);
  assistant.value = r.assistant ?? null;
  await loadBackups();
});

async function saveTts() {
  ttsError.value = ttsMsg.value = "";
  try {
    const res = await api.saveTts({
      base_url: ttsForm.base_url.trim(),
      voice: ttsForm.voice.trim(),
      speed: Number(ttsForm.speed) || 1.0,
      ...(ttsForm.api_key ? { api_key: ttsForm.api_key } : {}),
    });
    tts.value = res.tts;
    ttsForm.api_key = "";
    ttsMsg.value = "Saved.";
  } catch (e) {
    ttsError.value = (e as Error).message;
  }
}

async function clearTtsKey() {
  try {
    const res = await api.saveTts({ base_url: ttsForm.base_url.trim(), api_key: "" });
    tts.value = res.tts;
    ttsForm.api_key = "";
    ttsMsg.value = "Key removed.";
  } catch (e) {
    ttsError.value = (e as Error).message;
  }
}

async function testTts() {
  ttsError.value = ttsMsg.value = "";
  ttsTesting.value = true;
  try {
    const res = await api.testTts({ voice: ttsForm.voice.trim() });
    if (res.ok) {
      ttsMsg.value = `Suara berjaya diuji! (${res.bytes ?? 0} bait, ~${res.duration_estimate_s ?? 0}s).`;
    } else {
      ttsError.value = `Ujian gagal: ${res.error}`;
    }
  } catch (e) {
    ttsError.value = (e as Error).message;
  } finally {
    ttsTesting.value = false;
  }
}

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

// Web search for the Researcher: DuckDuckGo works with no setup; SearXNG and keys are fallbacks
const webSearch = ref<WebSearchSettings | null>(null);
const ws = reactive({ provider: "duckduckgo" as WebSearchProvider, searxng_url: "", key_provider: "tavily" as "tavily" | "brave", api_key: "" });
const wsMsg = ref("");
const wsError = ref("");
const PROVIDER_LABEL: Record<WebSearchProvider, string> = { duckduckgo: "DuckDuckGo", searxng: "SearXNG", tavily: "Tavily", brave: "Brave" };
function fillWebSearch(s: WebSearchSettings) {
  webSearch.value = s;
  ws.provider = s.provider;
  ws.searxng_url = s.searxng_url;
  ws.key_provider = s.key_provider ?? "tavily";
}
async function saveWebSearch() {
  wsError.value = wsMsg.value = "";
  try {
    const body = { provider: ws.provider, searxng_url: ws.searxng_url.trim(), key_provider: ws.key_provider, ...(ws.api_key ? { api_key: ws.api_key } : {}) };
    fillWebSearch((await api.saveWebSearch(body)).web_search);
    ws.api_key = "";
    wsMsg.value = "Saved.";
  } catch (e) {
    wsError.value = (e as Error).message;
  }
}
async function clearWebSearch() {
  fillWebSearch((await api.saveWebSearch({ provider: ws.provider === "tavily" || ws.provider === "brave" ? "duckduckgo" : ws.provider, api_key: "" })).web_search);
}
async function testWebSearch() {
  wsError.value = wsMsg.value = "";
  try {
    const r = await api.testWebSearch();
    if (r.ok) wsMsg.value = `Works via ${PROVIDER_LABEL[r.provider ?? "duckduckgo"]}: ${r.results?.length ?? 0} results (first: ${r.results?.[0]?.title ?? "none"}).`;
    else wsError.value = `Search failed: ${r.error}`;
  } catch (e) {
    wsError.value = (e as Error).message;
  }
}

// Nightly backups
const backups = ref<BackupInfo[]>([]);
const backupDir = ref("");
const backingUp = ref(false);
const backupError = ref("");
async function loadBackups() {
  const r = await api.backups();
  backups.value = r.backups;
  backupDir.value = r.dir;
}
async function backupNow() {
  backupError.value = "";
  backingUp.value = true;
  try {
    await api.backupNow();
    await loadBackups();
  } catch (e) {
    backupError.value = (e as Error).message;
  } finally {
    backingUp.value = false;
  }
}
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

      <form class="card space-y-4 p-5" @submit.prevent="saveWebSearch">
        <div class="flex items-center gap-2.5">
          <span class="flex size-9 items-center justify-center rounded-lg bg-accent-soft text-accent"><Globe :size="18" /></span>
          <div>
            <h2 class="font-semibold">Web search</h2>
            <div class="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted">
              <span class="text-faint text-[10px] uppercase tracking-wider font-medium">Order:</span>
              <template v-for="(p, i) in (webSearch?.order ?? ['duckduckgo'])" :key="p">
                <span v-if="i > 0" class="text-faint text-[10px]">→</span>
                <span class="chip px-1.5 py-0 text-[10px] font-medium bg-surface-2/60 text-muted border-line/60">
                  {{ PROVIDER_LABEL[p] }}
                </span>
              </template>
            </div>
          </div>
        </div>
        <p class="text-sm text-muted">
          For Researcher (and any agent with <code>web_search</code>). DuckDuckGo works with no setup and no monthly limit; if it is busy or asks for a CAPTCHA, the hub tries your SearXNG, then a Tavily or Brave key if you add one. Reading a page (<code>web_fetch</code>) never needs any of this.
        </p>
        <div>
          <label class="label" for="ws-provider">Try first</label>
          <select id="ws-provider" v-model="ws.provider" class="input">
            <option value="duckduckgo">DuckDuckGo (free, no setup)</option>
            <option value="searxng">SearXNG (your own server)</option>
            <option value="tavily">Tavily (API key)</option>
            <option value="brave">Brave (API key)</option>
          </select>
        </div>

        <div class="space-y-3 pt-1 border-t border-line/60">
          <div class="sign text-[10px] text-faint tracking-wider">Fallbacks (optional)</div>
          <div>
            <label class="label" for="ws-searxng">SearXNG address (optional fallback)</label>
            <input id="ws-searxng" v-model="ws.searxng_url" type="url" class="input font-mono" placeholder="http://mintserver:8888" />
            <p class="mt-1 text-xs text-muted">Its settings.yml needs <code>json</code> in <code>search.formats</code>. See docs/searxng.md.</p>
          </div>
          <div>
            <div class="grid gap-2 sm:grid-cols-[9rem_1fr]">
              <div>
                <label class="label" for="ws-key-provider">API key for</label>
                <select id="ws-key-provider" v-model="ws.key_provider" class="input">
                  <option value="tavily">Tavily</option>
                  <option value="brave">Brave</option>
                </select>
              </div>
              <div>
                <label class="label" for="ws-key">API key (optional)</label>
                <input
                  id="ws-key"
                  v-model="ws.api_key"
                  type="password"
                  autocomplete="off"
                  class="input font-mono"
                  :placeholder="webSearch?.has_key ? `${webSearch.key_provider} key stored ${webSearch.key_hint}: leave empty to keep` : 'Paste API key'"
                />
              </div>
            </div>
            <p class="mt-1.5 text-xs text-muted">
              {{ ws.key_provider === 'tavily' ? 'Tavily: app.tavily.com (1,000 free searches a month, no card).' : 'Brave: api-dashboard.search.brave.com (needs a card).' }}
            </p>
          </div>
        </div>

        <p v-if="wsMsg" class="rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">{{ wsMsg }}</p>
        <p v-if="wsError" class="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{{ wsError }}</p>
        <div class="flex flex-wrap gap-2 border-t border-line pt-4">
          <ConfirmButton v-if="webSearch?.has_key" small confirm-label="Remove key?" @confirm="clearWebSearch">Remove key</ConfirmButton>
          <button type="button" class="btn btn-sm ml-auto" @click="testWebSearch">Test search</button>
          <button class="btn btn-primary btn-sm">Save</button>
        </div>
      </form>

      <form class="card space-y-4 p-5" @submit.prevent="saveTts">
        <div class="flex items-center gap-2.5">
          <span class="flex size-9 items-center justify-center rounded-lg bg-accent-soft text-accent"><Volume2 :size="18" /></span>
          <div>
            <h2 class="font-semibold">Text-to-Speech (TTS)</h2>
            <p class="text-xs text-muted">{{ tts?.has_key ? `Key stored ${tts.key_hint} · ${tts.base_url || 'default'}` : (tts?.base_url ? tts.base_url : "Not configured") }}</p>
          </div>
        </div>
        <p class="text-sm text-muted">
          Used by Cikgu Tech (<code>explainer_render</code>) for Malay tech explainer voice-overs. Supports OpenAI-compatible speech endpoints (e.g. CanopyAI TTS on GPU 3). The key is encrypted on the hub and never sent to browsers.
        </p>
        <div>
          <label class="label" for="tts-url">Endpoint base URL</label>
          <input id="tts-url" v-model="ttsForm.base_url" type="url" class="input font-mono" placeholder="https://canopy-ai.example.com" />
        </div>
        <div>
          <label class="label" for="tts-key">API key</label>
          <input
            id="tts-key"
            v-model="ttsForm.api_key"
            type="password"
            autocomplete="off"
            class="input font-mono"
            :placeholder="tts?.has_key ? `Key stored ${tts.key_hint}: leave empty to keep` : 'Bearer key (optional)'"
          />
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="label" for="tts-voice">Voice model / ID</label>
            <input id="tts-voice" v-model="ttsForm.voice" class="input font-mono" placeholder="af_sarah" />
          </div>
          <div>
            <label class="label" for="tts-speed">Speed ({{ ttsForm.speed }}x)</label>
            <input id="tts-speed" v-model.number="ttsForm.speed" type="range" min="0.5" max="2.0" step="0.1" class="w-full accent-accent mt-2" />
          </div>
        </div>
        <p v-if="ttsMsg" class="rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">{{ ttsMsg }}</p>
        <p v-if="ttsError" class="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{{ ttsError }}</p>
        <div class="flex flex-wrap gap-2 border-t border-line pt-4">
          <ConfirmButton v-if="tts?.has_key" small confirm-label="Remove key?" @confirm="clearTtsKey">Remove key</ConfirmButton>
          <button type="button" class="btn btn-sm ml-auto inline-flex items-center gap-1.5" :disabled="ttsTesting || !ttsForm.base_url" @click="testTts">
            <LoaderCircle v-if="ttsTesting" :size="13" class="animate-spin text-accent" />
            <span>{{ ttsTesting ? "Testing…" : "Uji Suara" }}</span>
          </button>
          <button class="btn btn-primary btn-sm">Save</button>
        </div>
      </form>

      <section class="card space-y-4 p-5" aria-labelledby="bk-title">
        <div class="flex items-center gap-2.5">
          <span class="flex size-9 items-center justify-center rounded-lg bg-info-soft text-info"><Archive :size="18" /></span>
          <div>
            <h2 id="bk-title" class="font-semibold">Backups</h2>
            <p class="text-xs text-muted">{{ backups.length ? `Last: ${backups[0]!.date}` : "None yet" }}</p>
          </div>
        </div>
        <p class="text-sm text-muted leading-relaxed">
          Every night after 3 am the hub copies the database, project briefs and skills into <code class="break-all font-mono text-xs">{{ backupDir }}</code> and keeps the last 14 days. Photos and videos are mirrored once into its <code class="font-mono text-xs">files/</code> folder.
          To restore: stop the hub, copy <code>agent-office.db</code> over <code>data/agent-office.db</code> (and the folders back), start it again.
        </p>
        <div v-if="backups.length" class="overflow-hidden rounded-xl border border-line bg-surface-2/30">
          <div class="flex items-center justify-between border-b border-line bg-surface-2/60 px-3.5 py-1.5 text-[11px] font-semibold text-muted select-none">
            <span>Date</span>
            <span>Size & Time</span>
          </div>
          <ul class="divide-y divide-line text-xs">
            <li v-for="b in backups.slice(0, 5)" :key="b.date" class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3.5 py-2 hover:bg-surface-2/50 transition-colors">
              <span class="font-mono font-medium text-fg">{{ b.date }}</span>
              <span class="text-right text-muted text-[11px] sm:font-mono">{{ mb(b.size_bytes) }} · {{ fmtDateTime(b.created_at) }}</span>
            </li>
          </ul>
        </div>
        <p v-if="backupError" class="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{{ backupError }}</p>
        <div class="flex flex-wrap gap-2 border-t border-line pt-4">
          <button
            type="button"
            class="btn btn-sm ml-auto inline-flex items-center gap-1.5"
            :disabled="backingUp"
            @click="backupNow"
          >
            <LoaderCircle v-if="backingUp" :size="13" class="animate-spin text-accent" />
            <span>{{ backingUp ? "Backing up…" : "Back up now" }}</span>
          </button>
        </div>
        <div class="border-t border-line/60 pt-3 text-xs text-muted">
          <span v-if="assistant?.enabled" class="font-mono text-fg">Assistant access: on (token {{ assistant.tokens.join(", ") }})</span>
          <span v-else>Assistant access: off</span>
        </div>
      </section>
    </div>
  </div>
</template>
