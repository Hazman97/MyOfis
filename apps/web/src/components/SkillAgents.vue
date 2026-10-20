<script setup lang="ts">
import { computed, ref } from "vue";
import { LoaderCircle, Users } from "lucide-vue-next";
import { api, type SkillAssignments } from "../api/http.ts";
import AgentAvatar from "./AgentAvatar.vue";

/**
 * SkillAgents (Task 016):
 * Per-skill assignment control displayed within each skill card.
 * - Shows which agents get this skill.
 * - Tap an agent chip to toggle assignment.
 * - Quick buttons: "All agents" and "None".
 * - Small marks for "all skills" and "can't read skills yet".
 */
const props = defineProps<{
  skillName: string;
  assignments: SkillAssignments;
}>();

const emit = defineEmits<{
  (e: "updated"): void;
}>();

const busy = ref(false);
const error = ref("");

function agentHasSkill(agent: SkillAssignments["agents"][number]): boolean {
  // without the skill tools an agent sees no skills, whatever its setting says
  if (!agent.reads_skills) return false;
  if (agent.skills === "all") return true;
  return Array.isArray(agent.skills) && agent.skills.includes(props.skillName);
}

const assignedAgents = computed(() =>
  props.assignments.agents.filter((a) => agentHasSkill(a)),
);

const assignedCount = computed(() => assignedAgents.value.length);
const allAssigned = computed(
  () => props.assignments.agents.length > 0 && assignedCount.value === props.assignments.agents.length,
);
const noneAssigned = computed(() => assignedCount.value === 0);

async function updateAgents(agentIds: string[]) {
  error.value = "";
  busy.value = true;
  try {
    await api.setSkillAgents(props.skillName, agentIds);
    emit("updated");
  } catch (e) {
    error.value = (e as Error).message;
    emit("updated");
  } finally {
    busy.value = false;
  }
}

async function toggleAgent(agentId: string) {
  const currentIds = assignedAgents.value.map((a) => a.id);
  const nextIds = currentIds.includes(agentId)
    ? currentIds.filter((id) => id !== agentId)
    : [...currentIds, agentId];
  await updateAgents(nextIds);
}

async function assignAll() {
  const allIds = props.assignments.agents.map((a) => a.id);
  await updateAgents(allIds);
}

async function assignNone() {
  await updateAgents([]);
}

function chipTitle(agent: SkillAssignments["agents"][number]): string {
  const parts: string[] = [agent.name];
  if (agent.skills === "all") parts.push("Receives all skills");
  if (!agent.reads_skills) parts.push("Will get skill tools when assigned");
  if (!agent.enabled) parts.push("Agent disabled in room");
  return parts.join(" · ");
}
</script>

<template>
  <div class="space-y-2 select-none">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-1.5">
        <span class="sign text-[10px] text-faint font-semibold tracking-wider flex items-center gap-1">
          <Users :size="11" />
          Used by
        </span>
        <span class="chip chip-sm text-[10px] font-mono">
          {{ assignedCount }}/{{ assignments.agents.length }}
        </span>
        <LoaderCircle v-if="busy" :size="12" class="animate-spin text-accent ml-1" />
      </div>

      <!-- Quick Actions -->
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="btn btn-ghost btn-sm text-[11px] h-6 px-2 text-muted hover:text-fg cursor-pointer"
          :disabled="busy || allAssigned"
          @click="assignAll"
        >
          All agents
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm text-[11px] h-6 px-2 text-muted hover:text-danger cursor-pointer"
          :disabled="busy || noneAssigned"
          @click="assignNone"
        >
          None
        </button>
      </div>
    </div>

    <!-- Error message -->
    <p v-if="error" class="text-[11px] text-danger">{{ error }}</p>

    <!-- Agent chips -->
    <div class="flex flex-wrap items-center gap-1.5 pt-0.5">
      <button
        v-for="agent in assignments.agents"
        :key="agent.id"
        type="button"
        class="inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-all cursor-pointer"
        :class="[
          !agent.enabled ? 'opacity-55' : '',
          agentHasSkill(agent)
            ? 'border-accent/40 bg-accent/10 text-accent font-medium shadow-xs'
            : 'border-line bg-surface-2/40 text-muted hover:border-line-strong hover:text-fg',
        ]"
        :disabled="busy"
        :title="chipTitle(agent)"
        @click="toggleAgent(agent.id)"
      >
        <AgentAvatar
          :name="agent.name"
          :slug="agent.slug"
          :size="18"
          class="shrink-0"
        />
        <span class="truncate max-w-30">{{ agent.name }}</span>

        <span
          v-if="agent.skills === 'all'"
          class="rounded bg-accent/20 px-1 text-[9px] font-mono font-semibold text-accent"
          title="Receives all skills"
        >
          all
        </span>
        <span
          v-else-if="!agent.reads_skills"
          class="text-[9px] text-faint"
          title="Will get skill tools when assigned"
        >
          can't read skills yet
        </span>
      </button>
    </div>
  </div>
</template>
