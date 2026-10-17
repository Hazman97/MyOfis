<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { Check, CircleCheck, Copy, KeyRound, Laptop, LoaderCircle, Server, TriangleAlert } from "lucide-vue-next";
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

    <section v-if="code" class="card mb-6 p-5 border-line shadow-card" aria-labelledby="rn-connect">
      <!-- success: the new PC paired with this code -->
      <div v-if="joined" class="flex flex-col sm:flex-row items-start sm:items-center gap-4 rounded-xl border border-accent/30 bg-accent-soft/30 p-5 shadow-sm" role="status">
        <div class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-ink shadow-sm">
          <CircleCheck :size="26" :stroke-width="2.2" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="sign text-[10px] text-accent tracking-wider">Pairing Complete</div>
          <h2 id="rn-connect" class="text-base font-semibold text-fg mt-0.5">{{ joined.name }} is connected</h2>
          <p class="text-xs text-muted mt-1 leading-relaxed">It starts by itself whenever that PC is switched on. Agents can now run there.</p>
        </div>
        <button class="btn btn-primary btn-sm shadow-sm max-sm:w-full" @click="code = null">Close</button>
      </div>

      <template v-else>
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
          <div>
            <div class="sign text-[10px] text-accent tracking-wider">Connect a PC</div>
            <div class="flex items-baseline gap-3 mt-1">
              <h2 id="rn-connect" class="font-mono text-2xl sm:text-3xl font-bold tracking-[0.25em] text-fg select-all">{{ code.code }}</h2>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span
              class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-mono font-medium border"
              :class="secondsLeft ? 'border-line bg-surface-2/60 text-muted' : 'border-danger/30 bg-danger-soft text-danger'"
            >
              <span class="size-1.5 rounded-full" :class="secondsLeft ? 'bg-signal animate-pulse' : 'bg-danger'" />
              <span>Single use · {{ secondsLeft ? `expires in ${countdown}` : "expired: make a new one" }}</span>
            </span>
          </div>
        </div>

        <p v-if="loopback" class="mt-4 flex gap-2.5 rounded-xl border border-signal/40 bg-signal-soft/40 p-3.5 text-xs text-signal leading-relaxed" role="alert">
          <TriangleAlert :size="16" class="mt-0.5 shrink-0 text-signal" />
          <span class="min-w-0 flex-1">
            The hub address is <code>{{ hubUrl }}</code>, which only works on this PC. For a PC on the same WiFi, set <code>HUB_HOST=0.0.0.0</code> and
            <code>PUBLIC_BASE_URL=http://&lt;this PC's IP&gt;:8788</code> in <code>.env</code> and restart the hub (anyone on your network can then reach the login page).
            From outside your home, use Cloudflare Tunnel (docs/cloudflare-tunnel.md).
          </span>
        </p>

        <!-- 1-2-3 Guided Steps -->
        <div class="mt-5 space-y-4">
          <!-- Step 1 -->
          <div class="space-y-2.5">
            <div class="flex items-center gap-2">
              <span class="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent font-mono text-xs font-bold">1</span>
              <h3 class="text-xs font-semibold text-fg">Copy the command for the other PC's OS</h3>
            </div>
            
            <p v-if="authMode === 'cf-access'" class="text-xs text-muted pl-7">
              Behind Cloudflare Access: first set <code>CF_ACCESS_CLIENT_ID</code> and <code>CF_ACCESS_CLIENT_SECRET</code> (a service token) in that terminal.
            </p>

            <div class="space-y-2 pl-7">
              <div v-for="c in commands" :key="c.label" class="flex min-w-0 items-stretch overflow-hidden rounded-xl border border-line bg-surface shadow-inner">
                <span class="flex shrink-0 items-center justify-center bg-surface-2 px-3 font-mono text-[11px] font-semibold text-muted border-r border-line select-none">{{ c.label }}</span>
                <pre class="min-w-0 flex-1 overflow-x-auto bg-sunken/80 px-3.5 py-2.5 font-mono text-xs text-fg leading-relaxed">{{ c.text }}</pre>
                <button
                  class="flex shrink-0 items-center gap-1.5 border-l border-line px-3.5 text-xs font-medium transition-colors hover:bg-surface-2 text-muted hover:text-fg"
                  :class="copied === c.label ? 'text-accent font-semibold' : ''"
                  @click="copy(c.label, c.text)"
                >
                  <component :is="copied === c.label ? Check : Copy" :size="13" />
                  <span>{{ copied === c.label ? "Copied" : "Copy" }}</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Step 2 -->
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <span class="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent font-mono text-xs font-bold">2</span>
              <h3 class="text-xs font-semibold text-fg">Paste it in a terminal there</h3>
            </div>
            <p class="text-xs text-muted pl-7 leading-relaxed">
              It installs Bun if needed, downloads the runner from this hub, pairs it and starts it at every boot.
            </p>
          </div>

          <!-- Step 3 -->
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <span class="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent font-mono text-xs font-bold">3</span>
              <h3 class="text-xs font-semibold text-fg">Wait here</h3>
            </div>
            <div class="pl-7">
              <p v-if="secondsLeft" class="flex items-center gap-2 text-xs text-muted" role="status">
                <span class="relative flex size-2">
                  <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal opacity-75" />
                  <span class="relative inline-flex size-2 rounded-full bg-signal" />
                </span>
                <LoaderCircle :size="14" class="animate-spin text-accent" />
                <span>Waiting for the PC to connect… (takes about 30 seconds)</span>
              </p>
            </div>
          </div>
        </div>

        <!-- From source disclosure -->
        <div class="mt-5 border-t border-line/60 pt-3">
          <button
            class="inline-flex items-center gap-1.5 text-xs text-muted hover:text-fg transition-colors cursor-pointer"
            :aria-expanded="showSource"
            @click="showSource = !showSource"
          >
            <span class="text-[10px] font-mono">{{ showSource ? "▾" : "▸" }}</span>
            <span>Run from a copy of this repo instead</span>
          </button>
          <div v-if="showSource" class="mt-3 space-y-2">
            <div v-for="c in fromSource" :key="c.label" class="flex min-w-0 items-stretch overflow-hidden rounded-xl border border-line bg-surface">
              <span class="flex shrink-0 items-center justify-center bg-surface-2 px-3 font-mono text-[11px] font-semibold text-muted border-r border-line select-none">{{ c.label }}</span>
              <pre class="min-w-0 flex-1 overflow-x-auto bg-sunken/80 px-3.5 py-2.5 font-mono text-xs text-fg leading-relaxed">{{ c.text }}</pre>
              <button
                class="flex shrink-0 items-center gap-1.5 border-l border-line px-3.5 text-xs font-medium transition-colors hover:bg-surface-2 text-muted hover:text-fg"
                :class="copied === `src-${c.label}` ? 'text-accent font-semibold' : ''"
                @click="copy(`src-${c.label}`, c.text)"
              >
                <component :is="copied === `src-${c.label}` ? Check : Copy" :size="13" />
                <span>{{ copied === `src-${c.label}` ? "Copied" : "Copy" }}</span>
              </button>
            </div>
            <p class="text-xs text-faint">The runner keeps its token in <code>data/runner-state.json</code>. Next time, <code>bun run dev:runner</code> is enough.</p>
          </div>
        </div>
      </template>
    </section>

    <!-- Runners list -->
    <div class="grid gap-3 md:grid-cols-2">
      <article v-for="r in runners" :key="r.id" class="card p-4 transition-all duration-150 hover:shadow-card">
        <div class="flex items-start gap-3">
          <span class="flex size-10 shrink-0 items-center justify-center rounded-xl" :class="online(r) ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-faint'">
            <component :is="r.capabilities?.os === 'win32' || r.capabilities?.os === 'darwin' ? Laptop : Server" :size="20" :stroke-width="1.7" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <h2 class="truncate font-semibold text-sm">{{ r.name }}</h2>
              <StatusBadge :status="online(r) ? 'online' : 'offline'" />
            </div>
            <p class="truncate font-mono text-[11px] text-faint mt-0.5">{{ r.id }}</p>
          </div>
        </div>
        <div v-if="r.capabilities" class="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          <span class="chip bg-surface-2/70 text-muted">{{ r.capabilities.os }} / {{ r.capabilities.arch }}</span>
          <span v-for="rt in r.capabilities.runtimes" :key="rt" class="chip font-medium" :class="rt === 'opencode' ? 'border-accent/40 text-accent bg-accent/5' : 'text-fg'">{{ rt }}</span>
          <span v-for="p in r.capabilities.programs ?? []" :key="`p-${p}`" class="chip bg-surface-2/40 text-faint border-line/60">{{ p }}</span>
        </div>
        <div class="mt-4 flex items-center gap-2 border-t border-line/60 pt-3">
          <span class="text-xs text-muted">{{ r.last_seen_at ? `Last seen ${fmtDateTime(r.last_seen_at)}` : "Never connected" }}</span>
          <ConfirmButton small class="ml-auto" confirm-label="Revoke for good?" @confirm="revoke(r)">Revoke</ConfirmButton>
        </div>
      </article>
      <div v-if="!runners.length" class="card rounded-2xl border-dashed border-line p-10 text-center md:col-span-2 flex flex-col items-center justify-center">
        <div class="flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-faint mb-3">
          <Server :size="24" :stroke-width="1.6" />
        </div>
        <p class="text-sm font-medium text-fg">No runners connected</p>
        <p class="text-xs text-muted mt-1 max-w-sm">
          No runners yet. Click <b class="text-fg font-semibold">Connect a PC</b> to add this PC or another one.
        </p>
      </div>
    </div>
  </div>
</template>
