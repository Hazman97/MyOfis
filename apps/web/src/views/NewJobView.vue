<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { Bot, LoaderCircle } from "lucide-vue-next";
import { MARKETING_JOB_TYPES, type Project } from "@agent-office/shared";
import AgentAvatar from "../components/AgentAvatar.vue";
import PageHeader from "../components/PageHeader.vue";
import { api } from "../api/http.ts";
import { useOffice } from "../stores/office.ts";

const office = useOffice();
const router = useRouter();
const route = useRoute();

/** ?agent= takes a slug or an id. */
const wanted = typeof route.query.agent === "string" ? route.query.agent : "";
const agentId = ref("");
const jobType = ref("caption");
const projectId = ref("");
const projects = ref<Project[]>([]);
const title = ref("");
const text = ref("");
const asJson = ref(false);
const error = ref("");
const busy = ref(false);

onMounted(async () => {
  projects.value = (await api.projects()).projects.filter((p) => p.enabled);
});
const enabledAgents = computed(() => office.agents.filter((a) => a.enabled));
watchEffect(() => {
  if (agentId.value) return;
  const pick = enabledAgents.value.find((a) => a.slug === wanted || a.id === wanted) ?? enabledAgents.value[0];
  if (pick) agentId.value = pick.id;
});
const agent = computed(() => office.agentById[agentId.value]);
// the Marketing-style job form (caption, script, calendar…) is for copywriters: they draft from the
// brief and feature log. Editor, Publisher, TikTok Poster and Misi 1K also save drafts but take free text.
const isMarketing = computed(() => {
  const t = agent.value?.tools ?? [];
  return t.includes("save_draft") && t.includes("read_feature_log") && !t.some((x) => x.startsWith("video_") || x === "draft_web_post" || x === "clip_library");
});
const marketingType = computed(() => MARKETING_JOB_TYPES.find((t) => t.type === jobType.value));
const needsRepo = computed(() => agent.value?.config.runtime === "opencode");
const project = computed(() => projects.value.find((p) => p.id === projectId.value));

const plan = computed(() => {
  const a = agent.value;
  if (!a) return [];
  if (isMarketing.value) {
    return [
      "Reads the project brief, feature log and your past feedback",
      "Writes, then checks facts, claims and tone itself",
      "Every piece lands in Drafts: nothing is posted",
      "You approve, edit or reject; your edits teach it your style",
    ];
  }
  if (a.config.runtime === "opencode") {
    return [
      "Clones the project's repo and makes a new branch",
      "OpenCode edits code and runs tests with the agent's allowlist",
      "Anything outside the allowlist waits in Approvals",
      "Agent Office commits, pushes the branch and opens a pull request",
    ];
  }
  return [
    `${a.name} works with ${a.tools.length ? `${a.tools.length} tools` : "no tools (text only)"}`,
    // only agents that can write files are asked about it
    ...(a.tools.some((t) => ["write_file", "run_command", "edit_file"].includes(t))
      ? [a.permission_level === "safe" ? "Asks you before writing files" : "Writes in its own workspace without asking"]
      : []),
    "Dangerous actions always wait in Approvals",
    "You can watch it live and cancel at any time",
  ];
});

