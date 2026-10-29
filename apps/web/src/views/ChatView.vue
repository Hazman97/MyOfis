<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, RouterLink, useRoute, useRouter } from "vue-router";
import { Clapperboard, Cpu, ImagePlus, LoaderCircle, MessageSquare, Mic, MicOff, Plus, SendHorizontal, Square, Volume2, X } from "lucide-vue-next";
import { fmtDuration, startRecording, type ActiveRecording } from "../recorder.ts";
import type { Agent, Project } from "@agent-office/shared";
import AgentAvatar from "../components/AgentAvatar.vue";
import EditSuggestionCards from "../components/EditSuggestionCards.vue";
import RunStatusCard from "../components/RunStatusCard.vue";
import ModelPicker from "../components/ModelPicker.vue";
import { isOwner } from "../me.ts";
import PageHeader from "../components/PageHeader.vue";
import { api, type ChatAttachment, type ChatMessage, type ChatThread } from "../api/http.ts";
import { useOffice } from "../stores/office.ts";
import { canDictate, canSpeak, dictate, speak, stopSpeaking, type Dictation } from "../speech.ts";
import { fmtTime } from "../format.ts";

/**
 * Chat with one agent. Each message is a normal job (budgets, approvals and the
 * office still apply); the reply is the run's text, streamed live from the store.
 */
const office = useOffice();
const route = useRoute();
const router = useRouter();

const agents = computed(() => office.agents.filter((a) => a.enabled && !a.config.external));
const agent = computed<Agent | undefined>(() => agents.value.find((a) => a.slug === route.query.agent) ?? agents.value.find((a) => a.slug === "english-coach") ?? agents.value[0]);
const threads = ref<ChatThread[]>([]);
const threadId = ref<string | null>(null);
const threadsDrawerOpen = ref(false);
const messages = ref<ChatMessage[]>([]);
const projects = ref<Project[]>([]);
const projectId = ref("");
const text = ref("");
const interim = ref("");
const sending = ref(false);
const error = ref("");
const listening = ref<Dictation | null>(null);
const autoSpeak = ref(false);
const speaking = ref<string | null>(null);
const scroller = ref<HTMLElement>();

const isMarketing = computed(() => !!agent.value?.tools.includes("save_draft"));
const hasMeetingTranscribe = computed(() => !!agent.value?.tools.includes("meeting_transcribe"));
const isCoach = computed(() => agent.value?.slug === "english-coach");
// the coach listens for English; other agents get Malay recognition (handles Manglish better)
const lang = computed(() => (isCoach.value ? "en-US" : "ms-MY"));

const STARTERS: Record<string, string[]> = {
  "english-coach": [
    "Let's do free talk. Ask me about my day.",
    "Interview mode: you're a client asking about ekadkahwin. Ask me unexpected questions.",
    "Drill: 5 quick questions about my business.",
    "Pitch: I will explain my camera rental in 30 seconds.",
  ],
  marketing: [
    "Buat 3 caption TikTok untuk promo cuti sekolah, santai Manglish.",
    "Analisis gaya penulisan contoh posting dalam brief, lepas tu tulis 2 posting IG ikut gaya tu.",
    "Bagi idea content calendar minggu depan.",
  ],
};
const starters = computed(() => STARTERS[agent.value?.slug ?? ""] ?? (isMarketing.value ? STARTERS.marketing! : ["What can you help me with?"]));

/** Live reply for a message: the run's streamed text from the event store. */
// switch the agent's model from the chat header
const modelOpen = ref(false);
const modelForm = reactive({ provider: "", model: "" });
const modelSaving = ref(false);
const modelError = ref("");
function openModel() {
  if (!agent.value) return;
  modelForm.provider = agent.value.provider;
  modelForm.model = agent.value.model;
  modelError.value = "";
  modelOpen.value = !modelOpen.value;
}
async function saveModel() {
  if (!agent.value) return;
  modelSaving.value = true;
  modelError.value = "";
  try {
    await api.updateAgent(agent.value.id, { provider: modelForm.provider, model: modelForm.model.trim() });
    await office.loadAgents();
    modelOpen.value = false;
  } catch (e) {
    modelError.value = (e as Error).message;
  } finally {
    modelSaving.value = false;
  }
}

/** OpenChatCut editor links in a reply, cleaned to the exact project URL. */
const OCC_LINK = /https?:\/\/(?:localhost|127\.0\.0\.1):\d{2,5}\/#\/editor\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const occLinks = (text: string) => [...new Set(text.match(OCC_LINK) ?? [])];

