<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import {
  AlertCircle,
  ChevronDown,
  ExternalLink,
  ImagePlus,
  LoaderCircle,
  MessageSquare,
  Mic,
  MicOff,
  SendHorizontal,
  Square,
  Volume2,
  X,
} from "lucide-vue-next";
import type { Agent } from "@agent-office/shared";
import AgentAvatar from "../AgentAvatar.vue";
import RunStatusCard from "../RunStatusCard.vue";
import { api, type ChatMessage } from "../../api/http.ts";
import { useOffice } from "../../stores/office.ts";
import { canDictate, canSpeak } from "../../speech.ts";
import { fmtTime } from "../../format.ts";
import { useChatThread } from "../../chat/useChatThread.ts";
import {
  formatLiteMarkdown,
  isAudioAttachment,
  isChattableAgent,
  isDocAttachment,
  isVideoAttachment,
} from "../../chat/chatThreadHelpers.ts";

const props = defineProps<{
  /** Active agent id in the office to switch dock to. */
  agentId?: string | null;
  /** Whether the dock is open (v-model:open). */
  open?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "selectAgent", agentId: string): void;
}>();

const office = useOffice();

const LS_OPEN_KEY = "ao:quickchat:open";
const LS_AGENT_KEY = "ao:quickchat:agent";

function readStoredOpen(): boolean {
  try {
    return localStorage.getItem(LS_OPEN_KEY) === "true";
  } catch {
    return false;
  }
}

function readStoredAgent(): string | null {
  try {
    return localStorage.getItem(LS_AGENT_KEY);
  } catch {
    return null;
  }
}

const isOpen = ref<boolean>(props.open ?? readStoredOpen());
const unread = ref(false);
const scroller = ref<HTMLElement>();
const textareaRef = ref<HTMLTextAreaElement>();
const fileInput = ref<HTMLInputElement>();

// Chat-able agents only (not external runner agents)
const chatAgents = computed<Agent[]>(() => office.agents.filter(isChattableAgent));

// Selected agent ID
const activeAgentId = ref<string | null>(props.agentId ?? readStoredAgent() ?? chatAgents.value[0]?.id ?? null);

// If selected agent ID is invalid, pick first available
watch(
  chatAgents,
  (list) => {
    if (list.length && (!activeAgentId.value || !list.some((a) => a.id === activeAgentId.value))) {
      activeAgentId.value = list[0]!.id;
    }
  },
  { immediate: true },
);

// Switch agent when prop changes
watch(
  () => props.agentId,
  (id) => {
    if (id && chatAgents.value.some((a) => a.id === id)) {
      activeAgentId.value = id;
    }
  },
);

// Sync open prop
watch(
  () => props.open,
  (val) => {
    if (val !== undefined && val !== isOpen.value) {
      isOpen.value = val;
    }
  },
);

// Save open state to localStorage and emit
watch(isOpen, (val) => {
  emit("update:open", val);
  if (val) unread.value = false;
  try {
    localStorage.setItem(LS_OPEN_KEY, String(val));
  } catch {}
  if (val) {
    void scrollToBottom();
    nextTick(() => textareaRef.value?.focus());
  }
});

// Save agent state to localStorage
watch(activeAgentId, (id) => {
  if (id) {
    try {
      localStorage.setItem(LS_AGENT_KEY, id);
    } catch {}
    emit("selectAgent", id);
  }
});

const currentAgent = computed<Agent | undefined>(() =>
  chatAgents.value.find((a) => a.id === activeAgentId.value),
);

// Coach listens for English, others Malay
const isCoach = computed(() => currentAgent.value?.slug === "english-coach");
const lang = computed(() => (isCoach.value ? "en-US" : "ms-MY"));

// Chat thread composable with max 4 photos
const chat = useChatThread(currentAgent, {
  maxPhotos: 4,
  onMessageSent: () => void scrollToBottom(true),
  onThreadChanged: () => void scrollToBottom(true),
});

const {
  threads,
  threadId,
  messages,
  text,
  interim,
  sending,
  error,
  photos,
  uploading,
  uploadPct,
  stopping,
  listening,
  speaking,
  removePhoto,
  addPhotos,
  send: chatSend,
  stopReply,
  live,
  toggleMic: chatToggleMic,
  say: chatSay,
} = chat;

// Agent status: idle / thinking / needs approval
const agentActivity = computed(() => {
  if (!currentAgent.value) return "idle";
  const state = office.state.agents[currentAgent.value.id];
  return state?.activity ?? "idle";
});

const isThinking = computed(() => {
  if (agentActivity.value === "working") return true;
  const last = messages.value.at(-1);
  return last ? live(last).isThinking : false;
});

const needsApproval = computed(() => agentActivity.value === "waiting_approval");

