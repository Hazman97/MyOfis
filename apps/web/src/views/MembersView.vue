<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { Mail, Share2, ShieldOff, UserPlus } from "lucide-vue-next";
import PageHeader from "../components/PageHeader.vue";
import SettingsTabs from "../components/SettingsTabs.vue";
import { api, type Member } from "../api/http.ts";
import { useOffice } from "../stores/office.ts";
import { fmtTokens } from "../format.ts";

/**
 * Members (owner request, 2026-10-19): friends log in with their own email and get their own
 * workspace. Agents you share run on your AI, within the daily limit you set per member.
 */
const office = useOffice();
const members = ref<Member[]>([]);
const error = ref("");
const msg = ref("");
const invite = reactive({ email: "", name: "" });
const busy = ref(false);
/** member id → agent id → daily limit (null = not shared), while editing */
const draft = reactive<Record<string, Record<string, number | null>>>({});
const ownAgents = computed(() => office.agents.filter((a) => !a.shared && a.workspace_id === "owner"));

async function load() {
  try {
    members.value = (await api.members()).members;
    for (const m of members.value) draft[m.id] = Object.fromEntries(ownAgents.value.map((a) => [a.id, m.shares.find((s) => s.agent_id === a.id)?.daily_token_budget ?? null]));
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

async function run(fn: () => Promise<unknown>, ok: string) {
  busy.value = true;
  error.value = msg.value = "";
  try {
    await fn();
    msg.value = ok;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

const sendInvite = () =>
  run(async () => {
    await api.inviteMember({ email: invite.email.trim(), name: invite.name.trim() });
    invite.email = invite.name = "";
  }, "Member added. Now add the same email to your Cloudflare Access policy so they can open the site.");
const toggle = (m: Member) => run(() => api.updateMember(m.id, { disabled: !m.disabled }), m.disabled ? "Enabled again." : "Disabled: they can no longer sign in.");
const saveShares = (m: Member) =>
  run(
    () =>
      api.setMemberShares(
        m.id,
        Object.entries(draft[m.id] ?? {})
          .filter(([, v]) => v !== null)
          .map(([agent_id, v]) => ({ agent_id, daily_token_budget: Number(v) })),
      ),
    "Shares saved.",
  );
function setShared(memberId: string, agentId: string, on: boolean) {
  (draft[memberId] ??= {})[agentId] = on ? 50_000 : null;
}
</script>

<template>
  <div class="mx-auto max-w-4xl">
    <PageHeader sign="System" title="Members" description="Friends with their own workspace on your MyOfis. They bring their own AI keys for their own agents; agents you share run on your AI, within the daily limit you set." />
    <SettingsTabs class="mb-5" />

    <p v-if="error" class="mb-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{{ error }}</p>
    <p v-if="msg" class="mb-3 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent" role="status">{{ msg }}</p>

    <!-- invite -->
    <form class="card mb-5 grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" @submit.prevent="sendInvite">
      <label><span class="label">Email (their Cloudflare Access login)</span><input v-model="invite.email" type="email" required class="input" placeholder="kawan@gmail.com" /></label>
      <label><span class="label">Name</span><input v-model="invite.name" maxlength="80" class="input" placeholder="Ali" /></label>
      <button class="btn btn-primary" :disabled="busy || !invite.email"><UserPlus :size="15" /> Add member</button>
      <p class="text-xs text-muted sm:col-span-3">
        Two steps: add them here, then add the same email in Cloudflare Zero Trust → Access → Applications → MyOfis → policy (Include → Emails). Members never see your agents, projects, drafts, runners or settings.
      </p>
    </form>

    <p v-if="!members.length" class="text-sm text-muted">No members yet.</p>

    <article v-for="m in members" :key="m.id" class="card mb-4 space-y-3 p-4" :class="m.disabled && 'opacity-60'">
      <div class="flex flex-wrap items-center gap-2">
        <Mail :size="16" class="text-accent" />
        <span class="font-medium">{{ m.name || m.email }}</span>
        <span class="text-xs text-muted">{{ m.email }}</span>
        <span v-if="m.disabled" class="chip text-[11px] text-danger">disabled</span>
        <span class="ml-auto text-xs text-muted tabular-nums">{{ fmtTokens(m.tokens_today) }} tokens today</span>
        <button type="button" class="btn btn-sm" :disabled="busy" @click="toggle(m)"><ShieldOff :size="14" /> {{ m.disabled ? "Enable" : "Disable" }}</button>
      </div>

      <div>
        <div class="mb-1.5 flex items-center gap-2 text-sm font-medium"><Share2 :size="15" class="text-accent" /> Agents shared with {{ m.name || "them" }}</div>
        <div class="grid gap-2 sm:grid-cols-2">
          <div v-for="a in ownAgents" :key="a.id" class="flex items-center gap-2 rounded-lg border border-line p-2 text-sm">
            <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
              <input type="checkbox" class="accent-accent" :checked="draft[m.id]?.[a.id] != null" @change="setShared(m.id, a.id, ($event.target as HTMLInputElement).checked)" />
              <span class="truncate">{{ a.name }}</span>
            </label>
            <template v-if="draft[m.id]?.[a.id] != null">
              <input v-model.number="draft[m.id]![a.id]" type="number" min="1000" step="1000" class="input w-28 py-1 text-xs" aria-label="Daily token limit" />
              <span class="text-[11px] text-muted">/day</span>
            </template>
            <span v-if="m.shares.find((s) => s.agent_id === a.id)" class="text-[11px] text-faint tabular-nums">{{ fmtTokens(m.shares.find((s) => s.agent_id === a.id)!.used_today) }} used</span>
          </div>
        </div>
        <button type="button" class="btn btn-sm mt-2" :disabled="busy" @click="saveShares(m)">Save shares</button>
      </div>
    </article>
  </div>
</template>
