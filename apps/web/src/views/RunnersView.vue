<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Copy, KeyRound, Laptop, Server } from "lucide-vue-next";
import type { Runner } from "@agent-office/shared";
import ConfirmButton from "../components/ConfirmButton.vue";
import PageHeader from "../components/PageHeader.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { api } from "../api/http.ts";
import { useOffice } from "../stores/office.ts";
import { fmtDateTime } from "../format.ts";

const office = useOffice();
const runners = ref<Runner[]>([]);
const code = ref<{ code: string; expires_at: string } | null>(null);
const copied = ref("");

const hubUrl = ref(location.origin);
const load = async () => (runners.value = (await api.runners()).runners);
onMounted(async () => {
  await load();
  hubUrl.value = (await api.settings()).public_base_url;
});
// Refresh the list whenever a runner goes online/offline.
watch(() => JSON.stringify(office.state.runners), load);

const commands = computed(() =>
  code.value
    ? [
        { label: "PowerShell", text: `$env:HUB_URL="${hubUrl.value}"; $env:RUNNER_NAME="my-pc"; $env:PAIRING_CODE="${code.value.code}"; bun run start:runner` },
        { label: "bash / zsh", text: `HUB_URL=${hubUrl.value} RUNNER_NAME=my-pc PAIRING_CODE=${code.value.code} bun run start:runner` },
      ]
    : [],
);

async function newCode() {
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
    <PageHeader sign="System" title="Runners" description="The machines that do the actual work. Each one connects out to this hub, so no ports need to be opened.">
      <button class="btn btn-primary" @click="newCode"><KeyRound :size="15" /> New pairing code</button>
    </PageHeader>

    <section v-if="code" class="card-raised mb-5 p-5">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span class="sign">Pairing code</span>
        <span class="font-mono text-2xl font-medium tracking-[0.2em]">{{ code.code }}</span>
        <span class="text-xs text-muted">Single use · expires {{ fmtDateTime(code.expires_at) }}</span>
      </div>
      <p class="mt-3 text-sm text-muted">On the machine that should do the work, open a terminal in the project folder and run:</p>
      <div class="mt-3 space-y-2">
        <div v-for="c in commands" :key="c.label" class="flex min-w-0 items-stretch overflow-hidden rounded-md border border-line">
          <span class="flex shrink-0 items-center bg-surface-2 px-2.5 font-mono text-[11px] text-muted">{{ c.label }}</span>
          <pre class="min-w-0 flex-1 overflow-x-auto bg-sunken px-3 py-2 font-mono text-xs">{{ c.text }}</pre>
          <button class="flex shrink-0 items-center gap-1 border-l border-line px-3 text-xs font-medium hover:bg-surface-2" @click="copy(c.label, c.text)">
            <Copy :size="13" />{{ copied === c.label ? "Copied" : "Copy" }}
          </button>
        </div>
      </div>
      <p class="mt-3 text-xs text-faint">The runner keeps its token in <code>data/runner-state.json</code>. Next time, <code>bun run dev:runner</code> is enough.</p>
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
        </div>
        <div class="mt-4 flex items-center gap-2 border-t border-line pt-3">
          <span class="text-xs text-muted">{{ r.last_seen_at ? `Last seen ${fmtDateTime(r.last_seen_at)}` : "Never connected" }}</span>
          <ConfirmButton small class="ml-auto" confirm-label="Revoke for good?" @confirm="revoke(r)">Revoke</ConfirmButton>
        </div>
      </article>
      <div v-if="!runners.length" class="rounded-lg border border-dashed border-line px-6 py-10 text-center text-sm text-muted md:col-span-2">
        No runners yet. Create a pairing code to connect this PC.
      </div>
    </div>
  </div>
</template>