// Last ~6 messages for quick context
const visibleMessages = computed(() => messages.value.slice(-6));

// Notice unread reply arrival if collapsed
watch(
  () => messages.value.map((m) => `${m.job_id}:${live(m).status}:${live(m).reply.length}`).join("|"),
  () => {
    if (!isOpen.value) {
      unread.value = true;
    } else {
      void scrollToBottom();
    }
  },
);

async function scrollToBottom(force = false) {
  await nextTick();
  const el = scroller.value;
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: force ? "smooth" : "auto" });
}

function handleKeydown(e: KeyboardEvent) {
  // Prevent office WASD / arrow walking shortcuts from triggering while typing
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code)) {
    e.stopPropagation();
  }
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void submit();
  }
}

async function submit() {
  if (sending.value || uploading.value) return;
  await chatSend();
  await scrollToBottom(true);
}

function onFileSelect(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = input.files;
  if (!files?.length) return;
  input.value = "";
  void addPhotos(files);
}

function toggleMic() {
  chatToggleMic(lang.value);
}

function say(m: ChatMessage) {
  chatSay(m, lang.value, isCoach.value);
}

// Global Esc key collapses quick chat
function onGlobalKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && isOpen.value) {
    isOpen.value = false;
  }
}

onMounted(() => {
  window.addEventListener("keydown", onGlobalKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onGlobalKeydown);
});

// Full chat URL for the active agent and thread
const fullChatUrl = computed(() => {
  if (!currentAgent.value) return "/chat";
  const params = new URLSearchParams();
  params.set("agent", currentAgent.value.slug);
  if (threadId.value) params.set("thread", threadId.value);
  return `/chat?${params.toString()}`;
});
</script>

