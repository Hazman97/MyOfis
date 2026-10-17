<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { CircleCheck, Copy, KeyRound, Laptop, LoaderCircle, Server, TriangleAlert } from "lucide-vue-next";
import type { Runner } from "@agent-office/shared";
import ConfirmButton from "../components/ConfirmButton.vue";
import PageHeader from "../components/PageHeader.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { api } from "../api/http.ts";
import { useOffice } from "../stores/office.ts";
import { fmtDateTime } from "../format.ts";
import { installCommands, isLoopbackUrl } from "../install.ts";

const office = useOffice();
const runners = ref<Runner[]>([]);
const code = ref<{ code: string; expires_at: string } | null>(null);
const copied = ref("");
const showSource = ref(false);
/** Runner ids that existed when the code was made: a new id means the other PC is in. */
const knownIds = ref<Set<string>>(new Set());
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | undefined;

const hubUrl = ref(location.origin);
const authMode = ref("local");
const load = async () => (runners.value = (await api.runners()).runners);
onMounted(async () => {
  await load();
  const s = await api.settings();
  hubUrl.value = s.public_base_url;
  authMode.value = s.auth_mode;
  clock = setInterval(() => (now.value = Date.now()), 1000);
});
onUnmounted(() => clearInterval(clock));
// Refresh the list whenever a runner goes online/offline.
watch(() => JSON.stringify(office.state.runners), load);

const loopback = computed(() => isLoopbackUrl(hubUrl.value));
const commands = computed(() => (code.value ? installCommands(hubUrl.value, code.value.code, authMode.value === "cf-access") : []));
const fromSource = computed(() =>
  code.value
    ? [
        { label: "PowerShell", text: `$env:HUB_URL="${hubUrl.value}"; $env:RUNNER_NAME="my-pc"; $env:PAIRING_CODE="${code.value.code}"; bun run start:runner` },
        { label: "bash / zsh", text: `HUB_URL=${hubUrl.value} RUNNER_NAME=my-pc PAIRING_CODE=${code.value.code} bun run start:runner` },
      ]
    : [],
);
const joined = computed(() => runners.value.find((r) => !knownIds.value.has(r.id)) ?? null);
const secondsLeft = computed(() => (code.value ? Math.max(0, Math.round((Date.parse(code.value.expires_at) - now.value) / 1000)) : 0));
const countdown = computed(() => `${Math.floor(secondsLeft.value / 60)}:${String(secondsLeft.value % 60).padStart(2, "0")}`);

async function newCode() {
  knownIds.value = new Set(runners.value.map((r) => r.id));
  code.value = await api.pairingCode();
  copied.value = "";
}
async function copy(label: string, text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = label;
  } catch {
    copied.value = "";
  }
}
async function revoke(r: Runner) {
  await api.revokeRunner(r.id);
  await load();
}
const online = (r: Runner) => office.state.runners[r.id]?.online ?? r.status === "online";
</script>