async function submit() {
  busy.value = true;
  error.value = "";
  try {
    let input: Record<string, unknown> = { text: text.value };
    if (asJson.value) {
      const parsed: unknown = JSON.parse(text.value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON input must be an object");
      input = parsed as Record<string, unknown>;
    }
    const { job } = await api.createJob({
      agent_id: agentId.value,
      project_id: projectId.value || null,
      title:
        title.value.trim() ||
        (isMarketing.value && marketingType.value ? `${marketingType.value.label}: ${text.value.trim().slice(0, 50)}` : "") ||
        (asJson.value ? "JSON job" : text.value.trim().slice(0, 60)) ||
        "Untitled job",
      type: isMarketing.value ? jobType.value : undefined,
      input,
    });
    // Wait briefly for the run to start so we can jump straight to its live log.
    for (let i = 0; i < 20; i++) {
      const runId = office.state.jobs[job.id]?.run_ids.at(-1);
      if (runId) return void router.push({ name: "run", params: { id: runId } });
      await new Promise((r) => setTimeout(r, 100));
    }
    await router.push({ name: "job", params: { id: job.id } });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <PageHeader sign="Office" title="New job" description="Pick who should do it, then describe the work in plain words." />

    <!-- Empty room state (no agents) -->
    <div v-if="!enabledAgents.length" class="card max-w-lg mx-auto p-8 text-center space-y-4 my-8">
      <div class="mx-auto flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-accent border border-line">
        <Bot :size="24" />
      </div>
      <div class="space-y-1">
        <h3 class="font-semibold text-base text-fg">No agents in this room</h3>
        <p class="text-xs text-muted max-w-sm mx-auto">
          You need at least one enabled agent in this room to create and run jobs.
        </p>
      </div>
      <RouterLink to="/agents" class="btn btn-primary inline-flex min-h-10">
        Move or add agents to this room
      </RouterLink>
    </div>

    <form v-else class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]" @submit.prevent="submit">
      <div class="min-w-0 space-y-5">
        <fieldset>
          <legend class="label">Agent</legend>
          <div class="grid gap-2 sm:grid-cols-2">
            <label
              v-for="a in enabledAgents"
              :key="a.id"
              class="flex min-w-0 cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors"
              :class="agentId === a.id ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:bg-surface-2'"
            >
              <input v-model="agentId" type="radio" :value="a.id" class="sr-only" />
              <AgentAvatar :name="a.name" :slug="a.slug" :size="34" />
              <span class="min-w-0">
                <span class="block truncate text-sm font-medium">{{ a.name }}</span>
                <span class="block truncate text-xs text-muted">{{ a.role || a.model }}</span>
              </span>
            </label>
          </div>
        </fieldset>

        <fieldset v-if="isMarketing">
          <legend class="label">Kind of work</legend>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="t in MARKETING_JOB_TYPES"
              :key="t.type"
              type="button"
              class="chip cursor-pointer px-2.5 py-1"
              :class="jobType === t.type ? 'border-accent bg-accent-soft text-accent' : 'hover:bg-surface-2'"
              :aria-pressed="jobType === t.type"
              @click="jobType = t.type"
            >
              {{ t.label }}
            </button>
          </div>
          <p v-if="marketingType" class="mt-2 text-xs text-muted">
            Example:
            <button type="button" class="text-left text-accent hover:underline" @click="text = marketingType.example">“{{ marketingType.example }}”</button>
          </p>
        </fieldset>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="project">Project {{ needsRepo || isMarketing ? "· needed" : "· optional" }}</label>
            <select id="project" v-model="projectId" class="input" :required="needsRepo || (isMarketing && jobType !== 'content_calendar')">
              <option value="">No project</option>
              <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
            <p v-if="needsRepo && project && !project.repo_url" class="mt-1 text-xs text-signal">This project has no repo URL yet. Add one on the Projects page first.</p>
            <p v-if="isMarketing && project && !project.brief_path" class="mt-1 text-xs text-signal">
              No brief yet: Marketing will write general copy without prices. Fill in the brief on the Projects page.
            </p>
          </div>
          <div>
            <label class="label" for="title">Title · optional</label>
            <input id="title" v-model="title" class="input" maxlength="200" placeholder="e.g. Fix the booking page" />
          </div>
        </div>

        <div>
          <label class="label" for="text">What should it do?</label>
          <textarea
            id="text"
            v-model="text"
            class="input min-h-44 leading-relaxed"
            :class="asJson && 'font-mono text-xs'"
            required
            :placeholder="
              needsRepo
                ? 'Describe the bug or change. Include the page, what you expected and what happened.'
                : isMarketing
                  ? 'What to write, for which platform, any angle or promo. Paste example posts here if you want their style.'
                  : 'Describe the task or paste the text to work on…'
            "
          />
          <details class="mt-2 text-xs text-muted">
            <summary class="cursor-pointer hover:text-fg">Advanced</summary>
            <label class="mt-2 flex items-center gap-2"><input v-model="asJson" type="checkbox" class="accent-accent" /> Send the box above as raw JSON job input</label>
          </details>
        </div>
        <p v-if="error" class="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{{ error }}</p>
      </div>

      <aside class="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <div v-if="agent" class="card p-4">
          <div class="flex items-center gap-3">
            <AgentAvatar :name="agent.name" :slug="agent.slug" :size="40" />
            <div class="min-w-0">
              <div class="truncate font-semibold">{{ agent.name }}</div>
              <div class="truncate font-mono text-[11px] text-muted">{{ agent.provider }}:{{ agent.model }}</div>
            </div>
          </div>
          <div class="sign mt-4 mb-2">What happens next</div>
          <ol class="space-y-2 text-sm">
            <li v-for="(step, i) in plan" :key="i" class="flex gap-2.5">
              <span class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-[11px] text-muted">{{ i + 1 }}</span>
              <span class="text-muted">{{ step }}</span>
            </li>
          </ol>
        </div>
        <div class="flex gap-2">
          <button type="button" class="btn" @click="router.back()">Back</button>
          <button class="btn btn-primary flex-1 shadow-sm" :disabled="busy || !agentId || !text.trim()">
            <LoaderCircle v-if="busy" :size="14" class="motion-safe:animate-spin" />
            {{ busy ? "Starting…" : "Start job" }}
          </button>
        </div>
      </aside>
    </form>
  </div>
</template>
