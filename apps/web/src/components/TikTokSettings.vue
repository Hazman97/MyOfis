<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { AlertTriangle, Check, KeyRound, LoaderCircle, Video } from "lucide-vue-next";
import type { Project } from "@agent-office/shared";
import ConfirmButton from "./ConfirmButton.vue";
import { api, type TikTokSettings } from "../api/http.ts";

const props = defineProps<{ project: Project }>();
const tk = ref<TikTokSettings | null>(null);
const apiKey = ref("");
const replacingKey = ref(false);
const busy = ref<string | null>(null);
const msg = ref("");
const error = ref("");

const status = computed(() => {
  if (!tk.value?.has_key) {
    return { text: "Not set", cls: "text-muted" };
  }
  if (!tk.value?.account_id) {
    return { text: "Choose an account", cls: "border-signal/40 bg-signal-soft/40 text-signal font-medium" };
  }
  return { text: "Ready", cls: "border-accent/40 bg-accent/10 text-accent font-medium" };
});

onMounted(async () => {
  try {
    const res = await api.tiktokSettings(props.project.id);
    tk.value = res.tiktok;
  } catch (e) {
    error.value = (e as Error).message || "TikTok settings not available";
  }
});

async function run(action: string, fn: () => Promise<void>, okMessage: string) {
  busy.value = action;
  error.value = msg.value = "";
  try {
    await fn();
    msg.value = okMessage;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = null;
  }
}

async function saveKey() {
  const keyToSave = apiKey.value.trim();
  if (!keyToSave) return;
  await run(
    "key",
    async () => {
      const res = await api.saveTikTok(props.project.id, { api_key: keyToSave });
      tk.value = res.tiktok;
      apiKey.value = "";
      replacingKey.value = false;
    },
    "API key saved. Accounts refreshed from Zernio.",
  );
}

async function removeKey() {
  await run(
    "key",
    async () => {
      const res = await api.saveTikTok(props.project.id, { api_key: "" });
      tk.value = res.tiktok;
      apiKey.value = "";
      replacingKey.value = false;
    },
    "Zernio API key removed.",
  );
}

async function selectAccount(accountId: string) {
  await run(
    "account",
    async () => {
      const res = await api.saveTikTok(props.project.id, { account_id: accountId });
      tk.value = res.tiktok;
    },
    "TikTok account selected.",
  );
}

async function testConnection() {
  await run(
    "test",
    async () => {
      const res = await api.testTikTok(props.project.id);
      tk.value = res.tiktok;
    },
    `Connected as @${tk.value?.username || tk.value?.accounts.find((a) => a.id === tk.value?.account_id)?.username || "account"}`,
  );
}
</script>

