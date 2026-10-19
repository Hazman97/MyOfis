<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { Coins, Mail, Save, Share2, ShieldCheck, ShieldOff, UserPlus, Users } from "lucide-vue-next";
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
    for (const m of members.value) {
      draft[m.id] = Object.fromEntries(
        ownAgents.value.map((a) => [a.id, m.shares.find((s) => s.agent_id === a.id)?.daily_token_budget ?? null]),
      );
    }
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

const toggle = (m: Member) =>
  run(
    () => api.updateMember(m.id, { disabled: !m.disabled }),
    m.disabled ? "Enabled again." : "Disabled: they can no longer sign in.",
  );

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

function getInitials(text: string) {
  const clean = (text || "").replace(/@.*/, "").trim();
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  const first = parts[0];
  const second = parts[1];
  if (first && second) return ((first[0] ?? "") + (second[0] ?? "")).toUpperCase();
  return clean.slice(0, 2).toUpperCase() || "?";
}
</script>

<template>
  <div class="mx-auto max-w-4xl pb-10">
    <PageHeader
      sign="System"
      title="Members"
      description="Friends with their own workspace on your MyOfis. They bring their own AI keys for their own agents; agents you share run on your AI, within the daily limit you set."
    />
    <SettingsTabs class="mb-5" />

    <p v-if="error" class="mb-4 rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger border border-danger/20" role="alert">
      {{ error }}
    </p>
    <p v-if="msg" class="mb-4 rounded-lg bg-accent-soft px-3.5 py-2.5 text-sm text-accent border border-accent/20" role="status">
      {{ msg }}
    </p>

    <!-- Invite Member Form -->
    <form class="card mb-5 grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" @submit.prevent="sendInvite">
      <label class="block">
        <span class="label">Email (Cloudflare Access login)</span>
        <input
          v-model="invite.email"
          type="email"
          required
          class="input"
          placeholder="friend@example.com"
        />
      </label>
      <label class="block">
        <span class="label">Name</span>
        <input
          v-model="invite.name"
          maxlength="80"
          class="input"
          placeholder="e.g. Ali"
        />
      </label>
      <button class="btn btn-primary h-9" :disabled="busy || !invite.email.trim()">
        <UserPlus :size="15" />
        <span>Add member</span>
      </button>
    </form>

    <!-- 2-Step How to Invite Callout Box -->
    <div class="card mb-6 border border-line bg-surface-2/40 p-4">
      <div class="sign mb-1 text-accent">Access Setup</div>
      <h3 class="text-sm font-semibold text-fg">How to invite a member</h3>
      <div class="mt-3 grid gap-3 sm:grid-cols-2 text-xs">
        <div class="flex gap-2.5 rounded-lg border border-line bg-surface p-3">
          <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-ink">
            1
          </span>
          <div>
            <strong class="font-medium text-fg block">Add member here</strong>
            <p class="text-muted text-[11px] leading-relaxed mt-0.5">
              Enter their email and name in the form above. They will receive their own private workspace on your MyOfis.
            </p>
          </div>
        </div>
        <div class="flex gap-2.5 rounded-lg border border-line bg-surface p-3">
          <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-ink">
            2
          </span>
          <div>
            <strong class="font-medium text-fg block">Add to Cloudflare Access</strong>
            <p class="text-muted text-[11px] leading-relaxed mt-0.5">
              Add the same email in Cloudflare Zero Trust &rarr; Access &rarr; Applications &rarr; MyOfis policy (Include &rarr; Emails).
            </p>
          </div>
        </div>
      </div>
      <p class="mt-3 text-[11px] text-muted leading-relaxed">
        Members bring their own AI keys for their personal agents. Agents you share run on your AI, capped by the daily limit you configure. Members never see your private HQ agents, projects, drafts, runners, or settings.
      </p>
    </div>

    <!-- Empty State -->
    <div v-if="!members.length" class="card p-8 text-center border-dashed">
      <Users :size="28" class="mx-auto text-muted mb-2" />
      <h3 class="text-sm font-semibold text-fg">No members yet</h3>
      <p class="mt-1 text-xs text-muted">Use the form above to invite your first team member or friend.</p>
    </div>

    <!-- Member Cards -->
    <div class="space-y-4">
      <article
        v-for="m in members"
        :key="m.id"
        class="card p-4 sm:p-5 space-y-4 transition-all"
        :class="m.disabled && 'opacity-65'"
      >
        <!-- Card Header: Avatar, Name, Email, Status Chip, Tokens Today, Action Button -->
        <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-line">
          <div class="flex items-center gap-3 min-w-0">
            <!-- Initials Avatar -->
            <div
              class="flex size-10 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold border"
              :class="
                m.disabled
                  ? 'bg-sunken text-muted border-line'
                  : 'bg-accent-soft text-accent border-accent/25'
              "
            >
              {{ getInitials(m.name || m.email) }}
            </div>

            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <h2 class="font-semibold text-sm text-fg truncate">{{ m.name || m.email }}</h2>
                <span
                  class="chip text-[11px] font-medium"
                  :class="
                    m.disabled
                      ? 'border-danger/30 bg-danger-soft text-danger'
                      : 'border-accent/30 bg-accent-soft text-accent'
                  "
                >
                  {{ m.disabled ? "disabled" : "active" }}
                </span>
              </div>
              <div class="flex items-center gap-1.5 text-xs text-muted truncate mt-0.5">
                <Mail :size="12" class="shrink-0 text-faint" />
                <span class="truncate">{{ m.email }}</span>
              </div>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2.5 ml-auto">
            <!-- Tokens Today -->
            <span class="chip text-xs font-mono tabular-nums text-muted bg-surface-2 border-line">
              <Coins :size="12" class="text-accent shrink-0" />
              <span>{{ fmtTokens(m.tokens_today) }} tokens today</span>
            </span>

            <!-- Enable / Disable Button -->
            <button
              type="button"
              class="btn btn-sm text-xs font-medium"
              :class="m.disabled ? 'btn-primary' : 'btn-ghost hover:bg-surface-2 border border-line text-muted'"
              :disabled="busy"
              @click="toggle(m)"
            >
              <component :is="m.disabled ? ShieldCheck : ShieldOff" :size="13" />
              <span>{{ m.disabled ? "Enable" : "Disable" }}</span>
            </button>
          </div>
        </div>

        <!-- Shared Agents Section -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 text-xs font-semibold text-fg">
              <Share2 :size="14" class="text-accent" />
              <span>Agents shared with {{ m.name || m.email }}</span>
            </div>
            <span v-if="ownAgents.length" class="text-[11px] text-muted">
              {{ Object.values(draft[m.id] ?? {}).filter((v) => v !== null).length }} of {{ ownAgents.length }} shared
            </span>
          </div>

          <div v-if="!ownAgents.length" class="text-xs text-muted">
            No agents in HQ available to share.
          </div>

          <!-- Toggle Rows for Shared Agents -->
          <div v-else class="grid gap-2 sm:grid-cols-2">
            <div
              v-for="a in ownAgents"
              :key="a.id"
              class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-2/30 p-2.5 text-xs transition-colors hover:border-line-strong"
              :class="draft[m.id]?.[a.id] != null && 'border-accent/30 bg-accent-soft/10'"
            >
              <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  class="size-3.5 rounded accent-accent"
                  :checked="draft[m.id]?.[a.id] != null"
                  @change="setShared(m.id, a.id, ($event.target as HTMLInputElement).checked)"
                />
                <div class="min-w-0">
                  <div class="font-medium text-fg truncate">{{ a.name }}</div>
                  <div v-if="m.shares.find((s) => s.agent_id === a.id)" class="text-[10px] text-muted tabular-nums">
                    {{ fmtTokens(m.shares.find((s) => s.agent_id === a.id)!.used_today) }} used today
                  </div>
                </div>
              </label>

              <!-- Compact Limit Input -->
              <div v-if="draft[m.id]?.[a.id] != null" class="flex items-center gap-1.5 shrink-0 ml-auto">
                <input
                  v-model.number="draft[m.id]![a.id]"
                  type="number"
                  min="1000"
                  step="5000"
                  class="input h-7 w-24 px-1.5 py-0 text-right font-mono text-xs tabular-nums"
                  aria-label="Daily token limit"
                />
                <span class="text-[11px] text-muted font-mono">/day</span>
              </div>
            </div>
          </div>

          <div v-if="ownAgents.length" class="pt-1">
            <button
              type="button"
              class="btn btn-sm btn-primary h-8 px-3"
              :disabled="busy"
              @click="saveShares(m)"
            >
              <Save :size="13" />
              <span>Save shares</span>
            </button>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>
