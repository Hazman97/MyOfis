<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { Project } from "@agent-office/shared";
import AgentAvatar from "../components/AgentAvatar.vue";
import PageHeader from "../components/PageHeader.vue";
import { api } from "../api/http.ts";
import { useOffice } from "../stores/office.ts";

const office = useOffice();
const router = useRouter();
const route = useRoute();

const agentId = ref(typeof route.query.agent === "string" ? route.query.agent : "");
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
  if (!agentId.value && enabledAgents.value[0]) agentId.value = enabledAgents.value[0].id;
});
const agent = computed(() => office.agentById[agentId.value]);
const needsRepo = computed(() => agent.value?.config.runtime === "opencode");
const project = computed(() => projects.value.find((p) => p.id === projectId.value));

const plan = computed(() => {
  const a = agent.value;
  if (!a) return [];
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
    a.permission_level === "safe" ? "Asks you before writing files" : "Writes in its own workspace without asking",
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
      title: title.value.trim() || (asJson.value ? "JSON job" : text.value.trim().slice(0, 60)) || "Untitled job",
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

    <form class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]" @submit.prevent="submit">
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

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="project">Project {{ needsRepo ? "· needed" : "· optional" }}</label>
            <select id="project" v-model="projectId" class="input" :required="needsRepo">
              <option value="">No project</option>
              <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
            <p v-if="needsRepo && project && !project.repo_url" class="mt-1 text-xs text-signal">This project has no repo URL yet. Add one on the Projects page first.</p>
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
            :placeholder="needsRepo ? 'Describe the bug or change. Include the page, what you expected and what happened.' : 'Describe the task or paste the text to work on…'"
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
          <button class="btn btn-primary flex-1" :disabled="busy || !agentId || !text.trim()">{{ busy ? "Starting…" : "Start job" }}</button>
        </div>
      </aside>
    </form>
  </div>
</template>
