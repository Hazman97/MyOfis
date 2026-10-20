<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Bot, LoaderCircle, Send, Sparkles, X } from "lucide-vue-next";
import type { EditSuggestion } from "@agent-office/shared";
import { api, type ChatMessage } from "../../api/http.ts";
import { useOffice } from "../../stores/office.ts";
import { fmtTime } from "../../format.ts";
import AgentAvatar from "../AgentAvatar.vue";
import EditSuggestionCards from "../EditSuggestionCards.vue";
import RunStatusCard from "../RunStatusCard.vue";

/**
 * AskEditorPanel (Task 015):
 * Small focused chat with Editor directly within the Video Studio.
 * - Thread id is scoped per video in localStorage.
 * - Sends video attachments on the first message.
 * - Polls thread until answers complete.
 * - Renders suggestions with "Use in timeline" button.
 */
const props = defineProps<{
  uploadId: string;
  videoSources: { id: string; name: string }[];
}>();

const emit = defineEmits<{
  (e: "use-suggestion", option: EditSuggestion, attachments: { id: string }[]): void;
  (e: "close"): void;
}>();

const office = useOffice();
const messages = ref<ChatMessage[]>([]);
const input = ref("");
const sending = ref(false);
const error = ref("");
const scrollArea = ref<HTMLDivElement | null>(null);

const storageKey = computed(() => `myofis-studio-thread-${props.uploadId}`);

function getStoredThreadId(): string | null {
  try {
    return localStorage.getItem(storageKey.value);
  } catch {
    return null;
  }
}

function setStoredThreadId(id: string) {
  try {
    localStorage.setItem(storageKey.value, id);
  } catch {}
}

const threadId = ref<string | null>(getStoredThreadId());

const editorAgent = computed(() => office.agents.find((a) => a.slug === "editor"));

const QUICK_CHIPS = [
  "Suggest edits",
  "Make it 30 s for TikTok",
  "Add subtitles",
  "Cut the ums",
];

let pollTimer: ReturnType<typeof setInterval> | null = null;

function hasPendingMessages(): boolean {
  return messages.value.some((m) =>
    ["queued", "running", "waiting_approval"].includes(m.status),
  );
}

