import { computed, ref } from "vue";

/** Who is signed in (members, 2026-10-19): set by the router's auth check from GET /api/auth/me. */
export interface Me {
  email: string;
  name: string;
  role: "owner" | "member";
  /** The room you are in now. */
  workspace_id: string;
  home_workspace_id: string;
}

/** Enter another room: the choice lives in a cookie (so photos, videos and the live feed follow it), then reload. */
export function enterRoom(id: string): void {
  document.cookie = `ao_room=${encodeURIComponent(id)}; path=/; max-age=31536000; SameSite=Strict`;
  location.assign("/");
}

export const me = ref<Me | null>(null);
/** Owner-only pages (Runners, Integrations, System, Members…) are hidden for members. */
export const isOwner = computed(() => me.value?.role !== "member");
