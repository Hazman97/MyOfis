<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { api, type VideoListItem } from "../api/http.ts";
import { fmtDateTime } from "../format.ts";

/**
 * Video Studio home (owner request: "two ways in"): send a video here and open it in the studio,
 * or pick one you sent before / Editor made. The other way in is chatting with Editor.
 */
const router = useRouter();
const videos = ref<VideoListItem[]>([]);
const error = ref("");
const progress = ref<number | null>(null);

async function load() {
  videos.value = (await api.videos()).videos;
}
onMounted(() => load().catch((e) => (error.value = (e as Error).message)));

async function add(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  error.value = "";
  progress.value = 0;
  try {
    const up = await api.uploadVideo(file, (p) => (progress.value = p));
    await router.push({ name: "studio", params: { id: up.id } });
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    progress.value = null;
  }
}
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-4 p-4">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-lg font-semibold">Video Studio</h1>
      <div class="flex flex-wrap gap-2">
        <RouterLink to="/chat?agent=editor" class="btn btn-sm">Chat with Editor</RouterLink>
        <label class="btn btn-sm btn-primary cursor-pointer">
          {{ progress === null ? "Add video" : `Uploading ${Math.round(progress * 100)}%` }}
          <input type="file" accept="video/*" class="sr-only" :disabled="progress !== null" @change="add" />
        </label>
      </div>
    </header>
    <p v-if="error" class="text-sm text-danger">{{ error }}</p>
    <p v-if="!videos.length" class="text-sm text-muted">No videos yet. Add one here, or send one to Editor in Chat.</p>
    <ul class="grid gap-2 sm:grid-cols-2">
      <li v-for="v in videos" :key="v.id">
        <RouterLink :to="{ name: 'studio', params: { id: v.id } }" class="card block p-3 hover:border-accent">
          <div class="truncate font-medium">{{ v.name }}</div>
          <div class="text-xs text-muted">
            {{ fmtDateTime(v.created_at) }} · {{ Math.round(v.size / 1024 ** 2) }} MB · {{ v.run_id ? "made by Editor" : "your video" }}{{ v.has_transcript ? " · transcript" : "" }}
          </div>
        </RouterLink>
      </li>
    </ul>
  </div>
</template>
