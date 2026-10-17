<script setup lang="ts">
import { computed, ref } from "vue";
import { Check, Copy, ShieldCheck, TriangleAlert, X } from "lucide-vue-next";
import type { ContentDraft } from "@agent-office/shared";
import AgentAvatar from "./AgentAvatar.vue";
import StatusBadge from "./StatusBadge.vue";
import { api } from "../api/http.ts";
import { useOffice } from "../stores/office.ts";
import { fmtDateTime } from "../format.ts";

/** One Marketing draft: edit it in place, approve (with or without edits) or reject with feedback, copy it out. */
const props = defineProps<{ draft: ContentDraft; projectName?: string }>();
const emit = defineEmits<{ decided: [draft: ContentDraft] }>();
const office = useOffice();

const body = ref(props.draft.body);
const feedback = ref("");
const mode = ref<"idle" | "reject">("idle");
const busy = ref(false);
const error = ref("");
const copied = ref(false);
const showOriginal = ref(false);

const agent = computed(() => office.agentById[props.draft.agent_id]);
const pending = computed(() => props.draft.status === "draft");
const edited = computed(() => body.value.trim() !== props.draft.original_body.trim());
const rows = computed(() => Math.min(18, Math.max(4, body.value.split("\n").length + 1)));

const PLATFORM: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
  youtube: "YouTube",
  whatsapp: "WhatsApp",
  landing_page: "Landing page",
  general: "General",
};
const kindLabel = (k: string) => k.replace(/_/g, " ");

const checks = computed(() => {
  const c = props.draft.self_check;
  if (!c) return [];
  return [
    { ok: c.facts_match_brief, label: "facts from brief" },
    { ok: c.only_released_features, label: "released features only" },
    { ok: c.no_overclaims, label: "no overclaims" },
    { ok: c.tone_and_language_match, label: "tone + language" },
  ];
});

async function copy() {
  try {
    await navigator.clipboard.writeText(body.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    error.value = "Could not copy: select the text and copy it by hand.";
  }
}

async function decide(decision: "approve" | "reject") {
  busy.value = true;
  error.value = "";
  try {
    const fb = feedback.value.trim() || undefined;
    const { draft } = await api.decideDraft(
      props.draft.id,
      decision === "approve" ? { decision, body: edited.value ? body.value : undefined, feedback: fb } : { decision, feedback: fb },
    );
    emit("decided", draft);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <article class="card overflow-hidden" :class="pending ? 'shadow-card' : 'opacity-90'">
    <header class="flex flex-wrap items-center gap-2 px-4 pt-3.5">
      <AgentAvatar :name="agent?.name ?? 'Marketing'" :slug="agent?.slug" :size="26" />
      <span class="chip border-accent/40 text-accent">{{ PLATFORM[draft.platform] ?? draft.platform }}</span>
      <span class="chip capitalize">{{ kindLabel(draft.kind) }}</span>
      <span v-if="projectName" class="text-sm text-muted">{{ projectName }}</span>
      <span class="ml-auto text-xs text-faint">{{ fmtDateTime(draft.created_at) }}</span>
    </header>
    <h3 class="px-4 pt-2 font-medium">{{ draft.title }}</h3>

    <div class="px-4 pt-2">
      <textarea
        v-if="pending"
        v-model="body"
        :rows="rows"
        class="input font-sans text-[14px] leading-relaxed"
        :aria-label="`Draft text: ${draft.title}`"
      />
      <p v-else class="rounded-md border border-line bg-sunken px-3 py-2 text-[14px] leading-relaxed whitespace-pre-wrap">{{ draft.body }}</p>
      <p v-if="pending && draft.kind === 'style_guide'" class="mt-1.5 text-xs text-info">Approving saves this as the project brief's style notes.</p>
      <p v-if="pending && edited" class="mt-1.5 text-xs text-review">Edited. Your version is saved and Marketing learns from the change.</p>
    </div>

    <div v-if="checks.length" class="flex flex-wrap items-center gap-1.5 px-4 pt-2.5 text-[11px]">
      <ShieldCheck :size="13" class="text-faint" />
      <span v-for="c in checks" :key="c.label" class="chip" :class="c.ok ? '' : 'border-danger/40 text-danger'">{{ c.ok ? "✓" : "✗" }} {{ c.label }}</span>
    </div>
    <p v-if="draft.self_check?.notes" class="mx-4 mt-2 flex gap-1.5 rounded-md bg-signal-soft px-3 py-2 text-xs text-signal">
      <TriangleAlert :size="14" class="mt-px shrink-0" />{{ draft.self_check.notes }}
    </p>

    <div v-if="!pending" class="px-4 pt-2.5 text-xs text-muted">
      <p v-if="draft.owner_feedback"><span class="font-medium text-fg">Your feedback:</span> {{ draft.owner_feedback }}</p>
      <button v-if="draft.status === 'edited'" class="mt-1 text-accent hover:underline" @click="showOriginal = !showOriginal">
        {{ showOriginal ? "Hide" : "Show" }} Marketing's original
      </button>
      <p v-if="showOriginal" class="mt-1.5 rounded-md border border-dashed border-line px-3 py-2 whitespace-pre-wrap">{{ draft.original_body }}</p>
    </div>

    <div v-if="pending" class="px-4 pt-2.5">
      <label class="label" :for="`fb-${draft.id}`">{{ mode === "reject" ? "What is wrong? (Marketing reads this next time)" : "Feedback · optional" }}</label>
      <input :id="`fb-${draft.id}`" v-model="feedback" class="input" :placeholder="mode === 'reject' ? 'e.g. too salesy, price is wrong, use more Manglish' : 'e.g. love the hook, keep it this short'" />
    </div>

    <p v-if="error" class="mx-4 mt-2 text-sm text-danger">{{ error }}</p>

    <footer class="mt-3 flex flex-wrap items-center gap-2 border-t border-line bg-surface-2/50 px-4 py-2.5">
      <button class="btn btn-sm" @click="copy"><component :is="copied ? Check : Copy" :size="13" /> {{ copied ? "Copied" : "Copy" }}</button>
      <template v-if="pending">
        <template v-if="mode === 'reject'">
          <button class="btn btn-sm btn-ghost ml-auto" :disabled="busy" @click="mode = 'idle'">Back</button>
          <button class="btn btn-sm btn-danger" :disabled="busy" @click="decide('reject')"><X :size="13" /> Reject</button>
        </template>
        <template v-else>
          <button class="btn btn-sm btn-danger ml-auto" :disabled="busy" @click="mode = 'reject'"><X :size="13" /> Reject…</button>
          <button class="btn btn-sm btn-primary" :disabled="busy || !body.trim()" @click="decide('approve')">
            <Check :size="13" /> {{ edited ? "Approve my edit" : "Approve" }}
          </button>
        </template>
      </template>
      <span v-else class="ml-auto inline-flex items-center gap-2 text-xs text-muted">
        <StatusBadge :status="draft.status" />
        <template v-if="draft.decided_at">{{ fmtDateTime(draft.decided_at) }}</template>
      </span>
    </footer>
  </article>
</template>