async function fetchThread() {
  if (!threadId.value) return;
  try {
    const res = await api.chatThread(threadId.value);
    messages.value = res.messages;
    if (!hasPendingMessages()) {
      stopPolling();
    }
    await nextTick();
    scrollToBottom();
  } catch (e) {
    // If thread is not found or fails, don't crash
    console.warn("Failed to fetch studio chat thread", e);
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    void fetchThread();
  }, 3000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function scrollToBottom() {
  if (scrollArea.value) {
    scrollArea.value.scrollTop = scrollArea.value.scrollHeight;
  }
}

async function send(quickText?: string) {
  const t = (quickText ?? input.value).trim();
  if (!t || sending.value) return;

  if (!editorAgent.value) {
    error.value = "Editor agent not found in this room.";
    return;
  }

  error.value = "";
  sending.value = true;
  if (!quickText) input.value = "";

  const isFirst = !messages.value.length;
  const attachmentsToSend = isFirst ? props.videoSources.map((v) => v.id) : undefined;

  try {
    const res = await api.chat({
      agent_id: editorAgent.value.id,
      text: t,
      thread_id: threadId.value,
      attachments: attachmentsToSend,
    });

    if (!threadId.value) {
      threadId.value = res.thread_id;
      setStoredThreadId(res.thread_id);
    }

    messages.value.push({
      job_id: res.job.id,
      agent_id: editorAgent.value.id,
      text: t,
      created_at: res.job.created_at,
      status: res.job.status,
      run_id: null,
      reply: null,
    });

    await nextTick();
    scrollToBottom();
    startPolling();
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    sending.value = false;
  }
}

async function stopJob(jobId: string) {
  try {
    await api.cancelJob(jobId);
  } catch (err) {
    error.value = (err as Error).message;
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void send();
  }
}

watch(
  () => props.uploadId,
  () => {
    threadId.value = getStoredThreadId();
    messages.value = [];
    if (threadId.value) void fetchThread();
  },
);

onMounted(() => {
  if (threadId.value) void fetchThread();
});

onBeforeUnmount(() => {
  stopPolling();
});
</script>

<template>
  <div class="flex flex-col h-full bg-surface border border-line rounded-xl shadow-card overflow-hidden">
    <!-- Header -->
    <header class="flex items-center justify-between px-3.5 py-2.5 border-b border-line bg-surface-2/60 shrink-0">
      <div class="flex items-center gap-2">
        <AgentAvatar
          v-if="editorAgent"
          :name="editorAgent.name"
          :slug="editorAgent.slug"
          :size="26"
        />
        <div class="flex items-center gap-1.5">
          <h3 class="text-xs sm:text-sm font-semibold text-fg">Ask Editor</h3>
          <span class="chip chip-sm text-[10px] text-accent">Studio chat</span>
        </div>
      </div>

      <button
        type="button"
        class="btn btn-ghost btn-sm size-8 p-0 rounded-lg text-muted hover:text-fg"
        aria-label="Close Ask Editor"
        @click="$emit('close')"
      >
        <X :size="15" />
      </button>
    </header>

    <!-- Error notice -->
    <div v-if="error" class="p-2.5 text-xs text-danger bg-danger-soft border-b border-danger/20 shrink-0">
      {{ error }}
    </div>

    <!-- Messages List -->
    <div
      ref="scrollArea"
      class="flex-1 overflow-y-auto p-3 space-y-3 text-xs leading-relaxed"
    >
      <!-- Empty state with guidance and quick prompts -->
      <div v-if="!messages.length" class="py-6 px-2 text-center space-y-3">
        <div class="size-10 rounded-full bg-accent/10 text-accent flex items-center justify-center mx-auto">
          <Bot :size="20" />
        </div>
        <div class="space-y-1 max-w-xs mx-auto">
          <h4 class="font-semibold text-fg text-xs sm:text-sm">Talk to Editor</h4>
          <p class="text-[11px] text-muted leading-relaxed">
            Ask for cut suggestions, social clips, or subtitle ideas for this video.
          </p>
        </div>
      </div>

      <!-- Messages loop -->
      <template v-for="m in messages" :key="m.job_id">
        <!-- User message -->
        <div class="flex flex-col items-end">
          <div class="max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-accent-ink shadow-xs whitespace-pre-wrap">
            {{ m.text }}
          </div>
          <span class="mt-1 px-1 text-[10px] font-mono text-faint">
            {{ fmtTime(m.created_at) }}
          </span>
        </div>

        <!-- Editor message -->
        <div class="flex items-start gap-2">
          <AgentAvatar
            v-if="editorAgent"
            :name="editorAgent.name"
            :slug="editorAgent.slug"
            :size="24"
            class="mt-0.5 shrink-0"
          />
          <div class="max-w-[90%] min-w-0 space-y-2">
            <div class="rounded-2xl rounded-tl-sm border border-line bg-surface-2/90 px-3 py-2 text-fg shadow-xs">
              <!-- Reply text -->
              <div v-if="m.reply" class="whitespace-pre-wrap leading-relaxed text-xs">
                {{ m.reply }}
              </div>

              <!-- Live status: queued (place + why), current step, quiet, failed or stopped (+ why) -->
              <RunStatusCard
                v-if="(office.state.jobs[m.job_id]?.status ?? m.status) !== 'done'"
                :job-id="m.job_id"
                :compact="!!m.reply"
                :class="m.reply ? 'mt-2' : ''"
                @stop="stopJob(m.job_id)"
                @retry="send(m.text)"
              />

              <!-- Suggestions from Editor -->
              <div v-if="m.suggestions" class="mt-2.5 pt-2 border-t border-line/60">
                <EditSuggestionCards
                  :suggestions="m.suggestions"
                  mode="studio"
                  @use="(opt) => $emit('use-suggestion', opt, m.suggestions!.attachments)"
                />
              </div>
            </div>

            <span class="block px-1 text-[10px] font-mono text-faint">
              {{ fmtTime(m.created_at) }}
            </span>
          </div>
        </div>
      </template>
    </div>

    <!-- Quick prompt chips -->
    <div class="px-3 py-1.5 border-t border-line/50 bg-surface/80 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
      <button
        v-for="chip in QUICK_CHIPS"
        :key="chip"
        type="button"
        class="chip chip-sm text-[11px] whitespace-nowrap hover:border-accent hover:text-accent transition-colors cursor-pointer shrink-0"
        :disabled="sending"
        @click="send(chip)"
      >
        <Sparkles :size="10" class="text-accent" />
        {{ chip }}
      </button>
    </div>

    <!-- Composer -->
    <footer class="p-2.5 border-t border-line bg-surface-2/30 shrink-0">
      <div class="flex items-center gap-2">
        <input
          v-model="input"
          type="text"
          placeholder="Ask Editor about this video…"
          class="input text-xs sm:text-sm flex-1 min-h-10 px-3"
          :disabled="sending"
          @keydown="onKey"
        />
        <button
          type="button"
          class="btn btn-primary min-h-10 min-w-10 p-0 flex items-center justify-center shrink-0 cursor-pointer"
          :disabled="!input.trim() || sending"
          aria-label="Send message to Editor"
          @click="send()"
        >
          <LoaderCircle v-if="sending" :size="15" class="animate-spin" />
          <Send v-else :size="15" />
        </button>
      </div>
    </footer>
  </div>
</template>
