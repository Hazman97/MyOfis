<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { Check, Clapperboard, Sparkles } from "lucide-vue-next";
import type { EditPlan, EditSuggestion, EditSuggestions } from "@agent-office/shared";

/**
 * EditSuggestionCards (Task 015):
 * Renders Editor's edit options (tool suggest_edits) in two modes:
 * - "chat": inside ChatView, allows picking an option ("Pick A") or opening the video in studio.
 * - "studio": inside VideoStudioView / AskEditorPanel, allows applying to timeline ("Use in timeline").
 */
const props = defineProps<{
  suggestions: EditSuggestions;
  mode: "chat" | "studio";
}>();

defineEmits<{
  (e: "pick", key: string): void;
  (e: "use", option: EditSuggestion): void;
}>();

function optionDuration(plan: EditPlan): string {
  let total = 0;
  for (const c of plan.clips) {
    if (c.end === undefined || c.end === null) return "full";
    total += Math.max(0, (c.end - c.start) / (c.speed || 1));
  }
  return `${Math.round(total * 10) / 10}s`;
}

const studioAttachmentId = computed(() => props.suggestions.attachments?.[0]?.id ?? null);
</script>

<template>
  <div class="space-y-3">
    <!-- Intro box -->
    <div v-if="suggestions.intro" class="rounded-xl border border-accent/25 bg-accent/5 p-3 text-xs leading-relaxed text-fg">
      <div class="sign mb-1 flex items-center gap-1.5 font-semibold text-accent">
        <Sparkles :size="12" /> Editor's suggestions
      </div>
      <p class="text-fg/90">{{ suggestions.intro }}</p>
    </div>

    <!-- Options grid / stack -->
    <div class="space-y-2.5">
      <div
        v-for="opt in suggestions.options"
        :key="opt.key"
        class="card p-3.5 space-y-2.5 border-line bg-surface/80 hover:border-line-strong transition-all"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-start gap-2.5 min-w-0">
            <span class="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent text-accent-ink font-bold font-mono text-xs shadow-xs">
              {{ opt.key }}
            </span>
            <div class="min-w-0">
              <h4 class="font-semibold text-xs sm:text-sm text-fg leading-snug truncate">
                {{ opt.title }}
              </h4>
              <p class="text-xs text-muted mt-0.5 leading-relaxed">
                {{ opt.why }}
              </p>
            </div>
          </div>

          <!-- Action Button -->
          <div class="shrink-0">
            <button
              v-if="mode === 'chat'"
              type="button"
              class="btn btn-sm btn-primary min-h-8 px-3 text-xs font-semibold cursor-pointer"
              @click="$emit('pick', opt.key)"
            >
              Pick {{ opt.key }}
            </button>
            <button
              v-else
              type="button"
              class="btn btn-sm btn-primary min-h-8 px-3 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              @click="$emit('use', opt)"
            >
              <Check :size="13" /> Use in timeline
            </button>
          </div>
        </div>

        <!-- Metric chips -->
        <div class="flex flex-wrap items-center gap-1.5 pt-2 border-t border-line/40 text-[11px]">
          <span class="chip chip-sm text-[10px]">{{ opt.plan.preset }}</span>
          <span class="chip chip-sm text-[10px] font-mono">{{ optionDuration(opt.plan) }}</span>
          <span class="chip chip-sm text-[10px]">
            {{ opt.plan.clips.length }} clip{{ opt.plan.clips.length === 1 ? '' : 's' }}
          </span>
          <span
            v-if="opt.plan.subtitles"
            class="chip chip-sm text-[10px] text-accent bg-accent/10 border-accent/20"
          >
            Subtitles ({{ opt.plan.subtitles.style }})
          </span>
          <span v-else class="chip chip-sm text-[10px] text-muted">
            No subtitles
          </span>
          <span v-if="opt.plan.captions?.length" class="chip chip-sm text-[10px]">
            {{ opt.plan.captions.length }} captions
          </span>
        </div>
      </div>
    </div>

    <!-- Chat mode Open in Studio link -->
    <div v-if="mode === 'chat' && studioAttachmentId" class="flex justify-end pt-1">
      <RouterLink
        :to="{ name: 'studio', params: { id: studioAttachmentId } }"
        class="inline-flex items-center gap-1.5 text-xs text-accent hover:underline font-medium min-h-8 px-2"
      >
        <Clapperboard :size="13" /> Open in Video Studio
      </RouterLink>
    </div>
  </div>
</template>
