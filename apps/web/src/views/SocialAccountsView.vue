<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { AlertTriangle, LoaderCircle, Plus, RefreshCw, Trash2 } from "lucide-vue-next";
import ConfirmButton from "../components/ConfirmButton.vue";
import PageHeader from "../components/PageHeader.vue";
import SettingsTabs from "../components/SettingsTabs.vue";
import { api, type ZernioConnection } from "../api/http.ts";
import { fmtDateTime } from "../format.ts";

/**
 * Settings → Social accounts (owner request 2026-10-20): connect Zernio once (or several keys) and
 * use every TikTok account it manages. Name the accounts, switch them on/off; agents, schedules and
 * drafts then pick one. Keys stay on the hub (encrypted).
 */
const connections = ref<ZernioConnection[]>([]);
const error = ref("");
const busy = ref<string | null>(null);
const form = reactive({ label: "", api_key: "" });
const adding = ref(false);

async function load() {
  connections.value = (await api.socialAccounts()).connections;
}
onMounted(() => load().catch((e) => (error.value = (e as Error).message)));

async function run(key: string, fn: () => Promise<unknown>) {
  busy.value = key;
  error.value = "";
  try {
    await fn();
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = null;
  }
}

const add = () =>
  run("add", async () => {
    await api.addZernio(form.label.trim(), form.api_key.trim());
    form.label = "";
    form.api_key = "";
    adding.value = false;
  });
const refresh = (c: ZernioConnection) => run(`refresh:${c.id}`, () => api.refreshZernio(c.id));
const remove = (c: ZernioConnection) => run(`remove:${c.id}`, () => api.removeZernio(c.id));
const rename = (c: ZernioConnection, accId: string, label: string) => run(`acc:${accId}`, () => api.patchZernio(c.id, { accounts: { [accId]: { label: label.trim() } } }));
const toggle = (c: ZernioConnection, accId: string, enabled: boolean) => run(`acc:${accId}`, () => api.patchZernio(c.id, { accounts: { [accId]: { enabled } } }));
</script>

<template>
  <div>
    <PageHeader sign="System" title="Settings" />
    <SettingsTabs />

    <div class="mt-5 max-w-3xl space-y-4">
      <p class="text-sm text-muted">
        TikTok accounts your agents post to, through <a href="https://zernio.com" target="_blank" rel="noopener" class="text-accent hover:underline">Zernio</a>.
        Connect your TikTok accounts in Zernio first, then paste its API key here. Each agent can have a default account (Agents), each schedule can pick one (Schedules), and you can change it on a draft before approving.
      </p>

      <div v-if="error" class="rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger" role="alert">{{ error }}</div>

      <section v-for="c in connections" :key="c.id" class="card">
        <div class="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <div class="min-w-0 flex-1">
            <div class="font-semibold text-fg">{{ c.label }}</div>
            <div class="text-xs text-muted font-mono">Zernio key {{ c.key_hint }} · checked {{ fmtDateTime(c.checked_at) }}</div>
          </div>
          <button class="btn btn-sm min-h-10 sm:min-h-8 gap-1.5" :disabled="busy === `refresh:${c.id}`" title="Ask Zernio for new or changed accounts" @click="refresh(c)">
            <LoaderCircle v-if="busy === `refresh:${c.id}`" :size="13" class="motion-safe:animate-spin" />
            <RefreshCw v-else :size="13" /> Refresh
          </button>
          <ConfirmButton small class="min-h-10 sm:min-h-8" confirm-label="Remove this key?" @confirm="remove(c)"><Trash2 :size="13" /> Remove</ConfirmButton>
        </div>
        <ul class="divide-y divide-line">
          <li v-for="a in c.accounts" :key="a.id" class="flex flex-wrap items-center gap-3 px-4 py-3" :class="!a.enabled && 'opacity-60'">
            <div class="min-w-0 flex-1 basis-56">
              <input
                :value="a.label"
                class="input h-9 text-sm font-medium"
                maxlength="60"
                :aria-label="`Name for @${a.username}`"
                @change="rename(c, a.id, ($event.target as HTMLInputElement).value)"
              />
              <div class="mt-1 text-xs text-muted">
                TikTok @{{ a.username }}<span v-if="a.followers !== null"> · {{ a.followers.toLocaleString() }} followers</span>
              </div>
              <div v-if="a.needs_reconnection" class="mt-1 flex items-center gap-1 text-xs text-signal"><AlertTriangle :size="12" /> Needs reconnecting in Zernio</div>
            </div>
            <label class="flex items-center gap-2 text-sm min-h-10">
              <input type="checkbox" class="accent-accent" :checked="a.enabled" :disabled="busy === `acc:${a.id}`" @change="toggle(c, a.id, ($event.target as HTMLInputElement).checked)" />
              Agents may post here
            </label>
          </li>
          <li v-if="!c.accounts.length" class="px-4 py-3 text-sm text-muted">No TikTok accounts in this Zernio workspace yet. Connect one in Zernio, then press Refresh.</li>
        </ul>
      </section>

      <div v-if="!connections.length && !adding" class="card border-dashed p-8 text-center text-sm text-muted">No social accounts yet.</div>

      <form v-if="adding" class="card space-y-3 p-4" @submit.prevent="add">
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="label" for="zr-label">Name</label>
            <input id="zr-label" v-model="form.label" class="input" required maxlength="60" placeholder="My Zernio" />
          </div>
          <div>
            <label class="label" for="zr-key">Zernio API key</label>
            <input id="zr-key" v-model="form.api_key" class="input font-mono" type="password" autocomplete="off" required minlength="8" placeholder="sk_…" />
          </div>
        </div>
        <p class="text-xs text-muted">Zernio → Settings → API keys. The key is encrypted on the hub and never shown again.</p>
        <div class="flex gap-2">
          <button class="btn btn-primary min-h-10" :disabled="busy === 'add'">
            <LoaderCircle v-if="busy === 'add'" :size="14" class="motion-safe:animate-spin" /> Connect and list accounts
          </button>
          <button type="button" class="btn min-h-10" @click="adding = false">Cancel</button>
        </div>
      </form>
      <button v-else class="btn min-h-10 gap-1.5" @click="adding = true"><Plus :size="14" /> Connect a Zernio key</button>
    </div>
  </div>
</template>