/** Stop a reply that takes too long (cancels its job; the run ends within seconds). */
const stopping = ref<string | null>(null);
async function stopReply(jobId: string) {
  stopping.value = jobId;
  try {
    await api.cancelJob(jobId);
  } finally {
    stopping.value = null;
  }
}

function live(m: ChatMessage) {
  const runId = office.state.jobs[m.job_id]?.run_ids.at(-1) ?? m.run_id;
  const run = runId ? office.state.runs[runId] : undefined;
  const status = office.state.jobs[m.job_id]?.status ?? m.status;
  return { reply: run?.output?.trim() || m.reply || "", status, error: run?.error ?? null, runId };
}

/** The part worth reading aloud: the coach's conversational reply, not the correction notes. */
const speakable = (t: string) => t.split(/\n\s*(?:\*\*)?(?:More natural|Useful phrase)\b/i)[0]!.trim();

/** Escape, then a little markdown (bold, inline code, bullets) and the arrows some models write in LaTeX. */
function lite(t: string) {
  const esc = t
    .replace(/\$\\(?:rightarrow|to|Rightarrow|longrightarrow)\$/g, "→")
    .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return esc
    .replace(/^\s*[*-]\s+/gm, "• ")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>");
}

async function loadThreads() {
  if (!agent.value) return;
  threads.value = (await api.chatThreads(agent.value.id)).threads;
}

async function openThread(id: string | null) {
  threadId.value = id;
  messages.value = id ? (await api.chatThread(id)).messages : [];
  await scrollDown(true);
}

/** Keep following new text only while the owner is at the bottom; never pull them down while they read. */
const atBottom = ref(true);
const newBelow = ref(false);
function onScroll() {
  const el = scroller.value;
  if (!el) return;
  atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  if (atBottom.value) newBelow.value = false;
}
async function scrollDown(force = false) {
  await nextTick();
  const el = scroller.value;
  if (!el) return;
  if (!force && !atBottom.value) {
    newBelow.value = true;
    return;
  }
  // instant while text streams in (smooth scrolling fights the stream), smooth when jumping
  el.scrollTo({ top: el.scrollHeight, behavior: force ? "smooth" : "auto" });
  atBottom.value = true;
  newBelow.value = false;
}

watch(
  agent,
  async (a, prev) => {
    if (!a || a.id === prev?.id) return;
    stopSpeaking();
    autoSpeak.value = a.slug === "english-coach";
    await loadThreads();
    await openThread(threads.value[0]?.thread_id ?? null);
  },
  { immediate: true },
);
onMounted(async () => {
  projects.value = (await api.projects()).projects.filter((p) => p.enabled);
});

// Photos and videos to send with the next message (uploaded right away; Publisher and Editor use them)
const MAX_PHOTOS = 10;
const photos = ref<(ChatAttachment & { preview: string })[]>([]);
const uploading = ref(false);
/** Upload progress of the current video, 0–100 (null for photos). */
const uploadPct = ref<number | null>(null);
const photoInput = ref<HTMLInputElement>();
const isVideo = (a: { content_type: string }) => a.content_type.startsWith("video/");
/** Meeting recordings and voice notes (Notulis). */
const isAudio = (a: { content_type: string }) => a.content_type.startsWith("audio/");
/** PDF / DOCX / TXT / MD for the Project Assistant (shown as a file chip, not a picture). */
const isDoc = (a: { content_type: string }) => !isVideo(a) && !isAudio(a) && !a.content_type.startsWith("image/");
async function addPhotos(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])].slice(0, MAX_PHOTOS - photos.value.length);
  input.value = "";
  if (!files.length) return;
  uploading.value = true;
  error.value = "";
  try {
    for (const file of files) {
      // videos and recordings can be large: sent in parts with progress
      const video = file.type.startsWith("video/") || file.type.startsWith("audio/") || /\.(mp4|mov|webm|mkv|m4v|m4a|mp3|wav|ogg|oga|opus|weba|aac|flac|amr)$/i.test(file.name);
      uploadPct.value = video ? 0 : null;
      const up = video ? await api.uploadVideo(file, (d) => (uploadPct.value = Math.round(d * 100))) : await api.uploadImage(file);
      photos.value.push({ ...up, preview: URL.createObjectURL(file) });
    }
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    uploading.value = false;
    uploadPct.value = null;
  }
}
function removePhoto(id: string) {
  const p = photos.value.find((x) => x.id === id);
  if (p) URL.revokeObjectURL(p.preview);
  photos.value = photos.value.filter((x) => x.id !== id);
}

