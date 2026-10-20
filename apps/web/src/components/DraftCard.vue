<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { CalendarClock, Check, Copy, ExternalLink, LoaderCircle, ShieldCheck, TriangleAlert, X } from "lucide-vue-next";
import type { ContentDraft, WebPost } from "@agent-office/shared";
import AgentAvatar from "./AgentAvatar.vue";
import ConfirmButton from "./ConfirmButton.vue";
import StatusBadge from "./StatusBadge.vue";
import { api } from "../api/http.ts";
import { useOffice } from "../stores/office.ts";
import { fmtDateTime } from "../format.ts";
import { openInOpenCut } from "../opencut.ts";
import { RouterLink } from "vue-router";

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
// the owner may edit the title and (website posts) every post field before approving
const title = ref(props.draft.title);
const post = reactive({
  post_type: props.draft.meta?.post_type ?? "",
  excerpt: props.draft.meta?.excerpt ?? "",
  tags: (props.draft.meta?.tags ?? []).join(", "),
  event_date: props.draft.meta?.event_date ?? "",
  event_time: props.draft.meta?.event_time ?? "",
  location: props.draft.meta?.location ?? "",
  cover_upload_id: props.draft.meta?.cover_upload_id ?? null,
});
const coverBusy = ref(false);
const postEdits = computed<Partial<WebPost> | undefined>(() => {
  const m = props.draft.meta;
  if (!m) return undefined;
  const next: Partial<WebPost> = {
    post_type: post.post_type.trim(),
    excerpt: post.excerpt.trim(),
    tags: post.tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 12),
    event_date: post.event_date,
    event_time: post.event_time,
    location: post.location.trim(),
    cover_upload_id: post.cover_upload_id,
  };
  const same = (Object.keys(next) as (keyof WebPost)[]).every((k) => JSON.stringify(next[k]) === JSON.stringify(m[k]));
  return same ? undefined : next;
});
const titleEdited = computed(() => title.value.trim() !== props.draft.title);
const edited = computed(() => body.value.trim() !== props.draft.original_body.trim() || titleEdited.value || !!postEdits.value);
async function changeCover(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  coverBusy.value = true;
  error.value = "";
  try {
    post.cover_upload_id = (await api.uploadImage(file)).id;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    coverBusy.value = false;
  }
}
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
// "Schedule…": approve now, post later (website posts and connected social accounts)
const canSchedule = computed(() => props.draft.kind === "web_post" || ["facebook", "instagram", "threads", "tiktok"].includes(props.draft.platform));
const scheduling = ref(false);
const pad = (n: number) => String(n).padStart(2, "0");
/** A Date as the value of <input type="datetime-local"> (the browser's own time zone). */
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const minWhen = localInput(new Date(Date.now() + 5 * 60_000));
const when = ref(localInput(new Date(Date.now() + 3600_000)));
const publishAt = () => (scheduling.value && when.value ? new Date(when.value).toISOString() : undefined);

