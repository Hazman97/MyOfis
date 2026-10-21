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
  <div class="mx-auto max-w-4xl pb-10">
    <PageHeader sign="System" title="Settings" />
    <SettingsTabs class="mb-5" />

    <div class="space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-fg">Social accounts</h2>
          <p class="text-xs text-muted mt-0.5 leading-relaxed">
            TikTok accounts your agents post to, through <a href="https://zernio.com" target="_blank" rel="noopener" class="text-accent hover:underline">Zernio</a>.
            Connect TikTok accounts in Zernio first, then paste its key here.
          </p>
        </div>
        <button v-if="!adding" class="btn btn-primary btn-sm min-h-10 self-start sm:self-auto gap-1.5" @click="adding = true">
          <Plus :size="14" /> Connect a Zernio key
        </button>
      </div>

      <div v-if="error" class="rounded-xl border border-danger/30 bg-danger-soft p-3.5 text-sm text-danger" role="alert">
        {{ error }}
      </div>

      <!-- Add key form card -->
      <form v-if="adding" class="card space-y-4 p-5" @submit.prevent="add">
        <div class="flex items-center justify-between border-b border-line pb-3">
          <span class="font-semibold text-sm text-fg">Connect a Zernio API key</span>
          <button type="button" class="btn btn-ghost btn-sm" @click="adding = false">Cancel</button>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="zr-label">Connection label</label>
            <input id="zr-label" v-model="form.label" class="input text-sm" required maxlength="60" placeholder="e.g. My Zernio" />
          </div>
          <div>
            <label class="label" for="zr-key">Zernio API key</label>
            <input id="zr-key" v-model="form.api_key" class="input font-mono text-sm" type="password" autocomplete="off" required minlength="8" placeholder="sk_…" />
          </div>
        </div>
        <p class="text-xs text-muted">Found in Zernio → Settings → API keys. The key is encrypted on the hub and never shown again.</p>
        <div class="flex gap-2 pt-1">
          <button class="btn btn-primary min-h-10 px-4" :disabled="busy === 'add'">
            <LoaderCircle v-if="busy === 'add'" :size="14" class="motion-safe:animate-spin" /> Connect and list accounts
          </button>
          <button type="button" class="btn min-h-10" @click="adding = false">Cancel</button>
        </div>
      </form>

      <!-- Connections list -->
      <div v-if="connections.length" class="space-y-4">
        <section v-for="c in connections" :key="c.id" class="card overflow-hidden">
          <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-2/30 px-4 py-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-semibold text-sm text-fg truncate">{{ c.label }}</span>
                <span class="chip chip-sm font-mono text-[10px] text-muted">key {{ c.key_hint }}</span>
              </div>
              <div class="mt-0.5 text-xs text-muted">
                Checked {{ fmtDateTime(c.checked_at) }}
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button
                class="btn btn-sm min-h-9 gap-1.5"
                :disabled="busy === `refresh:${c.id}`"
                title="Ask Zernio for new or changed accounts"
                @click="refresh(c)"
              >
                <LoaderCircle v-if="busy === `refresh:${c.id}`" :size="13" class="motion-safe:animate-spin" />
                <RefreshCw v-else :size="13" />
                <span>Refresh</span>
              </button>
              <ConfirmButton small class="min-h-9" confirm-label="Remove key?" @confirm="remove(c)">
                <Trash2 :size="13" /> Remove
              </ConfirmButton>
            </div>
          </div>

          <ul class="divide-y divide-line">
            <li
              v-for="a in c.accounts"
              :key="a.id"
              class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 transition-colors"
              :class="!a.enabled ? 'opacity-60 bg-surface/50' : 'bg-surface'"
            >
              <div class="min-w-0 flex-1 space-y-1.5">
                <div class="flex flex-wrap items-center gap-2">
                  <input
                    :value="a.label"
                    class="input h-9 text-sm font-medium w-full sm:max-w-xs"
                    maxlength="60"
                    :aria-label="`Name for @${a.username}`"
                    @change="rename(c, a.id, ($event.target as HTMLInputElement).value)"
                  />
                  <span v-if="a.needs_reconnection" class="chip chip-sm bg-signal-soft text-signal border border-signal/30 gap-1 text-[11px] font-medium">
                    <AlertTriangle :size="12" /> Needs reconnecting in Zernio
                  </span>
                </div>
                <div class="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span class="font-medium text-fg">TikTok @{{ a.username }}</span>
                  <span v-if="a.followers !== null" class="text-faint">·</span>
                  <span v-if="a.followers !== null">{{ a.followers.toLocaleString() }} followers</span>
                </div>
              </div>

              <div class="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-line/60 shrink-0">
                <span class="text-xs font-medium text-muted sm:text-right">Agents may post</span>
                <label class="relative inline-flex items-center cursor-pointer select-none" :aria-label="`Enable @${a.username}`">
                  <input
                    type="checkbox"
                    class="sr-only peer"
                    :checked="a.enabled"
                    :disabled="busy === `acc:${a.id}`"
                    @change="toggle(c, a.id, ($event.target as HTMLInputElement).checked)"
                  />
                  <div class="h-5 w-9 rounded-full bg-surface-2 border border-line peer-checked:bg-accent peer-checked:border-accent transition-colors duration-200" />
                  <div class="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-fg peer-checked:bg-accent-ink peer-checked:translate-x-4 transition-transform duration-200 shadow-sm" />
                </label>
              </div>
            </li>
            <li v-if="!c.accounts.length" class="p-6 text-center text-xs text-muted">
              No TikTok accounts in this Zernio workspace yet. Connect one in Zernio, then press Refresh.
            </li>
          </ul>
        </section>
      </div>

      <!-- Empty State explaining Zernio in two lines -->
      <div v-else-if="!adding" class="card border-dashed p-8 text-center space-y-2">
        <div class="font-semibold text-fg text-sm">No social accounts connected yet</div>
        <p class="text-xs text-muted max-w-md mx-auto leading-relaxed">
          Connect Zernio once to manage all your TikTok accounts in one place.<br class="hidden sm:inline" />
          Agents, schedules, and drafts can then post directly to your selected accounts.
        </p>
      </div>
    </div>
  </div>
</template>
