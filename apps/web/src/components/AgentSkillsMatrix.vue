<script setup lang="ts">
import { computed, ref } from "vue";
import {
  Check,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  SlidersHorizontal,
  Sparkles,
} from "lucide-vue-next";
import { api, type SkillAssignments } from "../api/http.ts";
import AgentAvatar from "./AgentAvatar.vue";

/**
 * AgentSkillsMatrix (Task 016):
 * Collapsible matrix allowing owners to configure skill access per agent.
 * - Segmented control: All skills vs Choose.
 * - Desktop: Compact matrix table with sticky agent column and skill checkboxes.
 * - Mobile (<640px): Stacked agent cards with full tap targets (>= 40px) and no horizontal scroll.
 */
const props = defineProps<{
  assignments: SkillAssignments;
}>();

const emit = defineEmits<{
  (e: "updated"): void;
}>();

const collapsed = ref(false);
const busyAgentId = ref<string | null>(null);
const error = ref("");

function isAll(agent: SkillAssignments["agents"][number]): boolean {
  return agent.skills === "all";
}

function agentHasSkill(agent: SkillAssignments["agents"][number], skillName: string): boolean {
  if (agent.skills === "all") return true;
  return Array.isArray(agent.skills) && agent.skills.includes(skillName);
}

async function setAgentSkills(agentId: string, skills: "all" | string[]) {
  error.value = "";
  busyAgentId.value = agentId;
  try {
    await api.setAgentSkills(agentId, skills);
    emit("updated");
  } catch (e) {
    error.value = (e as Error).message;
    emit("updated");
  } finally {
    busyAgentId.value = null;
  }
}

async function switchToAll(agent: SkillAssignments["agents"][number]) {
  if (isAll(agent)) return;
  await setAgentSkills(agent.id, "all");
}

async function switchToChoose(agent: SkillAssignments["agents"][number]) {
  if (!isAll(agent)) return;
  // Start with all currently existing skills so user can uncheck what they don't want
  await setAgentSkills(agent.id, [...props.assignments.skills]);
}

async function toggleSkill(agent: SkillAssignments["agents"][number], skillName: string) {
  const currentList = isAll(agent)
    ? [...props.assignments.skills]
    : Array.isArray(agent.skills)
      ? [...agent.skills]
      : [];

  const nextList = currentList.includes(skillName)
    ? currentList.filter((s) => s !== skillName)
    : [...currentList, skillName];

  await setAgentSkills(agent.id, nextList);
}
</script>