async function send(body = text.value) {
  const t = (body + (interim.value ? ` ${interim.value}` : "")).trim() || (photos.value.length ? (photos.value.some(isAudio) ? "(rakaman)" : photos.value.some(isVideo) ? "(video)" : "(photo)") : "");
  if (!t || !agent.value || sending.value || uploading.value) return;
  listening.value?.stop();
  sending.value = true;
  error.value = "";
  try {
    const sent = photos.value.map(({ id, name, content_type }) => ({ id, name, content_type }));
    const res = await api.chat({ agent_id: agent.value.id, text: t, thread_id: threadId.value, project_id: projectId.value || null, attachments: sent.map((p) => p.id) });
    if (!threadId.value) {
      threadId.value = res.thread_id;
      void loadThreads();
    }
    messages.value.push({ job_id: res.job.id, agent_id: agent.value.id, text: t, created_at: res.job.created_at, status: res.job.status, run_id: null, reply: null, attachments: sent });
    for (const p of photos.value) URL.revokeObjectURL(p.preview);
    photos.value = [];
    text.value = "";
    interim.value = "";
    await scrollDown(true);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    sending.value = false;
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void send();
  }
}

function onPickSuggestion(key: string) {
  text.value = `Go with option ${key}`;
  void send();
}

function toggleMic() {
  if (listening.value) {
    listening.value.stop();
    return;
  }
  error.value = "";
  const base = text.value ? `${text.value.trimEnd()} ` : "";
  let finals = "";
  listening.value = dictate(
    lang.value,
    (f, i) => {
      finals += f;
      text.value = base + finals;
      interim.value = i;
    },
    (err) => {
      listening.value = null;
      interim.value = "";
      if (err) error.value = err;
    },
  );
  if (!listening.value) error.value = "This browser cannot do dictation. Try Chrome or Edge.";
}

function say(m: ChatMessage) {
  const { reply } = live(m);
  if (speaking.value === m.job_id) {
    stopSpeaking();
    speaking.value = null;
    return;
  }
  speaking.value = m.job_id;
  speak(isCoach.value ? speakable(reply) : reply, lang.value, () => (speaking.value = null));
}

// read new coach replies aloud once they finish, and keep the newest message in view
const spoken = new Set<string>();
watch(
  () => messages.value.map((m) => `${m.job_id}:${live(m).status}:${live(m).reply.length}`).join("|"),
  () => {
    void scrollDown();
    const last = messages.value.at(-1);
    if (!last || !autoSpeak.value || spoken.has(last.job_id)) return;
    const l = live(last);
    if (l.status === "done" && l.reply) {
      spoken.add(last.job_id);
      say(last);
    }
  },
);

// ---------------------------------------------------------------- Meeting recording (Notulis)
const activeRecord = ref<ActiveRecording | null>(null);
const isRecording = ref(false);
const recordSeconds = ref(0);
let recordTimer: ReturnType<typeof setInterval> | null = null;

async function startMeetingRecording() {
  if (isRecording.value) return;
  error.value = "";
  try {
    const rec = await startRecording();
    activeRecord.value = rec;
    isRecording.value = true;
    recordSeconds.value = 0;
    recordTimer = setInterval(() => {
      if (activeRecord.value) {
        recordSeconds.value = activeRecord.value.elapsed();
      }
    }, 1000);
  } catch (err: any) {
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      error.value = "Kebenaran mikrofon ditolak. Sila benarkan akses mikrofon dalam tetapan pelayar.";
    } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
      error.value = "Tiada mikrofon dijumpai pada peranti ini.";
    } else {
      error.value = `Gagal memulakan rakaman: ${err.message || String(err)}`;
    }
  }
}

function cancelMeetingRecording() {
  if (recordTimer) {
    clearInterval(recordTimer);
    recordTimer = null;
  }
  if (activeRecord.value) {
    activeRecord.value.cancel();
    activeRecord.value = null;
  }
  isRecording.value = false;
  recordSeconds.value = 0;
}

async function stopAndAttachRecording() {
  if (!activeRecord.value) return;
  const rec = activeRecord.value;
  if (recordTimer) {
    clearInterval(recordTimer);
    recordTimer = null;
  }
  activeRecord.value = null;
  isRecording.value = false;
  recordSeconds.value = 0;

  uploading.value = true;
  uploadPct.value = 0;
  error.value = "";
  try {
    const file = await rec.stop();
    const up = await api.uploadVideo(file, (d) => (uploadPct.value = Math.round(d * 100)));
    photos.value.push({ ...up, preview: URL.createObjectURL(file) });
  } catch (err) {
    error.value = `Gagal memuat naik rakaman: ${(err as Error).message}`;
  } finally {
    uploading.value = false;
    uploadPct.value = null;
  }
}

