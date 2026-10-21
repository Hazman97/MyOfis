<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { CalendarClock, Pencil, Play, Plus } from "lucide-vue-next";
import type { Project, Schedule } from "@agent-office/shared";
import AgentAvatar from "../components/AgentAvatar.vue";
import ConfirmButton from "../components/ConfirmButton.vue";
import PageHeader from "../components/PageHeader.vue";
import SidePanel from "../components/SidePanel.vue";
import { api, type SocialTarget } from "../api/http.ts";
import { describeCron } from "../cron.ts";
import { useOffice } from "../stores/office.ts";
import { fmtDateTime } from "../format.ts";

const office = useOffice();
const router = useRouter();
const schedules = ref<Schedule[]>([]);
const projects = ref<Project[]>([]);
const editing = ref<string | null>(null);
const error = ref("");

const PRESETS = [
  { label: "Weekdays 08:00", cron: "0 8 * * 1-5" },
  { label: "Every night 02:00", cron: "0 2 * * *" },
  { label: "Monday 09:00", cron: "0 9 * * 1" },
  { label: "Every hour", cron: "0 * * * *" },
];

const form = reactive({ agent_id: "", cron: "0 8 * * 1-5", title: "", input: "{}", project_id: "", enabled: true, tiktok_account: "" });
/** TikTok accounts (Settings → Social accounts): a schedule can post to its own one. */
const tiktokTargets = ref<SocialTarget[]>([]);
const formAgent = computed(() => office.agentById[form.agent_id]);
/** Only agents that save drafts can post anywhere. */
const showAccount = computed(() => tiktokTargets.value.length > 0 && !!formAgent.value?.tools.includes("save_draft"));
const formDescription = computed(() => describeCron(form.cron));

const load = async () => {
  void api
    .socialAccounts()
    .then((r) => (tiktokTargets.value = r.tiktok))
    .catch(() => {});
  [schedules.value, projects.value] = await Promise.all([api.schedules().then((r) => r.schedules), api.projects().then((r) => r.projects)]);
};
onMounted(load);

function edit(s: Schedule | null) {
  error.value = "";
  if (s) {
    Object.assign(form, {
      agent_id: s.agent_id,
      cron: s.cron,
      title: s.job_template.title,
      input: JSON.stringify(s.job_template.input, null, 2),
      project_id: s.job_template.project_id ?? "",
      enabled: s.enabled,
      tiktok_account: typeof s.job_template.input.tiktok_account === "string" ? s.job_template.input.tiktok_account : "",
    });
  } else {
    Object.assign(form, { agent_id: office.agents.find((a) => a.enabled)?.id ?? "", cron: "0 8 * * 1-5", title: "", input: "{}", project_id: "", enabled: true, tiktok_account: "" });
  }
  editing.value = s?.id ?? "new";
}