<template>
  <div class="card p-4 space-y-4" aria-labelledby="tiktok-title">
    <!-- Header -->
    <div class="flex items-center justify-between gap-2 border-b border-line pb-3">
      <div class="flex items-center gap-2">
        <Video :size="16" class="text-accent" />
        <h3 id="tiktok-title" class="font-semibold text-sm text-fg">TikTok (via Zernio)</h3>
      </div>
      <span class="chip text-[11px]" :class="status.cls">{{ status.text }}</span>
    </div>

    <!-- Description -->
    <p class="text-xs leading-relaxed text-muted">
      Post approved TikTok videos through your Zernio account. Get the API key in <b>Zernio → Settings → API keys</b>.
    </p>

    <!-- Connected confirmation banner if account is chosen and ready -->
    <div v-if="tk?.has_key && tk?.account_id && tk?.username" class="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-accent">
      <Check :size="14" class="shrink-0" />
      <span class="min-w-0 flex-1">
        Connected to <b>@{{ tk.username }}</b>
        <span v-if="tk.display_name" class="text-accent/80 font-normal"> ({{ tk.display_name }})</span>
      </span>
    </div>

    <!-- API Key Section -->
    <div class="space-y-2">
      <label class="label" for="tk-api-key">Zernio API key</label>

      <!-- Key already saved -->
      <div v-if="tk?.has_key && !replacingKey" class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface-2/60 p-2.5">
        <div class="flex items-center gap-2 min-w-0">
          <KeyRound :size="14" class="text-accent shrink-0" />
          <span class="font-mono text-xs text-fg truncate">
            {{ tk.key_hint || "Key configured" }}
          </span>
        </div>
        <div class="flex items-center gap-2 ml-auto">
          <button
            type="button"
            class="btn btn-sm min-h-10 sm:min-h-0"
            :disabled="busy !== null"
            @click="replacingKey = true; apiKey = ''"
          >
            Replace
          </button>
          <ConfirmButton
            small
            confirm-label="Remove?"
            class="min-h-10 sm:min-h-0"
            @confirm="removeKey"
          >
            Remove
          </ConfirmButton>
        </div>
      </div>

      <!-- Key input (either no key yet or user clicked Replace) -->
      <form v-else class="space-y-2" @submit.prevent="saveKey">
        <div class="flex flex-col sm:flex-row gap-2">
          <input
            id="tk-api-key"
            v-model="apiKey"
            type="password"
            autocomplete="off"
            class="input font-mono text-xs flex-1 min-h-10"
            :placeholder="tk?.has_key ? 'Paste new Zernio API key' : 'zer_live_...'"
          />
          <div class="flex items-center gap-2">
            <button
              v-if="replacingKey"
              type="button"
              class="btn btn-ghost btn-sm min-h-10 sm:min-h-0 flex-1 sm:flex-initial"
              :disabled="busy !== null"
              @click="replacingKey = false; apiKey = ''"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="btn btn-primary btn-sm shadow-sm min-h-10 sm:min-h-0 flex-1 sm:flex-initial"
              :disabled="busy !== null || !apiKey.trim()"
            >
              <LoaderCircle v-if="busy === 'key'" :size="13" class="motion-safe:animate-spin" />
              Save
            </button>
          </div>
        </div>
        <p class="text-[11px] text-faint">
          The API key is encrypted and stored safely on the hub. It is never displayed again.
        </p>
      </form>
    </div>

    <!-- Accounts List (after key is saved) -->
    <div v-if="tk?.has_key" class="space-y-2.5 pt-1">
      <div class="flex items-center justify-between">
        <span class="label mb-0!">Connected TikTok Accounts</span>
        <span v-if="tk.accounts.length" class="text-[11px] font-mono text-faint">
          {{ tk.accounts.length }} {{ tk.accounts.length === 1 ? "account" : "accounts" }}
        </span>
      </div>

      <!-- List of accounts as radio cards -->
      <div v-if="tk.accounts.length" class="grid gap-2" role="radiogroup" aria-label="TikTok accounts">
        <label
          v-for="acc in tk.accounts"
          :key="acc.id"
          class="flex cursor-pointer items-start gap-3 rounded-xl border p-3 min-h-11 transition-all select-none"
          :class="[
            acc.needs_reconnection
              ? 'border-danger/50 bg-danger-soft/20 text-danger'
              : tk.account_id === acc.id
                ? 'border-accent bg-accent/10 shadow-sm'
                : 'border-line bg-surface hover:bg-surface-2',
          ]"
        >
          <input
            type="radio"
            name="tiktok_account"
            :value="acc.id"
            :checked="tk.account_id === acc.id"
            :disabled="busy !== null"
            class="mt-1 accent-accent size-4 shrink-0"
            @change="selectAccount(acc.id)"
          />

          <!-- Avatar initial -->
          <div
            class="size-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0"
            :class="[
              acc.needs_reconnection
                ? 'bg-danger/20 text-danger'
                : tk.account_id === acc.id
                  ? 'bg-accent text-accent-ink'
                  : 'bg-surface-2 text-fg border border-line',
            ]"
          >
            {{ (acc.display_name || acc.username || "?").charAt(0).toUpperCase() }}
          </div>

          <!-- Account info -->
          <div class="min-w-0 flex-1 space-y-0.5">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="font-semibold text-xs text-fg">@{{ acc.username }}</span>
              <span v-if="acc.display_name" class="text-xs text-muted">· {{ acc.display_name }}</span>
            </div>

            <div class="flex flex-wrap items-center gap-2 text-[11px] text-faint">
              <span v-if="acc.followers != null" class="tabular-nums">
                {{ acc.followers.toLocaleString() }} followers
              </span>
              <span
                v-if="acc.needs_reconnection"
                class="chip text-[10px] border-danger/40 bg-danger/10 text-danger font-medium inline-flex items-center gap-1"
              >
                <AlertTriangle :size="10" /> Reconnect it in Zernio
              </span>
            </div>
          </div>
        </label>
      </div>

      <!-- No accounts found in Zernio -->
      <div v-else class="rounded-xl border border-dashed border-line p-3 text-center text-xs text-muted space-y-1">
        <p>No TikTok accounts found in your Zernio account.</p>
        <p class="text-[11px] text-faint">Connect your TikTok account inside Zernio first, then click Test below.</p>
      </div>
    </div>

    <!-- Help text block -->
    <div class="rounded-xl border border-line bg-surface-2/40 p-3 text-xs leading-relaxed text-muted space-y-1.5">
      <div class="font-semibold text-fg text-[11px] tracking-wide uppercase">TikTok posting guidelines</div>
      <ul class="list-disc list-inside space-y-1 text-[11px] text-faint">
        <li>TikTok allows 15 videos a day per account.</li>
        <li>Videos post publicly.</li>
        <li>Only post clips you own or have explicit permission to use.</li>
      </ul>
    </div>

    <!-- Messages / Errors -->
    <p v-if="msg" class="rounded-md bg-accent-soft px-3 py-2 text-sm text-accent" role="status">
      {{ msg }}
    </p>
    <p v-if="error" class="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
      {{ error }}
    </p>

    <!-- Footer buttons -->
    <div class="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3.5">
      <div class="text-[11px] text-faint">
        {{ tk?.has_key ? "Zernio account connected" : "API key required" }}
      </div>
      <div class="flex items-center gap-2 ml-auto">
        <button
          type="button"
          class="btn btn-sm min-h-10 sm:min-h-0"
          :disabled="busy !== null || !tk?.has_key"
          @click="testConnection"
        >
          <LoaderCircle v-if="busy === 'test'" :size="13" class="motion-safe:animate-spin" />
          Test
        </button>
      </div>
    </div>
  </div>
</template>
