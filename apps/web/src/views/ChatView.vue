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
        <div class="card divide-y divide-line">
          <button
            v-for="a in agents"
            :key="a.id"
            class="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-2"
            :class="a.id === agent?.id && 'bg-accent-soft hover:bg-accent-soft'"
            @click="pickAgent(a.slug)"
          >
            <AgentAvatar :name="a.name" :slug="a.slug" :size="30" />
            <span class="min-w-0">
              <span class="block truncate text-sm font-medium">{{ a.name }}</span>
              <span class="block truncate text-xs text-muted">{{ a.role }}</span>
            </span>
          </button>
        </div>
        <div v-if="agent">
          <div class="mb-1.5 flex items-center">
            <span class="sign">Conversations</span>
            <button class="btn btn-ghost btn-sm ml-auto" @click="openThread(null)"><Plus :size="13" /> New</button>
          </div>
          <div class="space-y-1">
            <button
              v-for="t in threads"
              :key="t.thread_id"
              class="block w-full truncate rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-2"
              :class="t.thread_id === threadId ? 'bg-surface-2 font-medium text-fg' : 'text-muted'"
              @click="openThread(t.thread_id)"
            >
              {{ threadTitle(t) }}
            </button>
            <p v-if="!threads.length" class="px-2.5 text-xs text-faint">No conversations yet.</p>
          </div>
        </div>
      </aside>

      <!-- the conversation -->
      <section v-if="agent" class="card flex h-[calc(100dvh-15rem)] min-h-112 flex-col overflow-hidden max-lg:h-[calc(100dvh-17rem)]">
        <header class="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-2.5">
          <select class="input basis-full lg:hidden" :value="agent.slug" aria-label="Chat with" @change="pickAgent(($event.target as HTMLSelectElement).value)">
            <option v-for="a in agents" :key="a.id" :value="a.slug">{{ a.name }}{{ a.role ? ` · ${a.role}` : "" }}</option>
          </select>
          <AgentAvatar :name="agent.name" :slug="agent.slug" :size="34" />
          <div class="min-w-0 flex-1">
            <div class="truncate font-semibold">{{ agent.name }}</div>
            <div class="truncate text-xs text-muted">{{ agent.role }}</div>
          </div>
          <select v-if="isMarketing" v-model="projectId" class="input w-auto text-xs" aria-label="Project" :disabled="!!threadId && messages.length > 0">
            <option value="">Any project</option>
            <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <label v-if="canSpeak()" class="inline-flex items-center gap-1.5 text-xs text-muted" title="Read new replies aloud">
            <input v-model="autoSpeak" type="checkbox" class="accent-accent" /> <Volume2 :size="14" /> <span class="max-sm:sr-only">Read aloud</span>
          </label>
          <button class="btn btn-sm lg:hidden" @click="openThread(null)"><Plus :size="13" /> New</button>
        </header>

        <div ref="scroller" class="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <div v-if="!messages.length" class="mx-auto max-w-md pt-6 text-center">
            <p class="font-medium">Start a conversation with {{ agent.name }}</p>
            <p class="mt-1 text-sm text-muted">
              <template v-if="isCoach">Speak or type. Coach replies, asks a follow-up and shows a more natural way to say it.</template>
              <template v-else-if="isMarketing">Ask for posts or ideas. Anything it writes lands in <RouterLink to="/drafts" class="text-accent hover:underline">Drafts</RouterLink> for you to approve.</template>
              <template v-else>Ask anything about its work.</template>
            </p>
            <div class="mt-4 flex flex-col gap-2">
              <button v-for="s in starters" :key="s" class="rounded-lg border border-line bg-surface px-3 py-2 text-left text-sm hover:bg-surface-2" @click="send(s)">{{ s }}</button>
            </div>
          </div>

          <template v-for="m in messages" :key="m.job_id">
            <div class="flex justify-end">
              <p class="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[14px] leading-relaxed whitespace-pre-wrap text-accent-ink">{{ m.text }}</p>
            </div>
            <div class="flex items-start gap-2">
              <AgentAvatar :name="agent.name" :slug="agent.slug" :size="26" />
              <div class="max-w-[85%] min-w-0">
                <div class="rounded-2xl rounded-tl-md border border-line bg-surface-2 px-3.5 py-2 text-[14px] leading-relaxed">
                  <p v-if="live(m).reply" class="whitespace-pre-wrap" v-html="lite(live(m).reply)" />
                  <p v-else-if="live(m).status === 'failed'" class="text-danger">Could not answer: {{ live(m).error ?? "the run failed" }}</p>
                  <p v-else-if="live(m).status === 'cancelled'" class="text-faint">Cancelled.</p>
                  <p v-else class="flex items-center gap-2 text-muted">
                    <span class="inline-flex gap-1"><span class="size-1.5 animate-bounce rounded-full bg-current" /><span class="size-1.5 animate-bounce rounded-full bg-current [animation-delay:120ms]" /><span class="size-1.5 animate-bounce rounded-full bg-current [animation-delay:240ms]" /></span>
                    {{ live(m).status === "queued" ? "waiting for a runner…" : live(m).status === "waiting_approval" ? "waiting for your approval" : "thinking…" }}
                  </p>
                </div>
                <div class="mt-1 flex items-center gap-3 text-[11px] text-faint">
                  <span>{{ fmtTime(m.created_at) }}</span>
                  <button v-if="live(m).reply && canSpeak()" class="inline-flex items-center gap-1 hover:text-fg" @click="say(m)">
                    <component :is="speaking === m.job_id ? Square : Volume2" :size="12" /> {{ speaking === m.job_id ? "Stop" : "Listen" }}
                  </button>
                  <RouterLink v-if="live(m).runId" :to="{ name: 'run', params: { id: live(m).runId } }" class="hover:text-fg">details</RouterLink>
                </div>
              </div>
            </div>
          </template>
        </div>

        <footer class="border-t border-line p-3">
          <p v-if="error" class="mb-2 text-sm text-danger">{{ error }}</p>
          <div class="flex items-end gap-2">
            <button
              v-if="canDictate()"
              class="btn shrink-0"
              :class="listening ? 'btn-signal' : ''"
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
                class="input resize-none text-[14px]"
                :placeholder="listening ? 'Listening… speak now' : isCoach ? 'Type or press the mic and answer out loud…' : 'Message ' + agent.name + '…'"
                @keydown="onKey"
              />
              <p v-if="interim" class="pointer-events-none absolute right-2 bottom-1.5 left-2.5 truncate text-xs text-faint italic">{{ interim }}</p>
            </div>
            <button class="btn btn-primary shrink-0" :disabled="sending || !(text.trim() || interim)" aria-label="Send" @click="send()"><SendHorizontal :size="16" /></button>
          </div>
          <p class="mt-1.5 text-[11px] text-faint">Enter to send · Shift+Enter for a new line<template v-if="canDictate()"> · the mic uses your browser's speech service</template></p>
        </footer>
      </section>
      <p v-else class="text-sm text-muted">No enabled agents. <RouterLink to="/agents" class="text-accent hover:underline">Add one</RouterLink>.</p>
    </div>
  </div>
</template>