async function save() {
  error.value = "";
  try {
    let input: unknown;
    try {
      input = JSON.parse(form.input || "{}");
    } catch {
      throw new Error("Job input must be valid JSON");
    }
    // the account picker writes input.tiktok_account ("" = the agent's default)
    if (input && typeof input === "object" && !Array.isArray(input)) {
      const obj = input as Record<string, unknown>;
      if (form.tiktok_account) obj.tiktok_account = form.tiktok_account;
      else delete obj.tiktok_account;
    }
    const body = { cron: form.cron.trim(), enabled: form.enabled, job_template: { title: form.title, input, project_id: form.project_id || null } };
    if (editing.value === "new") await api.createSchedule({ ...body, agent_id: form.agent_id });
    else await api.updateSchedule(editing.value!, body);
    editing.value = null;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function toggle(s: Schedule) {
  await api.updateSchedule(s.id, { enabled: !s.enabled });
  await load();
}

async function runNow(s: Schedule) {
  const { job_id } = await api.runScheduleNow(s.id);
  await load();
  for (let i = 0; i < 20; i++) {
    const runId = office.state.jobs[job_id]?.run_ids.at(-1);
    if (runId) return void router.push({ name: "run", params: { id: runId } });
    await new Promise((r) => setTimeout(r, 100));
  }
  await router.push({ name: "job", params: { id: job_id } });
}

async function remove(s: Schedule) {
  await api.deleteSchedule(s.id);
  await load();
}
const projectName = (id: string | null) => (id ? projects.value.find((p) => p.id === id)?.name : null);
</script>

<template>
  <div>
    <PageHeader
      sign="Team"
      title="Schedules"
      description="Recurring work, in Malaysia time. Skipped while everything is paused or the agent is off; a run missed while the hub was off is not made up later."
    >
      <button class="btn btn-primary" @click="edit(null)"><Plus :size="16" /> New schedule</button>
    </PageHeader>

    <div class="space-y-2">
      <article v-for="s in schedules" :key="s.id" class="card flex flex-wrap items-center gap-x-4 gap-y-3 p-4" :class="!s.enabled && 'opacity-75'">
        <AgentAvatar :name="office.agentById[s.agent_id]?.name ?? '?'" :slug="office.agentById[s.agent_id]?.slug" :size="38" />
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="font-semibold">{{ s.job_template.title }}</h2>
            <span class="text-sm text-muted">{{ office.agentById[s.agent_id]?.name }}</span>
            <span v-if="projectName(s.job_template.project_id)" class="chip text-[11px]">{{ projectName(s.job_template.project_id) }}</span>
            <span v-if="typeof s.job_template.input.tiktok_account === 'string'" class="chip text-[11px]">→ {{ tiktokTargets.find((t) => t.id === s.job_template.input.tiktok_account)?.label ?? "TikTok account (off)" }}</span>
          </div>
          <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span class="inline-flex items-center gap-1 font-medium" :class="s.enabled ? 'text-fg' : 'text-muted'">
              <CalendarClock :size="13" class="text-accent" />{{ describeCron(s.cron) ?? s.cron }}
            </span>
            <code class="text-[11px] text-faint">{{ s.cron }}</code>
            <span v-if="s.enabled && s.next_run_at" class="text-muted">next {{ fmtDateTime(s.next_run_at) }}</span>
            <span v-else-if="!s.enabled" class="text-signal">off</span>
            <span v-if="s.last_run_at" class="text-faint">last {{ fmtDateTime(s.last_run_at) }}</span>
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <label class="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-muted">
            <input type="checkbox" :checked="s.enabled" class="peer sr-only" @change="toggle(s)" />
            <span class="relative h-5 w-9 rounded-full bg-line-strong transition-colors peer-checked:bg-accent after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4" />
            {{ s.enabled ? "On" : "Off" }}
          </label>
          <button class="btn btn-sm" @click="runNow(s)"><Play :size="13" /> Run now</button>
          <button class="btn btn-sm" @click="edit(s)"><Pencil :size="13" /> Edit</button>
          <ConfirmButton small confirm-label="Delete?" @confirm="remove(s)">Delete</ConfirmButton>
        </div>
      </article>
      <div v-if="!schedules.length" class="card flex flex-col items-center justify-center border-dashed p-12 text-center text-xs text-muted">
        <CalendarClock :size="28" class="text-faint mb-2" :stroke-width="1.5" />
        <p class="font-semibold text-sm text-fg">No schedules yet</p>
        <p class="mt-1 max-w-sm text-muted">
          Set up recurring jobs (daily testing, morning standup digests, weekly backups) for your agents.
        </p>
        <button class="btn btn-primary btn-sm mt-4 shadow-sm" @click="edit(null)">
          <Plus :size="14" /> New schedule
        </button>
      </div>
    </div>

    <SidePanel v-if="editing" :sign="editing === 'new' ? 'New schedule' : 'Edit schedule'" :title="form.title || 'Schedule'" @close="editing = null">
      <form id="sched-form" class="space-y-4" @submit.prevent="save">
        <div>
          <label class="label" for="sc-agent">Agent</label>
          <select id="sc-agent" v-model="form.agent_id" class="input" :disabled="editing !== 'new'" required>
            <option v-for="a in office.agents" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </div>
        <div><label class="label" for="sc-title">Job title</label><input id="sc-title" v-model="form.title" class="input" required /></div>
        <div>
          <label class="label" for="sc-cron">When · cron (minute hour day month weekday)</label>
          <input id="sc-cron" v-model="form.cron" class="input font-mono" required />
          <p class="mt-1 text-xs" :class="formDescription ? 'text-accent' : 'text-faint'">{{ formDescription ?? "Custom schedule" }}</p>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <button v-for="p in PRESETS" :key="p.cron" type="button" class="btn btn-sm" :class="form.cron === p.cron && 'border-accent text-accent'" @click="form.cron = p.cron">{{ p.label }}</button>
          </div>
        </div>
        <div>
          <label class="label" for="sc-proj">Project · optional</label>
          <select id="sc-proj" v-model="form.project_id" class="input">
            <option value="">No project</option>
            <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>
        <div v-if="showAccount" class="rounded-xl border border-line bg-surface-2/40 p-3.5 space-y-1.5">
          <label class="label text-xs font-semibold text-fg" for="sc-account">Post to TikTok account</label>
          <select id="sc-account" v-model="form.tiktok_account" class="input text-sm min-h-10 bg-surface">
            <option value="">The agent's default</option>
            <option v-for="t in tiktokTargets" :key="t.id" :value="t.id">{{ t.label }} · @{{ t.username }}</option>
          </select>
          <p class="text-[11px] text-faint">Pick an account for this schedule, or leave as default.</p>
        </div>
        <div>
          <label class="label" for="sc-input">Job input · JSON</label>
          <textarea id="sc-input" v-model="form.input" class="input min-h-28 font-mono text-xs" />
        </div>
        <label class="flex items-center gap-2 text-sm"><input v-model="form.enabled" type="checkbox" class="accent-accent" /> Enabled</label>
      </form>
      <template #footer>
        <p v-if="error" class="min-w-0 flex-1 truncate text-sm text-danger" :title="error">{{ error }}</p>
        <button type="button" class="btn ml-auto" @click="editing = null">Cancel</button>
        <button form="sched-form" class="btn btn-primary">Save</button>
      </template>
    </SidePanel>
  </div>
</template>
