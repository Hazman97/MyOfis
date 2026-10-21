<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ChevronUp, LoaderCircle, Square, X } from "lucide-vue-next";
import { api } from "../../api/http.ts";
import { useOffice } from "../../stores/office.ts";
import { fmtDuration, runStatus } from "../../runStatus.ts";
import AgentAvatar from "../AgentAvatar.vue";

/**
 * Live work queue button and popover / bottom sheet.
 * Shows running jobs with timer and step, and waiting jobs with queue position and reason.
 * Hidden when there are no running or waiting jobs.
 */
const office = useOffice();
const isOpen = ref(false);

const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(() => (now.value = Date.now()), 1000);
  window.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  window.removeEventListener("keydown", onKeydown);
});

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") isOpen.value = false;
}

const allJobs = computed(() => Object.values(office.state.jobs));

const runningJobs = computed(() =>
  allJobs.value
    .filter((j) => j.status === "running" || j.status === "waiting_approval")
    .sort((a, b) => a.created_at.localeCompare(b.created_at)),
);

const queuedJobs = computed(() =>
  allJobs.value
    .filter((j) => j.status === "queued")
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)),
);

const totalCount = computed(() => runningJobs.value.length + queuedJobs.value.length);

const agentOf = (id: string) => office.agentById[id];

async function stopJob(jobId: string) {
  await api.cancelJob(jobId);
}
</script>