async function setSchedule(at: string | null) {
  busy.value = true;
  error.value = "";
  try {
    emit("decided", (await api.scheduleDraft(props.draft.id, at)).draft);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

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

// a post that is already on the website: edit it there, or take it down
const editingLive = ref(false);
const editable = computed(() => pending.value || editingLive.value);
const isLive = computed(() => props.draft.kind === "web_post" && props.draft.status === "published");
function startLiveEdit() {
  title.value = props.draft.title;
  body.value = props.draft.body;
  const m = props.draft.meta;
  Object.assign(post, {
    post_type: m?.post_type ?? "",
    excerpt: m?.excerpt ?? "",
    tags: (m?.tags ?? []).join(", "),
    event_date: m?.event_date ?? "",
    event_time: m?.event_time ?? "",
    location: m?.location ?? "",
    cover_upload_id: m?.cover_upload_id ?? null,
  });
  editingLive.value = true;
}
async function liveAction(fn: () => Promise<{ draft: ContentDraft }>) {
  busy.value = true;
  error.value = "";
  try {
    emit("decided", (await fn()).draft);
    editingLive.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const saveLive = () =>
  liveAction(() =>
    api.updatePublished(props.draft.id, {
      title: titleEdited.value ? title.value.trim() : undefined,
      body: body.value.trim() !== props.draft.body.trim() ? body.value : undefined,
      meta: postEdits.value,
    }),
  );
const takeDown = () => liveAction(() => api.takeDownPost(props.draft.id));

async function decide(decision: "approve" | "reject") {
  busy.value = true;
  error.value = "";
  try {
    const fb = feedback.value.trim() || undefined;
    const { draft } = await api.decideDraft(
      props.draft.id,
      decision === "approve"
        ? {
            decision,
            body: body.value.trim() !== props.draft.original_body.trim() ? body.value : undefined,
            title: titleEdited.value ? title.value.trim() : undefined,
            meta: postEdits.value,
            feedback: fb,
            publish_at: publishAt(),
          }
        : { decision, feedback: fb },
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
    <div v-if="editable" class="px-4 pt-3">
      <label :for="`dt-${draft.id}`" class="sr-only">Title</label>
      <input :id="`dt-${draft.id}`" v-model="title" class="input text-sm font-semibold" maxlength="200" />
    </div>
    <h3 v-else class="px-4 pt-3 font-semibold text-sm tracking-tight text-fg">{{ draft.title }}</h3>

    <!-- website post: every field can be changed before approving -->
    <div v-if="editable && isWebPost" class="grid gap-3 px-4 pt-3 sm:grid-cols-2">
      <div class="sm:col-span-2">
        <label class="label mb-1">Cover photo</label>
        <div v-if="post.cover_upload_id" class="group relative overflow-hidden rounded-lg border border-line bg-sunken">
          <img :src="api.uploadUrl(post.cover_upload_id)" alt="Cover photo" class="max-h-56 w-full object-cover" />
          <div class="absolute right-2.5 bottom-2.5 flex items-center gap-1.5">
            <label class="btn btn-sm h-7 cursor-pointer border-white/20 bg-black/60 px-2.5 py-0 text-xs text-white shadow-sm backdrop-blur-sm hover:bg-black/80" :class="coverBusy && 'opacity-60'">
              <input type="file" accept="image/jpeg,image/png,image/webp" class="hidden" :disabled="coverBusy" @change="changeCover" />
              {{ coverBusy ? "Uploading…" : "Change cover" }}
            </label>
            <button type="button" class="btn btn-sm h-7 border-white/20 bg-black/60 px-2.5 py-0 text-xs text-white shadow-sm backdrop-blur-sm hover:bg-black/80" @click="post.cover_upload_id = null">
              Remove cover
            </button>
          </div>
        </div>
        <div v-else class="flex flex-col items-center justify-center rounded-lg border border-dashed border-line p-5 text-center">
          <p class="text-xs text-muted mb-2">No cover photo</p>
          <label class="btn btn-sm cursor-pointer shadow-sm" :class="coverBusy && 'opacity-60'">
            <input type="file" accept="image/jpeg,image/png,image/webp" class="hidden" :disabled="coverBusy" @change="changeCover" />
            {{ coverBusy ? "Uploading…" : "Add cover" }}
          </label>
        </div>
      </div>
      <div class="sm:col-span-2">
        <label :for="`dx-${draft.id}`" class="label">Summary (on the post card)</label>
        <textarea :id="`dx-${draft.id}`" v-model="post.excerpt" rows="2" maxlength="400" class="input text-sm" />
      </div>
      <div>
        <label :for="`dp-${draft.id}`" class="label">Post type</label>
        <input :id="`dp-${draft.id}`" v-model="post.post_type" class="input text-sm" maxlength="40" />
      </div>
      <div>
        <label :for="`dg-${draft.id}`" class="label">Tags (comma separated)</label>
        <input :id="`dg-${draft.id}`" v-model="post.tags" class="input text-sm" />
      </div>
      <div>
        <label :for="`dd-${draft.id}`" class="label">Event date</label>
        <input :id="`dd-${draft.id}`" v-model="post.event_date" type="date" class="input text-sm" />
      </div>
      <div>
        <label :for="`dm-${draft.id}`" class="label">Event time</label>
        <input :id="`dm-${draft.id}`" v-model="post.event_time" type="time" class="input text-sm" />
      </div>
      <div class="sm:col-span-2">
        <label :for="`dl-${draft.id}`" class="label">Location</label>
        <input :id="`dl-${draft.id}`" v-model="post.location" class="input text-sm" maxlength="200" />
      </div>
      <p class="text-xs text-info sm:col-span-2">Approving publishes this post to the website.</p>
    </div>
    <div v-if="!isWebPost && draft.meta?.video_upload_id" class="px-4 pt-2.5 space-y-1.5">
      <video :src="api.uploadUrl(draft.meta.video_upload_id)" controls preload="metadata" playsinline class="max-h-96 w-auto max-w-full rounded-lg border border-line bg-black shadow-sm" aria-label="Video for this caption" />
      <div class="flex flex-wrap gap-2">
        <RouterLink :to="{ name: 'studio', params: { id: draft.meta.video_upload_id }, query: draft.status === 'draft' ? { draft: draft.id } : {} }" class="btn btn-sm btn-primary">Open in Video Studio</RouterLink>
        <a :href="api.uploadUrl(draft.meta.video_upload_id, true)" class="btn btn-sm" download>Download video</a>
        <button type="button" class="btn btn-sm" @click="openInOpenCut(draft.meta.video_upload_id, `${draft.title}.mp4`)">Edit in OpenCut</button>
      </div>
    </div>
    <div v-else-if="!isWebPost && draft.meta?.cover_upload_id" class="px-4 pt-2.5">
      <img :src="api.uploadUrl(draft.meta.cover_upload_id)" alt="Photo for this caption" class="max-h-52 w-auto max-w-full rounded-lg border border-line object-cover shadow-sm" />
    </div>
    <div v-if="!editable && isWebPost && draft.meta" class="px-4 pt-2.5 space-y-2">
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
        v-if="editable"
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

    <div v-if="!pending && draft.status !== 'rejected' && (draft.kind === 'web_post' || draft.published_url || draft.publish_error || draft.publish_at)" class="mx-4 mt-2 text-xs">
      <a
        v-if="draft.published_url?.startsWith('http')"
        :href="draft.published_url"
        target="_blank"
        rel="noopener"
        class="inline-flex items-center gap-1 font-medium text-accent hover:underline"
      >
        <span>{{ draft.kind === 'web_post' ? 'View it on the website' : `View it on ${PLATFORM[draft.platform] ?? draft.platform}` }}</span>
        <ExternalLink :size="12" />
      </a>
      <div v-else-if="draft.publish_error" class="flex flex-wrap items-center gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-danger">
        <span class="min-w-0 flex-1">Not published: {{ draft.publish_error }}</span>
        <button class="btn btn-sm" :disabled="busy" @click="publishAgain">
          <LoaderCircle v-if="busy" :size="13" class="motion-safe:animate-spin" />
          Publish again
        </button>
      </div>
      <div v-else-if="draft.publish_at" class="flex flex-wrap items-center gap-2 rounded-md border border-info/30 bg-info-soft px-3 py-2 text-info">
        <CalendarClock :size="14" class="shrink-0" />
        <span class="min-w-0 flex-1">Scheduled for <strong>{{ fmtDateTime(draft.publish_at) }}</strong></span>
        <button class="btn btn-sm btn-ghost" :disabled="busy" @click="setSchedule(null)">Cancel schedule</button>
        <button class="btn btn-sm" :disabled="busy" @click="publishAgain">
          <LoaderCircle v-if="busy" :size="13" class="motion-safe:animate-spin" />
          Publish now
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
        <div class="ml-auto flex flex-wrap items-center justify-end gap-2">
          <template v-if="mode === 'reject'">
            <button class="btn btn-sm btn-ghost" :disabled="busy" @click="mode = 'idle'">Back</button>
            <button class="btn btn-sm btn-danger" :disabled="busy" @click="decide('reject')"><X :size="13" /> Reject</button>
          </template>
          <template v-else>
            <button class="btn btn-sm btn-danger" :disabled="busy" @click="mode = 'reject'"><X :size="13" /> Reject…</button>
            <label v-if="scheduling" class="sr-only" :for="`when-${draft.id}`">Post at</label>
            <input v-if="scheduling" :id="`when-${draft.id}`" v-model="when" type="datetime-local" :min="minWhen" class="input py-1 text-xs w-auto" />
            <button v-if="canSchedule" class="btn btn-sm" :class="scheduling && 'btn-ghost'" :disabled="busy" :aria-pressed="scheduling" @click="scheduling = !scheduling">
              <CalendarClock :size="13" /> {{ scheduling ? "Post now instead" : "Schedule…" }}
            </button>
            <button class="btn btn-sm btn-primary shadow-sm" :disabled="busy || !body.trim() || (scheduling && !when)" @click="decide('approve')">
              <LoaderCircle v-if="busy" :size="13" class="motion-safe:animate-spin" />
              <Check v-else :size="13" /> {{ scheduling ? "Approve & schedule" : edited ? "Approve my edit" : "Approve" }}
            </button>
          </template>
        </div>
      </template>

      <div v-else-if="isLive && editingLive" class="ml-auto flex items-center gap-2">
        <button class="btn btn-sm btn-ghost" :disabled="busy" @click="editingLive = false">Cancel</button>
        <button class="btn btn-sm btn-primary" :disabled="busy || !edited" @click="saveLive">
          <LoaderCircle v-if="busy" :size="13" class="motion-safe:animate-spin" /> Save to website
        </button>
      </div>
      <div v-else-if="isLive" class="ml-auto flex items-center gap-2">
        <ConfirmButton small confirm-label="Take it off the website?" @confirm="takeDown">Take down</ConfirmButton>
        <button class="btn btn-sm" :disabled="busy" @click="startLiveEdit">Edit live post</button>
      </div>
      <span v-else class="ml-auto inline-flex items-center gap-2 text-xs text-muted">
        <StatusBadge :status="draft.status" />
        <span v-if="draft.decided_at" class="font-mono text-[11px] text-faint">{{ fmtDateTime(draft.decided_at) }}</span>
      </span>
    </footer>
  </article>
</template>
