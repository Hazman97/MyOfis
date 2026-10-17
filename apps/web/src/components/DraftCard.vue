<script setup lang="ts">
import { computed, ref } from "vue";
import { Check, Copy, LoaderCircle, ShieldCheck, TriangleAlert, X } from "lucide-vue-next";
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
  website: "Website",
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

// Website posts (Publisher): approving publishes them; a failed publish can be retried
const isWebPost = computed(() => props.draft.kind === "web_post" && !!props.draft.meta);
const eventLine = computed(() => {
  const m = props.draft.meta;
  return m ? [m.event_date, m.event_time, m.location].filter(Boolean).join(" · ") : "";
});
async function publishAgain() {
  busy.value = true;
  error.value = "";
  try {
    emit("decided", (await api.publishDraft(props.draft.id)).draft);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

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
  <article class="card overflow-hidden transition-all duration-200" :class="pending ? 'shadow-card' : 'opacity-85'">
    <header class="flex flex-wrap items-center gap-2 border-b border-line/60 bg-surface-2/30 px-4 py-3">
      <AgentAvatar :name="agent?.name ?? 'Marketing'" :slug="agent?.slug" :size="26" />
      <span class="chip border-accent/40 bg-accent/10 text-accent font-semibold text-[11px]">{{ PLATFORM[draft.platform] ?? draft.platform }}</span>
      <span class="chip capitalize text-[11px] text-muted">{{ kindLabel(draft.kind) }}</span>
      <span v-if="projectName" class="text-xs font-medium text-muted">· {{ projectName }}</span>
      <span class="ml-auto font-mono text-[11px] text-faint">{{ fmtDateTime(draft.created_at) }}</span>
    </header>
    <h3 class="px-4 pt-3 font-semibold text-sm tracking-tight text-fg">{{ draft.title }}</h3>
    <div v-if="isWebPost && draft.meta" class="px-4 pt-2.5 space-y-2">
      <img v-if="draft.meta.cover_upload_id" :src="api.uploadUrl(draft.meta.cover_upload_id)" alt="Cover photo" class="max-h-56 w-full rounded-lg border border-line object-cover" />
      <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span class="chip">{{ draft.meta.post_type }}</span>
        <span v-if="eventLine" class="chip">{{ eventLine }}</span>
        <span v-for="t in draft.meta.tags" :key="t" class="chip text-muted">#{{ t }}</span>
      </div>
      <p v-if="draft.meta.excerpt" class="text-sm text-muted italic">{{ draft.meta.excerpt }}</p>
      <p v-if="pending" class="text-xs text-info">Approving publishes this post to the website.</p>
    </div>

    <div class="px-4 pt-2.5">
      <textarea
        v-if="pending"
        v-model="body"
        :rows="rows"
        class="input font-sans text-[14px] leading-relaxed bg-surface/50 border-line focus:bg-surface transition-colors shadow-inner"
        :aria-label="`Draft text: ${draft.title}`"
      />
      <div v-else class="card p-3.5 text-[14px] leading-relaxed whitespace-pre-wrap bg-surface-2/40 border-line text-muted">
        {{ draft.body }}
      </div>
      <p v-if="pending && draft.kind === 'style_guide'" class="mt-2 text-xs text-info flex items-center gap-1.5">
        Approving saves this as the project brief's style notes.
      </p>
      <p v-if="pending && edited" class="mt-2 text-xs text-review flex items-center gap-1.5">
        Edited. Your version is saved and Marketing learns from the change.
      </p>
    </div>

    <!-- Self checks -->
    <div v-if="checks.length" class="flex flex-wrap items-center gap-1.5 px-4 pt-3 text-[11px]">
      <ShieldCheck :size="13" class="text-faint shrink-0" />
      <span
        v-for="c in checks"
        :key="c.label"
        class="chip text-[10px] px-2 py-0.5 font-medium transition-colors"
        :class="c.ok ? 'border-line bg-surface text-muted' : 'border-red-500/40 bg-red-500/10 text-red-500 font-semibold'"
      >
        {{ c.ok ? "✓" : "✗" }} {{ c.label }}
      </span>
    </div>

    <!-- Warning notes in amber -->
    <p v-if="draft.self_check?.notes" class="mx-4 mt-2.5 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-500">
      <TriangleAlert :size="14" class="mt-0.5 shrink-0" />
      <span class="leading-relaxed">{{ draft.self_check.notes }}</span>
    </p>

    <!-- Decided feedback -->
    <div v-if="!pending" class="px-4 pt-3 text-xs text-muted space-y-1">
      <p v-if="draft.owner_feedback"><span class="font-medium text-fg">Your feedback:</span> {{ draft.owner_feedback }}</p>
      <button v-if="draft.status === 'edited'" class="mt-1 text-accent font-medium hover:underline inline-block" @click="showOriginal = !showOriginal">
        {{ showOriginal ? "Hide" : "Show" }} Marketing's original
      </button>
      <div v-if="showOriginal" class="mt-1.5 rounded-lg border border-dashed border-line bg-surface-2/30 p-3 text-muted whitespace-pre-wrap">
        {{ draft.original_body }}
      </div>
    </div>

    <!-- Pending feedback input -->
    <div v-if="pending" class="px-4 pt-3">
      <label class="label" :for="`fb-${draft.id}`">{{ mode === "reject" ? "What is wrong? (Marketing reads this next time)" : "Feedback · optional" }}</label>
      <input
        :id="`fb-${draft.id}`"
        v-model="feedback"
        class="input text-xs py-1.5"
        :placeholder="mode === 'reject' ? 'e.g. too salesy, price is wrong, use more Manglish' : 'e.g. love the hook, keep it this short'"
      />
    </div>

    <div v-if="draft.kind === 'web_post' && !pending && draft.status !== 'rejected'" class="mx-4 mt-2 text-xs">
      <a v-if="draft.published_url?.startsWith('http')" :href="draft.published_url" target="_blank" rel="noopener" class="text-accent hover:underline">View it on the website →</a>
      <div v-else-if="draft.publish_error" class="flex flex-wrap items-center gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-danger">
        <span class="min-w-0 flex-1">Not published: {{ draft.publish_error }}</span>
        <button class="btn btn-sm" :disabled="busy" @click="publishAgain">
          <LoaderCircle v-if="busy" :size="13" class="motion-safe:animate-spin" />
          Publish again
        </button>
      </div>
      <div v-else-if="draft.status !== 'published'" class="flex flex-wrap items-center gap-2 rounded-md border border-signal/30 bg-signal-soft px-3 py-2 text-signal">
        <span class="min-w-0 flex-1">Approved but not on the website yet.</span>
        <button class="btn btn-sm" :disabled="busy" @click="publishAgain">
          <LoaderCircle v-if="busy" :size="13" class="motion-safe:animate-spin" />
          Publish now
        </button>
      </div>
    </div>
    <p v-if="error" class="mx-4 mt-2 text-xs text-danger">{{ error }}</p>

    <!-- Footer -->
    <footer class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2/40 px-4 py-2.5">
      <button class="btn btn-sm" @click="copy">
        <component :is="copied ? Check : Copy" :size="13" /> {{ copied ? "Copied" : "Copy" }}
      </button>

      <template v-if="pending">
        <div class="ml-auto flex items-center gap-2">
          <template v-if="mode === 'reject'">
            <button class="btn btn-sm btn-ghost" :disabled="busy" @click="mode = 'idle'">Back</button>
            <button class="btn btn-sm btn-danger" :disabled="busy" @click="decide('reject')"><X :size="13" /> Reject</button>
          </template>
          <template v-else>
            <button class="btn btn-sm btn-danger" :disabled="busy" @click="mode = 'reject'"><X :size="13" /> Reject…</button>
            <button class="btn btn-sm btn-primary shadow-sm" :disabled="busy || !body.trim()" @click="decide('approve')">
              <LoaderCircle v-if="busy" :size="13" class="motion-safe:animate-spin" />
              <Check v-else :size="13" /> {{ edited ? "Approve my edit" : "Approve" }}
            </button>
          </template>
        </div>
      </template>

      <span v-else class="ml-auto inline-flex items-center gap-2 text-xs text-muted">
        <StatusBadge :status="draft.status" />
        <span v-if="draft.decided_at" class="font-mono text-[11px] text-faint">{{ fmtDateTime(draft.decided_at) }}</span>
      </span>
    </footer>
  </article>
</template>