<template>
  <div class="quick-chat-container">
    <!-- Collapsed Round Floating Button -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 scale-90 translate-y-2"
      enter-to-class="opacity-100 scale-100 translate-y-0"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100 scale-100 translate-y-0"
      leave-to-class="opacity-0 scale-90 translate-y-2"
    >
      <button
        v-if="!isOpen"
        type="button"
        class="group fixed bottom-5 right-5 z-30 flex size-13 items-center justify-center rounded-full border border-line-strong bg-surface text-fg shadow-card backdrop-blur-md transition-all duration-200 hover:scale-105 hover:border-accent hover:shadow-lg active:scale-95"
        :aria-label="`Open quick chat with ${currentAgent?.name ?? 'agent'}`"
        @click="isOpen = true"
      >
        <span v-if="currentAgent" class="relative">
          <AgentAvatar :name="currentAgent.name" :slug="currentAgent.slug" :size="30" />
          <span
            v-if="unread"
            class="absolute -top-1 -right-1 size-3.5 rounded-full border-2 border-surface bg-accent animate-pulse"
          />
        </span>
        <span v-else class="relative">
          <MessageSquare :size="20" class="text-accent" />
          <span
            v-if="unread"
            class="absolute -top-1 -right-1 size-3.5 rounded-full border-2 border-surface bg-accent animate-pulse"
          />
        </span>
      </button>
    </Transition>

    <!-- Expanded Dock Panel / Bottom Sheet -->
    <Transition
      enter-active-class="transition duration-250 ease-out"
      enter-from-class="opacity-0 translate-y-4 scale-95 max-sm:translate-y-full"
      enter-to-class="opacity-100 translate-y-0 scale-100 max-sm:translate-y-0"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100 translate-y-0 scale-100 max-sm:translate-y-0"
      leave-to-class="opacity-0 translate-y-4 scale-95 max-sm:translate-y-full"
    >
      <aside
        v-if="isOpen"
        class="fixed bottom-5 right-5 z-30 flex h-130 max-h-[calc(100vh-5rem)] w-92 max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-line bg-surface/98 shadow-2xl backdrop-blur-xl transition-all max-sm:inset-x-0 max-sm:bottom-0 max-sm:h-[82vh] max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:border-x-0 max-sm:border-b-0"
        role="region"
        aria-label="Office quick chat"
      >
        <!-- Header -->
        <header class="flex items-center justify-between border-b border-line bg-surface/90 px-3.5 py-2.5">
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <!-- Agent Switcher Dropdown -->
            <div class="relative min-w-0 flex-1">
              <select
                v-model="activeAgentId"
                class="w-full appearance-none rounded-lg border border-line bg-surface-2/80 py-1 pl-2.5 pr-7 text-xs font-semibold text-fg focus:border-accent focus:outline-none cursor-pointer"
                aria-label="Select agent"
              >
                <option v-for="a in chatAgents" :key="a.id" :value="a.id">
                  {{ a.name }}
                </option>
              </select>
              <ChevronDown :size="13" class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted" />
            </div>

            <!-- Agent status pill -->
            <div class="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-muted">
              <span
                v-if="needsApproval"
                class="flex items-center gap-1 rounded-full bg-signal-soft px-2 py-0.5 text-signal font-semibold"
              >
                <AlertCircle :size="11" /> Needs approval
              </span>
              <span
                v-else-if="isThinking"
                class="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-accent font-semibold"
              >
                <LoaderCircle :size="11" class="animate-spin" /> Thinking…
              </span>
              <span v-else class="flex items-center gap-1 text-faint">
                <span class="size-1.5 rounded-full bg-accent/60" /> Idle
              </span>
            </div>
          </div>

          <!-- Actions: Open full chat & Collapse -->
          <div class="ml-2 flex items-center gap-1">
            <RouterLink
              :to="fullChatUrl"
              class="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-fg"
              title="Open full chat in separate page"
              aria-label="Open full chat"
            >
              <ExternalLink :size="14" />
            </RouterLink>
            <button
              type="button"
              class="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-fg"
              title="Collapse (Esc)"
              aria-label="Collapse quick chat"
              @click="isOpen = false"
            >
              <ChevronDown :size="16" class="max-sm:hidden" />
              <X :size="16" class="sm:hidden" />
            </button>
          </div>
        </header>

        <!-- Message List (Last ~6 messages) -->
        <div ref="scroller" class="flex-1 space-y-3.5 overflow-y-auto p-3.5 text-xs">
          <!-- Empty State -->
          <div v-if="!messages.length" class="flex h-full flex-col items-center justify-center p-4 text-center text-muted">
            <AgentAvatar v-if="currentAgent" :name="currentAgent.name" :slug="currentAgent.slug" :size="40" class="mb-2" />
            <p class="font-medium text-fg">Quick Chat with {{ currentAgent?.name ?? "Agent" }}</p>
            <p class="mt-1 text-[11px] text-faint leading-relaxed">
              Ask short questions or give instructions right inside the 3D office.
            </p>
          </div>

          <!-- Message Bubbles -->
          <template v-for="m in visibleMessages" :key="m.job_id">
            <!-- User Message on Right -->
            <div class="flex flex-col items-end">
              <div
                class="max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-3.5 py-2 text-[13px] leading-relaxed text-accent-ink whitespace-pre-wrap shadow-xs"
              >
                <!-- Attachments preview -->
                <div v-if="m.attachments?.length" class="mb-1.5 flex flex-wrap gap-1">
                  <template v-for="a in m.attachments" :key="a.id">
                    <span v-if="isAudioAttachment(a)" class="text-[11px] font-mono">🎙️ {{ a.name }}</span>
                    <span v-else-if="isVideoAttachment(a)" class="text-[11px] font-mono">🎬 {{ a.name }}</span>
                    <span v-else-if="isDocAttachment(a)" class="text-[11px] font-mono">📄 {{ a.name }}</span>
                    <img
                      v-else
                      :src="api.uploadUrl(a.id)"
                      :alt="a.name"
                      class="size-14 rounded-lg object-cover border border-white/20"
                      loading="lazy"
                    />
                  </template>
                </div>
                {{ m.text }}
              </div>
              <span class="mt-0.5 px-1 font-mono text-[9px] text-faint">{{ fmtTime(m.created_at) }}</span>
            </div>

            <!-- Agent Message on Left -->
            <div class="flex items-start gap-2">
              <AgentAvatar
                v-if="currentAgent"
                :name="currentAgent.name"
                :slug="currentAgent.slug"
                :size="24"
                class="mt-0.5 shrink-0"
              />
              <div class="min-w-0 max-w-[85%]">
                <div class="rounded-2xl rounded-tl-sm border border-line bg-surface-2/90 px-3.5 py-2 text-[13px] leading-relaxed text-fg shadow-xs">
                  <!-- Live Reply or Truncated Message -->
                  <div
                    v-if="live(m).reply"
                    class="whitespace-pre-wrap leading-relaxed text-[12.5px]"
                    v-html="formatLiteMarkdown(live(m).reply.length > 320 ? live(m).reply.slice(0, 310) + '…' : live(m).reply)"
                  />

                  <!-- Clipped "More" link if long -->
                  <RouterLink
                    v-if="live(m).reply && live(m).reply.length > 320"
                    :to="fullChatUrl"
                    class="mt-1 inline-flex items-center gap-0.5 text-[11px] font-semibold text-accent hover:underline"
                  >
                    <span>Read full reply in Chat</span>
                    <ExternalLink :size="11" />
                  </RouterLink>

                  <!-- Status card if still working -->
                  <RunStatusCard
                    v-if="live(m).status !== 'done'"
                    :job-id="m.job_id"
                    compact
                    :class="live(m).reply ? 'mt-2' : ''"
                    @stop="stopReply(m.job_id)"
                  />
                  <p v-else-if="!live(m).reply && !m.renders?.length" class="text-xs text-muted">
                    Selesai tanpa jawapan bertulis.
                  </p>
                </div>

                <!-- Footer actions: time, read aloud, stop button -->
                <div class="mt-1 flex items-center gap-2.5 px-1 text-[10px] text-faint">
                  <span class="font-mono">{{ fmtTime(m.created_at) }}</span>
                  <button
                    v-if="live(m).reply && canSpeak()"
                    type="button"
                    class="inline-flex items-center gap-1 hover:text-fg transition-colors"
                    @click="say(m)"
                  >
                    <component :is="speaking === m.job_id ? Square : Volume2" :size="11" />
                    {{ speaking === m.job_id ? "Stop" : "Listen" }}
                  </button>
                  <button
                    v-if="live(m).status === 'running'"
                    type="button"
                    class="text-danger hover:underline font-semibold"
                    :disabled="stopping === m.job_id"
                    @click="stopReply(m.job_id)"
                  >
                    {{ stopping === m.job_id ? "Stopping…" : "Stop" }}
                  </button>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- Attachment Previews -->
        <div v-if="photos.length" class="flex items-center gap-2 border-t border-line bg-surface-2/60 px-3 py-2 overflow-x-auto">
          <div v-for="p in photos" :key="p.id" class="group relative size-12 shrink-0 rounded-lg overflow-hidden border border-line">
            <img :src="p.preview" :alt="p.name" class="size-full object-cover" />
            <button
              type="button"
              class="absolute inset-0 flex items-center justify-center bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Remove attachment"
              @click="removePhoto(p.id)"
            >
              <X :size="14" />
            </button>
          </div>
          <span v-if="uploading" class="flex items-center gap-1.5 text-[11px] text-muted">
            <LoaderCircle :size="12" class="animate-spin text-accent" />
            {{ uploadPct !== null ? `${uploadPct}%` : "Uploading…" }}
          </span>
        </div>

        <!-- Input Box -->
        <footer class="border-t border-line bg-surface p-2.5">
          <div v-if="error" class="mb-2 text-[11px] text-danger">{{ error }}</div>
          <form class="flex items-end gap-1.5" @submit.prevent="submit">
            <!-- Hidden file input for photos (≤ 4 photos) -->
            <input
              ref="fileInput"
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
              multiple
              class="hidden"
              @change="onFileSelect"
            />
            <button
              type="button"
              class="rounded-lg p-2 text-muted transition-colors hover:bg-surface-2 hover:text-fg"
              :class="photos.length >= 4 ? 'opacity-40 pointer-events-none' : ''"
              title="Attach photo/video (max 4)"
              aria-label="Attach photo"
              @click="fileInput?.click()"
            >
              <ImagePlus :size="16" />
            </button>

            <!-- Mic Dictation Button -->
            <button
              v-if="canDictate()"
              type="button"
              class="rounded-lg p-2 transition-colors"
              :class="listening ? 'bg-danger-soft text-danger animate-pulse' : 'text-muted hover:bg-surface-2 hover:text-fg'"
              :title="listening ? 'Stop listening' : 'Dictate with microphone'"
              aria-label="Toggle dictation"
              @click="toggleMic"
            >
              <component :is="listening ? MicOff : Mic" :size="16" />
            </button>

            <!-- Text Input -->
            <div class="relative flex-1">
              <textarea
                ref="textareaRef"
                v-model="text"
                rows="1"
                class="w-full resize-none rounded-xl border border-line-strong bg-surface-2/60 px-3 py-1.5 text-xs text-fg placeholder:text-faint focus:border-accent focus:bg-surface focus:outline-none"
                placeholder="Ask agent… (Enter sends)"
                aria-label="Type message"
                @keydown="handleKeydown"
              />
              <span v-if="interim" class="pointer-events-none absolute left-3 top-1.5 text-xs text-accent italic">
                {{ interim }}
              </span>
            </div>

            <!-- Send Button -->
            <button
              type="submit"
              class="rounded-xl bg-accent p-2 text-accent-ink transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
              :disabled="(!text.trim() && !photos.length) || sending || uploading"
              title="Send message"
              aria-label="Send message"
            >
              <LoaderCircle v-if="sending" :size="16" class="animate-spin" />
              <SendHorizontal v-else :size="16" />
            </button>
          </form>
        </footer>
      </aside>
    </Transition>
  </div>
</template>

<style scoped>
.quick-chat-container {
  isolation: isolate;
}
</style>

