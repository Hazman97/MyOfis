<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { Mic, MicOff, Plus, SendHorizontal, Square, Volume2 } from "lucide-vue-next";
import type { Agent, Project } from "@agent-office/shared";
import AgentAvatar from "../components/AgentAvatar.vue";
import PageHeader from "../components/PageHeader.vue";
import { api, type ChatMessage, type ChatThread } from "../api/http.ts";
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

const agents = computed(() => office.agents.filter((a) => a.enabled));
const agent = computed<Agent | undefined>(() => agents.value.find((a) => a.slug === route.query.agent) ?? agents.value.find((a) => a.slug === "english-coach") ?? agents.value[0]);
const threads = ref<ChatThread[]>([]);
const threadId = ref<string | null>(null);
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
  await scrollDown();
}

async function scrollDown() {
  await nextTick();
  scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: "smooth" });
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

async function send(body = text.value) {
  const t = (body + (interim.value ? ` ${interim.value}` : "")).trim();
  if (!t || !agent.value || sending.value) return;
  listening.value?.stop();
  sending.value = true;
  error.value = "";
  try {
    const res = await api.chat({ agent_id: agent.value.id, text: t, thread_id: threadId.value, project_id: projectId.value || null });
    if (!threadId.value) {
      threadId.value = res.thread_id;
      void loadThreads();
    }
    messages.value.push({ job_id: res.job.id, agent_id: agent.value.id, text: t, created_at: res.job.created_at, status: res.job.status, run_id: null, reply: null });
    text.value = "";
    interim.value = "";
    await scrollDown();
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

onBeforeUnmount(() => {
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
        <div class="card overflow-hidden divide-y divide-line">
          <button
            v-for="a in agents"
            :key="a.id"
            class="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-all duration-150"
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
            <button class="btn btn-ghost btn-sm h-6 px-2 text-[11px]" @click="openThread(null)"><Plus :size="12" /> New</button>
          </div>
          <div class="space-y-1">
            <button
              v-for="t in threads"
              :key="t.thread_id"
              class="block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors"
              :class="t.thread_id === threadId ? 'bg-surface-2 font-medium text-fg shadow-sm' : 'text-muted hover:bg-surface-2/60 hover:text-fg'"
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
          <select v-if="isMarketing" v-model="projectId" class="input w-auto text-xs py-1" aria-label="Project" :disabled="!!threadId && messages.length > 0">
            <option value="">Any project</option>
            <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <label v-if="canSpeak()" class="inline-flex items-center gap-1.5 text-xs text-muted cursor-pointer hover:text-fg transition-colors" title="Read new replies aloud">
            <input v-model="autoSpeak" type="checkbox" class="accent-accent" /> <Volume2 :size="14" /> <span class="max-sm:sr-only">Read aloud</span>
          </label>
          <button class="btn btn-ghost btn-sm h-7 lg:hidden" @click="openThread(null)"><Plus :size="13" /> New</button>
        </header>

        <div ref="scroller" class="flex-1 space-y-4 overflow-y-auto px-4 py-5">
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
                class="group rounded-xl border border-line bg-surface p-3 text-xs text-fg transition-all duration-150 hover:border-line-strong hover:bg-surface-2 hover:-translate-y-0.5 hover:shadow-card active:scale-[0.99]"
                @click="send(s)"
              >
                <span class="line-clamp-3 leading-relaxed">{{ s }}</span>
                <span class="mt-1.5 block text-[10px] font-medium text-accent group-hover:translate-x-0.5 transition-transform">Send prompt →</span>
              </button>
            </div>
          </div>

          <!-- Message Bubbles -->
          <template v-for="m in messages" :key="m.job_id">
            <!-- Owner message on right -->
            <div class="flex justify-end">
              <div class="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-br-sm bg-accent px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap text-accent-ink shadow-sm">
                {{ m.text }}
              </div>
            </div>

            <!-- Agent message on left -->
            <div class="flex items-start gap-2.5">
              <AgentAvatar :name="agent.name" :slug="agent.slug" :size="28" class="mt-0.5 shrink-0" />
              <div class="max-w-[85%] sm:max-w-[75%] min-w-0">
                <div class="rounded-2xl rounded-tl-sm border border-line bg-surface-2/90 px-4 py-2.5 text-[14px] leading-relaxed text-fg shadow-sm">
                  <div v-if="live(m).reply" class="whitespace-pre-wrap" v-html="lite(live(m).reply)" />
                  <p v-else-if="live(m).status === 'failed'" class="text-danger font-medium">Could not answer: {{ live(m).error ?? "the run failed" }}</p>
                  <p v-else-if="live(m).status === 'cancelled'" class="text-faint">Cancelled.</p>
                  <div v-else class="flex items-center gap-2 text-muted">
                    <span class="inline-flex gap-1">
                      <span class="size-1.5 animate-bounce rounded-full bg-accent" />
                      <span class="size-1.5 animate-bounce rounded-full bg-accent [animation-delay:120ms]" />
                      <span class="size-1.5 animate-bounce rounded-full bg-accent [animation-delay:240ms]" />
                    </span>
                    <span class="text-xs font-medium">{{ live(m).status === "queued" ? "waiting for a runner…" : live(m).status === "waiting_approval" ? "waiting for your approval" : "thinking…" }}</span>
                  </div>
                </div>
                <div class="mt-1.5 flex items-center gap-3 px-1 text-[11px] text-faint">
                  <span>{{ fmtTime(m.created_at) }}</span>
                  <button v-if="live(m).reply && canSpeak()" class="inline-flex items-center gap-1 hover:text-fg transition-colors" @click="say(m)">
                    <component :is="speaking === m.job_id ? Square : Volume2" :size="12" /> {{ speaking === m.job_id ? "Stop" : "Listen" }}
                  </button>
                  <RouterLink v-if="live(m).runId" :to="{ name: 'run', params: { id: live(m).runId } }" class="hover:text-fg transition-colors">details</RouterLink>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- Composer -->
        <footer class="border-t border-line bg-surface/50 p-3 backdrop-blur-sm">
          <p v-if="error" class="mb-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-1.5 text-xs text-danger">{{ error }}</p>
          <div class="flex items-end gap-2">
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
                rows="2"
                class="input resize-none text-[14px] leading-relaxed py-2 max-h-32"
                :placeholder="listening ? 'Listening… speak now' : isCoach ? 'Type or press the mic and answer out loud…' : 'Message ' + agent.name + '…'"
                @keydown="onKey"
              />
              <p v-if="interim" class="pointer-events-none absolute right-2.5 bottom-2 left-2.5 truncate text-xs text-faint italic">{{ interim }}</p>
            </div>
            <button
              class="btn btn-primary shrink-0 size-9 p-0 rounded-lg shadow-sm"
              :disabled="sending || !(text.trim() || interim)"
              aria-label="Send"
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