<template>
  <div v-if="totalCount > 0">
    <!-- Desktop button in sidebar bottom area -->
    <button
      type="button"
      class="w-full flex items-center justify-between rounded-xl border border-line bg-surface-2/60 px-2.5 py-2 text-xs hover:border-line-strong hover:bg-surface-2 transition-colors cursor-pointer group text-left select-none"
      :aria-expanded="isOpen"
      aria-label="Work queue"
      @click="isOpen = !isOpen"
    >
      <div class="flex items-center gap-2 min-w-0">
        <span
          class="size-2 rounded-full shrink-0"
          :class="runningJobs.length ? 'bg-accent shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse' : 'bg-signal'"
        />
        <div class="min-w-0">
          <div class="sign text-[9px]">Queue</div>
          <div class="mt-0.5 font-mono text-xs font-semibold tabular-nums text-fg truncate">
            {{ runningJobs.length }} running · {{ queuedJobs.length }} waiting
          </div>
        </div>
      </div>
      <ChevronUp
        :size="14"
        class="text-muted group-hover:text-fg shrink-0 transition-transform duration-200"
        :class="isOpen && 'rotate-180'"
      />
    </button>

    <!-- Mobile floating trigger pill (when lg:hidden and queue has items) -->
    <Teleport to="body">
      <div v-if="totalCount > 0" class="lg:hidden fixed bottom-18 left-3 z-30">
        <button
          type="button"
          class="flex items-center gap-2 rounded-full border border-line bg-surface/95 px-3 py-2 text-xs font-semibold shadow-card backdrop-blur-md text-fg hover:border-accent active:scale-95 transition-all min-h-10 cursor-pointer"
          :aria-expanded="isOpen"
          aria-label="View work queue"
          @click="isOpen = !isOpen"
        >
          <span
            class="size-2 rounded-full shrink-0"
            :class="runningJobs.length ? 'bg-accent shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse' : 'bg-signal'"
          />
          <span class="font-mono text-[11px] tabular-nums">
            {{ runningJobs.length }} running · {{ queuedJobs.length }} waiting
          </span>
        </button>
      </div>
    </Teleport>

    <!-- Queue popover (Desktop) / Bottom sheet (Phone) -->
    <Teleport to="body">
      <div v-if="isOpen" class="fixed inset-0 z-50 flex flex-col justify-end lg:justify-start lg:pointer-events-none">
        <!-- Backdrop -->
        <div
          class="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity lg:pointer-events-auto"
          aria-hidden="true"
          @click="isOpen = false"
        />

        <!-- Sheet (Mobile) / Popover (Desktop) -->
        <div
          class="relative z-10 w-full max-h-[85vh] rounded-t-2xl border-t border-line bg-surface p-4 shadow-2xl flex flex-col overflow-hidden lg:pointer-events-auto lg:fixed lg:left-62 lg:bottom-4 lg:w-96 lg:max-h-[80vh] lg:rounded-2xl lg:border lg:border-line"
          role="dialog"
          aria-modal="true"
          aria-label="Work Queue"
        >
          <!-- Header -->
          <div class="flex items-center justify-between pb-3 border-b border-line shrink-0">
            <div class="flex items-center gap-2">
              <span class="sign text-xs">Work Queue</span>
              <span class="chip chip-sm text-[10px] font-mono font-semibold bg-surface-2 border-line text-muted">
                {{ runningJobs.length }} running · {{ queuedJobs.length }} waiting
              </span>
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-sm min-h-10 min-w-10 sm:min-h-7 sm:min-w-7 sm:size-7 p-0 text-muted hover:text-fg rounded-lg cursor-pointer flex items-center justify-center"
              aria-label="Close"
              title="Close queue"
              @click="isOpen = false"
            >
              <X :size="15" />
            </button>
          </div>

          <!-- Scrollable Body -->
          <div class="overflow-y-auto space-y-4 py-3 min-w-0 flex-1">
            <!-- Running Section -->
            <div v-if="runningJobs.length" class="space-y-2">
              <div class="sign text-[10px] uppercase tracking-wider text-accent font-semibold flex items-center gap-1.5">
                <span class="size-1.5 rounded-full bg-accent animate-pulse" />
                Running ({{ runningJobs.length }})
              </div>

              <div class="space-y-2">
                <div
                  v-for="j in runningJobs"
                  :key="j.id"
                  class="rounded-xl border border-line bg-surface-2/40 p-2.5 space-y-2"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="flex items-center gap-2 min-w-0 flex-1">
                      <AgentAvatar
                        :name="agentOf(j.agent_id)?.name ?? j.agent_id"
                        :slug="agentOf(j.agent_id)?.slug ?? j.agent_id"
                        :size="22"
                        class="shrink-0"
                      />
                      <div class="min-w-0 flex-1">
                        <div class="text-xs font-semibold text-fg truncate">
                          {{ agentOf(j.agent_id)?.name ?? j.agent_id }}
                        </div>
                        <div class="text-[11px] text-muted truncate font-mono" :title="j.title">
                          {{ j.title }}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      class="btn btn-ghost btn-sm min-h-10 sm:min-h-7 px-2 text-danger hover:bg-danger-soft/40 text-xs shrink-0 cursor-pointer"
                      title="Stop this job"
                      @click="stopJob(j.id)"
                    >
                      <Square :size="11" /> Stop
                    </button>
                  </div>

                  <!-- Run status line -->
                  <div class="flex items-center justify-between text-xs pt-1.5 border-t border-line/40 text-muted">
                    <span class="flex items-center gap-1.5 text-accent font-medium text-[11.5px] truncate">
                      <LoaderCircle :size="12" class="animate-spin shrink-0" />
                      {{ runStatus(office.state, j.id, now).label }}
                    </span>
                    <span class="font-mono tabular-nums text-faint text-[11px] shrink-0 ml-2">
                      {{ fmtDuration(runStatus(office.state, j.id, now).seconds) }}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Waiting Section -->
            <div v-if="queuedJobs.length" class="space-y-2">
              <div class="sign text-[10px] uppercase tracking-wider text-muted font-semibold flex items-center gap-1.5">
                <span class="size-1.5 rounded-full bg-signal" />
                Waiting in line ({{ queuedJobs.length }})
              </div>

              <div class="space-y-2">
                <div
                  v-for="(j, idx) in queuedJobs"
                  :key="j.id"
                  class="rounded-xl border border-line bg-surface-2/30 p-2.5 space-y-1.5"
                >
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2 min-w-0 flex-1">
                      <span class="chip chip-sm font-mono text-[10px] font-bold bg-surface-2 border-line text-fg shrink-0">
                        #{{ idx + 1 }}
                      </span>
                      <AgentAvatar
                        :name="agentOf(j.agent_id)?.name ?? j.agent_id"
                        :slug="agentOf(j.agent_id)?.slug ?? j.agent_id"
                        :size="18"
                        class="shrink-0"
                      />
                      <span class="text-xs font-semibold text-fg truncate">
                        {{ agentOf(j.agent_id)?.name ?? j.agent_id }}
                      </span>
                      <span class="text-[11px] text-muted truncate flex-1 min-w-0" :title="j.title">
                        "{{ j.title }}"
                      </span>
                    </div>

                    <button
                      type="button"
                      class="btn btn-ghost btn-sm min-h-10 min-w-10 sm:min-h-7 sm:min-w-7 p-0 text-muted hover:text-danger shrink-0 cursor-pointer flex items-center justify-center"
                      title="Cancel job"
                      @click="stopJob(j.id)"
                    >
                      <X :size="12" />
                    </button>
                  </div>

                  <!-- Reason from detail -->
                  <p class="text-[11px] text-muted leading-relaxed font-normal bg-surface/60 rounded-md p-1.5 border border-line/40">
                    {{ runStatus(office.state, j.id, now).detail ?? "Waiting for runner to be free." }}
                  </p>
                </div>
              </div>
            </div>

            <!-- Empty State -->
            <div v-if="!runningJobs.length && !queuedJobs.length" class="py-8 text-center text-xs text-muted">
              No jobs running or waiting right now.
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