<template>
  <div>
    <PageHeader sign="System" title="Runners" description="The machines that do the actual work. Each one connects out to this hub, so no ports need to be opened on it.">
      <button class="btn btn-primary" @click="newCode"><KeyRound :size="15" /> Connect a PC</button>
    </PageHeader>

    <section v-if="code" class="card-raised mb-5 p-5" aria-labelledby="rn-connect">
      <!-- success: the new PC paired with this code -->
      <div v-if="joined" class="flex items-center gap-3" role="status">
        <CircleCheck :size="22" class="shrink-0 text-accent" />
        <div class="min-w-0 flex-1">
          <h2 id="rn-connect" class="font-semibold">{{ joined.name }} is connected</h2>
          <p class="text-sm text-muted">It starts by itself whenever that PC is switched on. Agents can now run there.</p>
        </div>
        <button class="btn" @click="code = null">Close</button>
      </div>

      <template v-else>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
          <h2 id="rn-connect" class="sign">Connect a PC</h2>
          <span class="font-mono text-lg font-medium tracking-[0.2em]">{{ code.code }}</span>
          <span class="text-xs text-muted">Single use · {{ secondsLeft ? `expires in ${countdown}` : "expired: make a new one" }}</span>
        </div>

        <p v-if="loopback" class="mt-3 flex gap-2 rounded-md border border-signal/30 bg-signal-soft p-3 text-xs text-signal" role="alert">
          <TriangleAlert :size="15" class="mt-0.5 shrink-0" />
          <span>
            The hub address is <code>{{ hubUrl }}</code>, which only works on this PC. For a PC on the same WiFi, set <code>HUB_HOST=0.0.0.0</code> and
            <code>PUBLIC_BASE_URL=http://&lt;this PC's IP&gt;:8788</code> in <code>.env</code> and restart the hub (anyone on your network can then reach the login page).
            From outside your home, use Cloudflare Tunnel (docs/cloudflare-tunnel.md).
          </span>
        </p>

        <p class="mt-3 text-sm text-muted">On the other PC, open a terminal and paste <b>one</b> of these. It installs Bun if needed, downloads the runner from this hub, pairs it and starts it at every boot.</p>
        <p v-if="authMode === 'cf-access'" class="mt-1 text-xs text-muted">
          Behind Cloudflare Access: first set <code>CF_ACCESS_CLIENT_ID</code> and <code>CF_ACCESS_CLIENT_SECRET</code> (a service token) in that terminal.
        </p>
        <div class="mt-3 space-y-2">
          <div v-for="c in commands" :key="c.label" class="flex min-w-0 items-stretch overflow-hidden rounded-md border border-line">
            <span class="flex shrink-0 items-center bg-surface-2 px-2.5 font-mono text-[11px] text-muted">{{ c.label }}</span>
            <pre class="min-w-0 flex-1 overflow-x-auto bg-sunken px-3 py-2 font-mono text-xs">{{ c.text }}</pre>
            <button class="flex shrink-0 items-center gap-1 border-l border-line px-3 text-xs font-medium hover:bg-surface-2" @click="copy(c.label, c.text)">
              <Copy :size="13" />{{ copied === c.label ? "Copied" : "Copy" }}
            </button>
          </div>
        </div>
        <p v-if="secondsLeft" class="mt-3 flex items-center gap-2 text-xs text-muted" role="status">
          <LoaderCircle :size="14" class="animate-spin" /> Waiting for the PC to connect…
        </p>

        <button class="mt-3 text-xs text-faint hover:text-fg" :aria-expanded="showSource" @click="showSource = !showSource">
          {{ showSource ? "▾" : "▸" }} Run from a copy of this repo instead
        </button>
        <div v-if="showSource" class="mt-2 space-y-2">
          <div v-for="c in fromSource" :key="c.label" class="flex min-w-0 items-stretch overflow-hidden rounded-md border border-line">
            <span class="flex shrink-0 items-center bg-surface-2 px-2.5 font-mono text-[11px] text-muted">{{ c.label }}</span>
            <pre class="min-w-0 flex-1 overflow-x-auto bg-sunken px-3 py-2 font-mono text-xs">{{ c.text }}</pre>
            <button class="flex shrink-0 items-center gap-1 border-l border-line px-3 text-xs font-medium hover:bg-surface-2" @click="copy(`src-${c.label}`, c.text)">
              <Copy :size="13" />{{ copied === `src-${c.label}` ? "Copied" : "Copy" }}
            </button>
          </div>
          <p class="text-xs text-faint">The runner keeps its token in <code>data/runner-state.json</code>. Next time, <code>bun run dev:runner</code> is enough.</p>
        </div>
      </template>
    </section>

    <div class="grid gap-3 md:grid-cols-2">
      <article v-for="r in runners" :key="r.id" class="card p-4">
        <div class="flex items-start gap-3">
          <span class="flex size-10 shrink-0 items-center justify-center rounded-lg" :class="online(r) ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-faint'">
            <component :is="r.capabilities?.os === 'win32' || r.capabilities?.os === 'darwin' ? Laptop : Server" :size="20" :stroke-width="1.7" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <h2 class="truncate font-semibold">{{ r.name }}</h2>
              <StatusBadge :status="online(r) ? 'online' : 'offline'" />
            </div>
            <p class="truncate font-mono text-[11px] text-faint">{{ r.id }}</p>
          </div>
        </div>
        <div v-if="r.capabilities" class="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          <span class="chip">{{ r.capabilities.os }} / {{ r.capabilities.arch }}</span>
          <span v-for="rt in r.capabilities.runtimes" :key="rt" class="chip" :class="rt === 'opencode' && 'border-accent/40 text-accent'">{{ rt }}</span>
          <span v-for="p in r.capabilities.programs ?? []" :key="`p-${p}`" class="chip text-muted">{{ p }}</span>
        </div>
        <div class="mt-4 flex items-center gap-2 border-t border-line pt-3">
          <span class="text-xs text-muted">{{ r.last_seen_at ? `Last seen ${fmtDateTime(r.last_seen_at)}` : "Never connected" }}</span>
          <ConfirmButton small class="ml-auto" confirm-label="Revoke for good?" @confirm="revoke(r)">Revoke</ConfirmButton>
        </div>
      </article>
      <div v-if="!runners.length" class="rounded-lg border border-dashed border-line px-6 py-10 text-center text-sm text-muted md:col-span-2">
        No runners yet. Click <b>Connect a PC</b> to add this PC or another one.
      </div>
    </div>
  </div>
</template>