onBeforeRouteLeave(() => {
  if (isRecording.value) {
    const ok = window.confirm("Rekod sedang berjalan. Buang rakaman?");
    if (!ok) return false;
    cancelMeetingRecording();
  }
});

onBeforeRouteUpdate((to, from) => {
  if (isRecording.value && to.query.agent !== from.query.agent) {
    const ok = window.confirm("Rekod sedang berjalan. Buang rakaman?");
    if (!ok) return false;
    cancelMeetingRecording();
  }
});

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (isRecording.value) {
    e.preventDefault();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", onBeforeUnload);
}

onBeforeUnmount(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("beforeunload", onBeforeUnload);
  }
  if (isRecording.value) {
    cancelMeetingRecording();
  }
  listening.value?.stop();
  stopSpeaking();
});

const pickAgent = (slug: string) => router.replace({ query: { agent: slug } });
const threadTitle = (t: ChatThread) => t.title.slice(0, 48);
</script>

<template>
  <div>
    <PageHeader sign="Office" title="Chat" description="Talk to an agent like a colleague. Each message is a small job, so it shows up in the office and counts toward the agent's budget." />

    <div class="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <!-- who + which conversation -->
      <aside class="space-y-4 max-lg:hidden">
        <div class="card overflow-y-auto max-h-56 divide-y divide-line">
          <button
            v-for="a in agents"
            :key="a.id"
            class="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-all duration-150 cursor-pointer"
            :class="a.id === agent?.id ? 'bg-accent/10 border-l-2 border-accent text-fg font-semibold' : 'text-muted hover:bg-surface-2 hover:text-fg'"
            @click="pickAgent(a.slug)"
          >
            <AgentAvatar :name="a.name" :slug="a.slug" :size="30" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-xs font-semibold">{{ a.name }}</span>
              <span class="block truncate text-[11px] text-muted">{{ a.role }}</span>
            </span>
          </button>
        </div>

        <div v-if="agent" class="space-y-2">
          <div class="flex items-center justify-between px-1">
            <span class="sign text-[10px] tracking-wider">Conversations</span>
            <button class="btn btn-ghost btn-sm h-6 px-2 text-[11px] gap-1 hover:bg-surface-2" title="New conversation" @click="openThread(null)">
              <Plus :size="12" /> New
            </button>
          </div>
          <div class="space-y-1 max-h-64 overflow-y-auto">
            <button
              v-for="t in threads"
              :key="t.thread_id"
              class="block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer"
              :class="t.thread_id === threadId ? 'bg-surface-2 font-medium text-fg shadow-xs border border-line' : 'text-muted hover:bg-surface-2/60 hover:text-fg border border-transparent'"
              :title="t.title"
              @click="openThread(t.thread_id)"
            >
              {{ threadTitle(t) }}
            </button>
            <p v-if="!threads.length" class="px-2 text-xs text-faint">No conversations yet.</p>
          </div>
        </div>
      </aside>

      <!-- the conversation -->
      <section v-if="agent" class="card flex h-[calc(100dvh-15rem)] min-h-112 flex-col overflow-hidden max-lg:h-[calc(100dvh-17rem)]">
        <header class="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-3 bg-surface/80 backdrop-blur-sm">
          <select class="input basis-full lg:hidden text-xs py-1.5" :value="agent.slug" aria-label="Chat with" @change="pickAgent(($event.target as HTMLSelectElement).value)">
            <option v-for="a in agents" :key="a.id" :value="a.slug">{{ a.name }}{{ a.role ? ` · ${a.role}` : "" }}</option>
          </select>
          <AgentAvatar :name="agent.name" :slug="agent.slug" :size="32" />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-semibold tracking-tight text-fg">{{ agent.name }}</div>
            <div class="truncate text-xs text-muted">{{ agent.role }}</div>
          </div>
          <!-- the agent's model: switch it here (owner) -->
          <button
            v-if="isOwner && !agent.shared"
            type="button"
            class="chip min-h-8 max-w-48 gap-1 truncate font-mono text-[11px]"
            :title="`Model: ${agent.provider} / ${agent.model}. Click to change.`"
            @click="openModel"
          >
            <Cpu :size="12" class="shrink-0" /> <span class="truncate">{{ agent.model }}</span>
          </button>
          <select v-if="isMarketing" v-model="projectId" class="input w-auto text-xs py-1" aria-label="Project" :disabled="!!threadId && messages.length > 0">
            <option value="">Any project</option>
            <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <label v-if="canSpeak()" class="inline-flex items-center gap-1.5 text-xs text-muted cursor-pointer hover:text-fg transition-colors" title="Read new replies aloud">
            <input v-model="autoSpeak" type="checkbox" class="accent-accent" /> <Volume2 :size="14" /> <span class="max-sm:sr-only">Read aloud</span>
          </label>
          <button class="btn btn-ghost btn-sm h-7 gap-1 lg:hidden" title="Conversations" @click="threadsDrawerOpen = true">
            <MessageSquare :size="13" /> Conversations
          </button>
          <button class="btn btn-ghost btn-sm h-7 lg:hidden" title="New conversation" @click="openThread(null)"><Plus :size="13" /> New</button>
        </header>

        <!-- Mobile Conversations Drawer / Sheet -->
        <Teleport to="body">
          <div v-if="threadsDrawerOpen" class="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-xs lg:hidden" @click.self="threadsDrawerOpen = false">
            <div class="card max-h-[75vh] w-full rounded-b-none border-x-0 border-b-0 p-4 flex flex-col gap-3 shadow-2xl bg-surface animate-in slide-in-from-bottom">
              <div class="flex items-center justify-between border-b border-line pb-2.5">
                <div class="flex items-center gap-2">
                  <MessageSquare :size="16" class="text-accent" />
                  <span class="font-semibold text-sm text-fg">Conversations</span>
                  <span v-if="agent" class="text-xs text-muted">with {{ agent.name }}</span>
                </div>
                <button class="btn btn-ghost btn-sm size-8 p-0" @click="threadsDrawerOpen = false" aria-label="Close">
                  <X :size="16" />
                </button>
              </div>
              <div class="flex items-center justify-between px-1">
                <span class="sign text-[10px] tracking-wider">{{ threads.length }} {{ threads.length === 1 ? 'thread' : 'threads' }}</span>
                <button class="btn btn-ghost btn-sm h-7 px-2 text-xs gap-1 hover:bg-surface-2" title="New conversation" @click="openThread(null); threadsDrawerOpen = false">
                  <Plus :size="13" /> New
                </button>
              </div>
              <div class="overflow-y-auto space-y-1 max-h-80 pr-1">
                <button
                  v-for="t in threads"
                  :key="t.thread_id"
                  class="block w-full truncate rounded-lg px-3 py-2 text-left text-xs transition-colors cursor-pointer"
                  :class="t.thread_id === threadId ? 'bg-surface-2 font-medium text-fg shadow-xs border border-line' : 'text-muted hover:bg-surface-2/60 hover:text-fg border border-transparent'"
                  :title="t.title"
                  @click="openThread(t.thread_id); threadsDrawerOpen = false"
                >
                  {{ threadTitle(t) }}
                </button>
                <p v-if="!threads.length" class="py-6 text-center text-xs text-faint">No conversations yet.</p>
              </div>
            </div>
          </div>
        </Teleport>
        <div v-if="modelOpen" class="border-b border-line bg-surface-2/60 px-4 py-3 space-y-2">
          <p class="text-xs text-muted">Change the model {{ agent.name }} uses. Test it first: agents with tools need a model that calls tools.</p>
          <ModelPicker v-model:provider="modelForm.provider" v-model:model="modelForm.model" />
          <div class="flex flex-wrap items-center gap-2">
            <button type="button" class="btn btn-sm btn-primary min-h-9" :disabled="modelSaving || !modelForm.model.trim()" @click="saveModel">Save model</button>
            <button type="button" class="btn btn-sm btn-ghost min-h-9" @click="modelOpen = false">Close</button>
            <span v-if="modelError" class="text-xs text-danger">{{ modelError }}</span>
          </div>
        </div>

        <div ref="scroller" class="flex-1 space-y-4 overflow-y-auto px-4 py-5" @scroll.passive="onScroll">
          <!-- Starters / Empty state -->
          <div v-if="!messages.length" class="mx-auto max-w-lg py-8 text-center">
            <div class="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl border border-line bg-surface-2 text-accent shadow-sm">
              <AgentAvatar :name="agent.name" :slug="agent.slug" :size="36" />
            </div>
            <h3 class="font-semibold text-base tracking-tight text-fg">Conversation with {{ agent.name }}</h3>
            <p class="mt-1 text-xs text-muted max-w-md mx-auto">
              <template v-if="isCoach">Speak or type. Coach replies, asks a follow-up and shows a more natural way to say it.</template>
              <template v-else-if="isMarketing">Ask for posts or ideas. Anything it writes lands in <RouterLink to="/drafts" class="text-accent hover:underline font-medium">Drafts</RouterLink> for you to approve.</template>
              <template v-else>Ask anything about its work, progress or active tasks.</template>
            </p>
            <div class="mt-5 grid gap-2 sm:grid-cols-2 text-left">
              <button
                v-for="s in starters"
                :key="s"
                class="card group p-3.5 text-left text-xs text-fg transition-all duration-150 hover:border-line-strong hover:bg-surface-2 hover:-translate-y-0.5 hover:shadow-card active:scale-[0.99] cursor-pointer"
                @click="send(s)"
              >
                <span class="line-clamp-3 leading-relaxed">{{ s }}</span>
                <span class="mt-2 flex items-center gap-1 text-[10px] font-semibold text-accent group-hover:translate-x-0.5 transition-transform">
                  <span>Send prompt</span>
                  <span>→</span>
                </span>
              </button>
            </div>
          </div>

          <!-- Message Bubbles -->
          <template v-for="m in messages" :key="m.job_id">
            <!-- Owner message on right -->
            <div class="group flex flex-col items-end">
              <div class="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-br-sm bg-accent px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap text-accent-ink shadow-sm">
                <div v-if="m.attachments?.length" class="mb-2 flex flex-wrap gap-1.5">
                  <template v-for="a in m.attachments" :key="a.id">
                    <video v-if="isVideo(a)" :src="api.uploadUrl(a.id)" controls preload="metadata" class="h-40 max-w-full rounded-xl border border-white/20 bg-black shadow-xs" :aria-label="a.name" />
                    <span v-else-if="isAudio(a)" class="flex max-w-full flex-col gap-1 text-xs">
                      <span class="truncate">🎙️ {{ a.name }}</span>
                      <audio :src="api.uploadUrl(a.id)" controls preload="none" class="h-9 w-64 max-w-full" :aria-label="a.name" />
                    </span>
                    <a v-else-if="isDoc(a)" :href="api.uploadUrl(a.id, true)" class="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-white/25 bg-white/10 px-2 py-1 text-xs" download>
                      📄 <span class="truncate">{{ a.name }}</span>
                    </a>
                    <a v-else :href="api.uploadUrl(a.id)" target="_blank" rel="noopener" class="group/img block overflow-hidden rounded-xl border border-white/20 transition-transform hover:scale-[1.02]">
                      <img :src="api.uploadUrl(a.id)" :alt="a.name" class="size-24 rounded-xl object-cover shadow-xs" loading="lazy" />
                    </a>
                  </template>
                </div>
                {{ m.text }}
              </div>
              <div class="mt-1 px-1 text-[10px] font-mono text-faint opacity-0 group-hover:opacity-100 max-sm:opacity-80 transition-opacity">
                <span v-if="m.created_by === 'assistant'" class="mr-1.5 rounded bg-accent-soft px-1.5 py-0.5 text-accent">🤖 Claude</span>{{ fmtTime(m.created_at) }}
              </div>
            </div>

            <!-- Agent message on left -->
            <div class="group flex items-start gap-2.5">
              <AgentAvatar :name="agent.name" :slug="agent.slug" :size="28" class="mt-0.5 shrink-0" />
              <div class="max-w-[85%] sm:max-w-[75%] min-w-0">
                <div class="rounded-2xl rounded-tl-sm border border-line bg-surface-2/90 px-4 py-2.5 text-[14px] leading-relaxed text-fg shadow-sm">
                  <div v-if="live(m).reply" class="chat-reply whitespace-pre-wrap text-[13.5px] sm:text-[14px] leading-relaxed" v-html="lite(live(m).reply)" />
                  <!-- live status: queued (place + why), the step it is on, quiet, failed or stopped (+ why) -->
                  <RunStatusCard
                    v-if="live(m).status !== 'done'"
                    :job-id="m.job_id"
                    :compact="!!live(m).reply && live(m).status === 'running'"
                    :class="live(m).reply ? 'mt-2' : ''"
                    @stop="stopReply(m.job_id)"
                    @retry="send(m.text)"
                  />
                  <p v-else-if="!live(m).reply && !m.renders?.length && !m.suggestions" class="text-xs text-muted">Finished without a written answer. Open <em>details</em> to see what it did, or ask again.</p>
                  <!-- videos the agent made (Editor): watch here, edit in the studio -->
                  <div v-if="m.renders?.length" class="mt-2 space-y-2">
                    <div v-for="r in m.renders" :key="r.id" class="space-y-1">
                      <video :src="api.uploadUrl(r.id)" controls playsinline preload="metadata" class="max-h-72 max-w-full rounded-lg border border-line bg-black" :aria-label="r.name" />
                      <RouterLink :to="{ name: 'studio', params: { id: r.id } }" class="btn btn-sm">Open in Video Studio</RouterLink>
                    </div>
                  </div>

                  <!-- OpenChatCut projects mentioned in the reply: a clean link (models sometimes glue words to the URL) -->
                  <div v-if="occLinks(live(m).reply).length" class="mt-2 flex flex-wrap items-center gap-2">
                    <a v-for="u in occLinks(live(m).reply)" :key="u" :href="u" target="_blank" rel="noopener" class="btn btn-sm min-h-9">
                      <Clapperboard :size="13" /> Open in OpenChatCut
                    </a>
                    <span class="text-[11px] text-faint">Studio Pro opens its own editor window on your PC. Use this only if that window is closed: two editors of one project fight over it.</span>
                  </div>
                  <!-- Editor's edit suggestions (tool suggest_edits) -->
                  <div v-if="m.suggestions" class="mt-3">
                    <EditSuggestionCards :suggestions="m.suggestions" mode="chat" @pick="onPickSuggestion" />
                  </div>
                </div>
                <div class="mt-1.5 flex items-center gap-3 px-1 text-[11px] text-faint opacity-80 group-hover:opacity-100 transition-opacity">
                  <span class="font-mono">{{ fmtTime(m.created_at) }}</span>
                  <button v-if="live(m).reply && canSpeak()" class="inline-flex items-center gap-1 hover:text-fg transition-colors" @click="say(m)">
                    <component :is="speaking === m.job_id ? Square : Volume2" :size="12" /> {{ speaking === m.job_id ? "Stop" : "Listen" }}
                  </button>
                  <RouterLink v-if="live(m).runId" :to="{ name: 'run', params: { id: live(m).runId } }" class="hover:text-fg transition-colors">details</RouterLink>
                </div>
              </div>
            </div>
          </template>

          <!-- you scrolled up to read: new text waits below instead of pulling you down -->
          <div v-if="newBelow" class="sticky bottom-2 z-10 flex justify-center pointer-events-none">
            <button
              class="btn btn-sm pointer-events-auto rounded-full border border-accent/40 bg-surface/95 px-3.5 py-1 text-xs font-semibold text-accent shadow-card backdrop-blur-sm transition-all hover:bg-surface-2 hover:border-accent motion-safe:animate-bounce"
              @click="scrollDown(true)"
            >
              New reply ↓
            </button>
          </div>
        </div>

        <!-- Composer -->
        <footer class="border-t border-line bg-surface/80 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm">
          <!-- Red bar while recording meeting -->
          <div
            v-if="isRecording"
            class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-600 dark:text-red-400"
          >
            <div class="flex items-center gap-2.5 min-w-0">
              <span class="relative flex size-2.5 shrink-0">
                <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
                <span class="relative inline-flex size-2.5 rounded-full bg-red-500"></span>
              </span>
              <span class="font-mono text-xs font-bold tracking-wide">{{ fmtDuration(recordSeconds) }}</span>
              <span class="text-xs text-muted">·</span>
              <span class="text-xs text-muted truncate">Biarkan skrin terbuka semasa merakam</span>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                type="button"
                class="btn btn-ghost btn-sm h-7 px-2.5 text-xs font-medium text-muted hover:text-fg hover:bg-surface-2"
                @click="cancelMeetingRecording"
              >
                Batal
              </button>
              <button
                type="button"
                class="btn btn-primary btn-sm h-7 px-3 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white border-none shadow-xs"
                @click="stopAndAttachRecording"
              >
                Stop & lampir
              </button>
            </div>
          </div>

          <p v-if="error" class="mb-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-1.5 text-xs text-danger">{{ error }}</p>
          <div v-if="photos.length || uploading" class="mb-2.5 flex flex-wrap items-center gap-2" aria-label="Photos to send">
            <div v-for="p in photos" :key="p.id" class="relative group">
              <video v-if="isVideo(p)" :src="p.preview" muted preload="metadata" class="size-16 rounded-xl border border-line bg-black object-cover shadow-xs" :aria-label="p.name" />
              <div v-else-if="isDoc(p) || isAudio(p)" class="flex h-16 w-28 flex-col items-center justify-center rounded-xl border border-line bg-surface-2 p-1 text-center text-[10px] shadow-xs" :title="p.name">
                <span class="text-lg">{{ isAudio(p) ? "🎙️" : "📄" }}</span><span class="w-full truncate">{{ p.name }}</span>
              </div>
              <img v-else :src="p.preview" :alt="p.name" class="size-16 rounded-xl border border-line object-cover shadow-xs" />
              <button
                class="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-sm hover:bg-danger-soft hover:text-danger hover:border-danger/30 transition-colors"
                :aria-label="`Remove ${p.name}`"
                title="Remove photo"
                @click="removePhoto(p.id)"
              >
                <X :size="12" />
              </button>
            </div>
            <span v-if="uploading" class="text-xs text-muted flex items-center gap-1.5">
              <LoaderCircle :size="13" class="animate-spin text-accent" />
              {{ uploadPct === null ? "Uploading…" : `Uploading video… ${uploadPct}%` }}
            </span>
          </div>
          <div class="flex items-end gap-2">
            <input ref="photoInput" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,video/x-matroska,.mkv,.m4v,audio/*,.m4a,.mp3,.wav,.ogg,.opus,.aac,.flac,.amr,application/pdf,.pdf,.docx,.txt,.md" multiple class="hidden" @change="addPhotos" />
            <button
              class="btn relative shrink-0 size-9 p-0 rounded-lg text-muted hover:text-fg"
              :disabled="uploading || photos.length >= MAX_PHOTOS"
              aria-label="Add photos or videos"
              title="Add photos, videos or documents (up to 10). Publisher sees photos, Editor edits videos, the Project Assistant reads PDF / DOCX."
              @click="photoInput?.click()"
            >
              <ImagePlus :size="16" />
              <span
                v-if="photos.length"
                class="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-accent-ink shadow-xs"
              >
                {{ photos.length }}
              </span>
            </button>
            <button
              v-if="hasMeetingTranscribe"
              type="button"
              class="btn btn-sm h-9 px-2.5 rounded-lg text-xs font-semibold gap-1 shrink-0 text-muted hover:text-fg hover:bg-surface-2 transition-colors"
              :disabled="isRecording || uploading"
              title="Rakam mesyuarat untuk ditranskrip oleh Notulis"
              @click="startMeetingRecording"
            >
              <span>🎙️</span>
              <span>Rakam</span>
            </button>
            <button
              v-if="canDictate()"
              class="btn shrink-0 size-9 p-0 rounded-lg transition-all duration-150"
              :class="listening ? 'border-red-500/50 bg-red-500/15 text-red-500 shadow-[0_0_12px_rgba(239,68,68,0.35)] animate-pulse ring-2 ring-red-500/40' : 'text-muted hover:text-fg'"
              :aria-label="listening ? 'Stop dictation' : 'Speak'"
              :title="listening ? 'Stop' : 'Speak instead of typing (your browser turns speech into text)'"
              @click="toggleMic"
            >
              <component :is="listening ? MicOff : Mic" :size="16" />
            </button>
            <div class="relative min-w-0 flex-1">
              <textarea
                v-model="text"
                rows="1"
                class="input chat-input resize-none text-[16px] sm:text-[14px] leading-relaxed py-2"
                :placeholder="listening ? 'Listening… speak now' : isCoach ? 'Type or press the mic and answer out loud…' : 'Message ' + agent.name + '…'"
                @keydown="onKey"
              />
              <p v-if="interim" class="pointer-events-none absolute right-2.5 bottom-2 left-2.5 truncate text-xs text-faint italic">{{ interim }}</p>
            </div>
            <button
              class="btn btn-primary shrink-0 size-9 p-0 rounded-lg shadow-sm"
              :disabled="sending || uploading || !(text.trim() || interim || photos.length)"
              :class="!(text.trim() || interim || photos.length) || sending || uploading ? 'opacity-40 cursor-not-allowed' : 'opacity-100'"
              aria-label="Send"
              title="Send message"
              @click="send()"
            >
              <SendHorizontal :size="16" />
            </button>
          </div>
          <p class="mt-1.5 text-[11px] text-faint">
            Enter to send · Shift+Enter for newline<template v-if="canDictate()"> · mic uses speech recognition</template>
          </p>
        </footer>
      </section>
      <p v-else class="text-sm text-muted">No enabled agents. <RouterLink to="/agents" class="text-accent hover:underline">Add one</RouterLink>.</p>
    </div>
  </div>
</template>

<style scoped>
.chat-input {
  field-sizing: content;
  min-height: 2.375rem;
  max-height: 9rem;
}
.chat-reply :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.85em;
  padding: 0.15rem 0.35rem;
  border-radius: 0.375rem;
  background-color: var(--sunken);
  border: 1px solid var(--line);
}
.chat-reply :deep(strong) {
  font-weight: 600;
  color: var(--fg);
}
</style>