<template>
  <div class="card overflow-hidden border-line bg-surface/90 shadow-card transition-all">
    <!-- Header / Toggle -->
    <header
      class="flex flex-wrap items-center justify-between gap-3 p-3.5 sm:p-4 cursor-pointer select-none hover:bg-surface-2/40 transition-colors"
      @click="collapsed = !collapsed"
    >
      <div class="flex items-center gap-2.5 min-w-0">
        <div class="flex size-7 items-center justify-center rounded-lg bg-accent/10 text-accent shrink-0">
          <SlidersHorizontal :size="15" />
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h3 class="text-xs sm:text-sm font-semibold text-fg tracking-tight">
              Skills per agent
            </h3>
            <span class="chip chip-sm text-[10px] font-mono">
              {{ assignments.agents.length }} agents · {{ assignments.skills.length }} skills
            </span>
          </div>
          <p class="text-[11px] text-muted truncate mt-0.5">
            Choose whether agents get all skills automatically or a custom set.
          </p>
        </div>
      </div>

      <button
        type="button"
        class="btn btn-ghost btn-sm size-8 p-0 text-muted hover:text-fg rounded-lg shrink-0"
        :aria-label="collapsed ? 'Expand section' : 'Collapse section'"
      >
        <ChevronDown v-if="!collapsed" :size="16" />
        <ChevronRight v-else :size="16" />
      </button>
    </header>

    <!-- Error message -->
    <div v-if="error" class="px-4 py-2 bg-danger-soft text-danger text-xs border-t border-danger/20">
      {{ error }}
    </div>

    <!-- Body content -->
    <div v-if="!collapsed" class="border-t border-line/60">
      <!-- Empty state if no agents or no skills -->
      <div v-if="!assignments.agents.length || !assignments.skills.length" class="p-6 text-center text-xs text-muted">
        {{ !assignments.agents.length ? "No agents found in this room." : "No skills installed yet. Add or import skills above." }}
      </div>

      <template v-else>
        <!-- Desktop Matrix View (sm and up) -->
        <div class="hidden sm:block overflow-x-auto">
          <table class="w-full border-collapse text-left text-xs">
            <thead>
              <tr class="border-b border-line bg-surface-2/50 text-[11px] font-semibold text-muted">
                <th class="sticky left-0 z-10 bg-surface-2/95 px-4 py-2.5 backdrop-blur-xs min-w-[220px]">
                  Agent & Mode
                </th>
                <th
                  v-for="skill in assignments.skills"
                  :key="skill"
                  class="px-3 py-2.5 font-mono text-center font-medium max-w-[140px] truncate"
                  :title="skill"
                >
                  {{ skill }}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line/60">
              <tr
                v-for="agent in assignments.agents"
                :key="agent.id"
                class="hover:bg-surface-2/30 transition-colors"
                :class="!agent.enabled && 'opacity-60'"
              >
                <!-- Sticky Agent column -->
                <td class="sticky left-0 z-10 bg-surface/95 px-4 py-3 backdrop-blur-xs border-r border-line/40">
                  <div class="flex items-center justify-between gap-3">
                    <div class="flex items-center gap-2 min-w-0">
                      <AgentAvatar :name="agent.name" :slug="agent.slug" :size="24" class="shrink-0" />
                      <div class="min-w-0">
                        <div class="font-medium text-fg truncate text-xs">{{ agent.name }}</div>
                        <span v-if="!agent.reads_skills" class="text-[10px] text-faint block">
                          needs skill tool
                        </span>
                      </div>
                    </div>

                    <!-- Segmented Control: All / Choose -->
                    <div class="inline-flex rounded-lg border border-line bg-surface-2/80 p-0.5 shrink-0 select-none">
                      <button
                        type="button"
                        class="px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer"
                        :class="isAll(agent) ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-fg'"
                        :disabled="busyAgentId === agent.id"
                        @click="switchToAll(agent)"
                      >
                        All
                      </button>
                      <button
                        type="button"
                        class="px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer"
                        :class="!isAll(agent) ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-fg'"
                        :disabled="busyAgentId === agent.id"
                        @click="switchToChoose(agent)"
                      >
                        Choose
                      </button>
                    </div>
                  </div>
                </td>

                <!-- Skills Columns Checkboxes -->
                <td
                  v-for="skill in assignments.skills"
                  :key="skill"
                  class="px-3 py-3 text-center align-middle"
                >
                  <label class="inline-flex items-center justify-center size-8 mx-auto cursor-pointer select-none">
                    <input
                      type="checkbox"
                      class="accent-accent size-4 cursor-pointer transition-transform active:scale-95"
                      :checked="agentHasSkill(agent, skill)"
                      :disabled="busyAgentId === agent.id || isAll(agent)"
                      :title="isAll(agent) ? `${agent.name} gets all skills` : `Toggle ${skill} for ${agent.name}`"
                      @change="toggleSkill(agent, skill)"
                    />
                  </label>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Mobile Stacked View (<640px) -->
        <div class="block sm:hidden divide-y divide-line/60">
          <div
            v-for="agent in assignments.agents"
            :key="agent.id"
            class="p-3.5 space-y-3"
            :class="!agent.enabled && 'opacity-60'"
          >
            <!-- Agent Header & Mode Toggle -->
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 min-w-0">
                <AgentAvatar :name="agent.name" :slug="agent.slug" :size="28" class="shrink-0" />
                <div class="min-w-0">
                  <div class="font-semibold text-xs text-fg truncate">{{ agent.name }}</div>
                  <span v-if="!agent.reads_skills" class="text-[10px] text-faint block">
                    can't read skills yet
                  </span>
                </div>
              </div>

              <!-- Segmented Control with >= 40px touch targets -->
              <div class="inline-flex rounded-lg border border-line bg-surface-2 p-0.5 shrink-0 select-none">
                <button
                  type="button"
                  class="min-h-9 px-3 rounded-md text-xs font-semibold transition-all cursor-pointer flex items-center justify-center"
                  :class="isAll(agent) ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-fg'"
                  :disabled="busyAgentId === agent.id"
                  @click="switchToAll(agent)"
                >
                  All skills
                </button>
                <button
                  type="button"
                  class="min-h-9 px-3 rounded-md text-xs font-semibold transition-all cursor-pointer flex items-center justify-center"
                  :class="!isAll(agent) ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-fg'"
                  :disabled="busyAgentId === agent.id"
                  @click="switchToChoose(agent)"
                >
                  Choose
                </button>
              </div>
            </div>

            <!-- "All skills" active notice -->
            <div
              v-if="isAll(agent)"
              class="rounded-lg border border-accent/20 bg-accent/5 p-2.5 text-xs text-fg flex items-center gap-2"
            >
              <Sparkles :size="13" class="text-accent shrink-0" />
              <span class="text-muted text-[11px]">
                Gets all {{ assignments.skills.length }} skills automatically (including future additions).
              </span>
            </div>

            <!-- "Choose" active: Checkbox items list -->
            <div v-else class="space-y-1.5 pt-1">
              <div
                v-for="skill in assignments.skills"
                :key="skill"
                class="flex items-center justify-between min-h-10 px-2.5 rounded-lg border border-line bg-surface-2/30 hover:border-line-strong transition-all select-none cursor-pointer"
                @click="toggleSkill(agent, skill)"
              >
                <span class="font-mono text-xs text-fg truncate pr-2">{{ skill }}</span>
                <input
                  type="checkbox"
                  class="accent-accent size-4.5 cursor-pointer pointer-events-none"
                  :checked="agentHasSkill(agent, skill)"
                  :disabled="busyAgentId === agent.id"
                />
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
