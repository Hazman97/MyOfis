import { onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from "vue";
import type { Agent } from "@agent-office/shared";
import { api, type ChatAttachment, type ChatMessage, type ChatThread } from "../api/http.ts";
import { useOffice } from "../stores/office.ts";
import { canDictate, dictate, speak, stopSpeaking, type Dictation } from "../speech.ts";
import {
  extractSpeakableText,
  isAudioAttachment,
  isVideoAttachment,
  liveMessageState,
  type LiveMessageResult,
} from "./chatThreadHelpers.ts";

export interface UseChatThreadOptions {
  maxPhotos?: number;
  initialThreadId?: string | null;
  onMessageSent?: () => void;
  onThreadChanged?: (threadId: string | null) => void;
}

export function useChatThread(
  agent: Ref<Agent | undefined> | ComputedRef<Agent | undefined>,
  options: UseChatThreadOptions = {},
) {
  const office = useOffice();
  const maxPhotos = options.maxPhotos ?? 10;

  const threads = ref<ChatThread[]>([]);
  const threadId = ref<string | null>(options.initialThreadId ?? null);
  const messages = ref<ChatMessage[]>([]);
  const text = ref("");
  const interim = ref("");
  const sending = ref(false);
  const error = ref("");
  const photos = ref<(ChatAttachment & { preview: string })[]>([]);
  const uploading = ref(false);
  const uploadPct = ref<number | null>(null);
  const stopping = ref<string | null>(null);
  const listening = ref<Dictation | null>(null);
  const speaking = ref<string | null>(null);
  const loadingThreads = ref(false);
  const loadingMessages = ref(false);

  async function loadThreads() {
    if (!agent.value) {
      threads.value = [];
      return;
    }
    loadingThreads.value = true;
    try {
      threads.value = (await api.chatThreads(agent.value.id)).threads;
    } catch (e) {
      threads.value = [];
    } finally {
      loadingThreads.value = false;
    }
  }

  async function openThread(id: string | null) {
    threadId.value = id;
    options.onThreadChanged?.(id);
    if (!id) {
      messages.value = [];
      return;
    }
    loadingMessages.value = true;
    try {
      messages.value = (await api.chatThread(id)).messages;
    } catch (e) {
      error.value = (e as Error).message;
      messages.value = [];
    } finally {
      loadingMessages.value = false;
    }
  }

  async function addPhotos(inputFiles: FileList | File[]) {
    const files = [...inputFiles].slice(0, maxPhotos - photos.value.length);
    if (!files.length) return;
    uploading.value = true;
    error.value = "";
    try {
      for (const file of files) {
        const isVidOrAud =
          file.type.startsWith("video/") ||
          file.type.startsWith("audio/") ||
          /\.(mp4|mov|webm|mkv|m4v|m4a|mp3|wav|ogg|oga|opus|weba|aac|flac|amr)$/i.test(file.name);
        uploadPct.value = isVidOrAud ? 0 : null;
        const up = isVidOrAud
          ? await api.uploadVideo(file, (d) => (uploadPct.value = Math.round(d * 100)))
          : await api.uploadImage(file);
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

  function clearPhotos() {
    for (const p of photos.value) URL.revokeObjectURL(p.preview);
    photos.value = [];
  }

  async function send(body = text.value, projectId = "") {
    const t =
      (body + (interim.value ? ` ${interim.value}` : "")).trim() ||
      (photos.value.length
        ? photos.value.some(isAudioAttachment)
          ? "(rakaman)"
          : photos.value.some(isVideoAttachment)
            ? "(video)"
            : "(photo)"
        : "");

    if (!t || !agent.value || sending.value || uploading.value) return;

    listening.value?.stop();
    sending.value = true;
    error.value = "";
    try {
      const sent = photos.value.map(({ id, name, content_type }) => ({ id, name, content_type }));
      const res = await api.chat({
        agent_id: agent.value.id,
        text: t,
        thread_id: threadId.value,
        project_id: projectId || null,
        attachments: sent.map((p) => p.id),
      });

      if (!threadId.value) {
        threadId.value = res.thread_id;
        void loadThreads();
      }

      messages.value.push({
        job_id: res.job.id,
        agent_id: agent.value.id,
        text: t,
        created_at: res.job.created_at,
        status: res.job.status,
        run_id: null,
        reply: null,
        attachments: sent,
      });

      clearPhotos();
      text.value = "";
      interim.value = "";
      options.onMessageSent?.();
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      sending.value = false;
    }
  }

  async function stopReply(jobId: string) {
    stopping.value = jobId;
    try {
      await api.cancelJob(jobId);
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      stopping.value = null;
    }
  }

  function live(m: ChatMessage): LiveMessageResult {
    return liveMessageState(office.state.jobs, office.state.runs, m);
  }

  function toggleMic(lang = "ms-MY") {
    if (listening.value) {
      listening.value.stop();
      return;
    }
    error.value = "";
    const base = text.value ? `${text.value.trimEnd()} ` : "";
    let finals = "";
    listening.value = dictate(
      lang,
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

  function say(m: ChatMessage, lang = "ms-MY", isCoach = false) {
    const { reply } = live(m);
    if (speaking.value === m.job_id) {
      stopSpeaking();
      speaking.value = null;
      return;
    }
    speaking.value = m.job_id;
    speak(isCoach ? extractSpeakableText(reply) : reply, lang, () => (speaking.value = null));
  }

  // Reload threads when agent changes
  watch(
    agent,
    async (a, prev) => {
      if (!a || a.id === prev?.id) return;
      stopSpeaking();
      await loadThreads();
      const target =
        options.initialThreadId && threads.value.some((t) => t.thread_id === options.initialThreadId)
          ? options.initialThreadId
          : threads.value[0]?.thread_id ?? null;
      await openThread(target);
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    clearPhotos();
    listening.value?.stop();
    stopSpeaking();
  });

  return {
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
    loadingThreads,
    loadingMessages,
    loadThreads,
    openThread,
    addPhotos,
    removePhoto,
    clearPhotos,
    send,
    stopReply,
    live,
    toggleMic,
    say,
    stopSpeaking,
  };
}

