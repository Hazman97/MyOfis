import { computed, ref } from "vue";

/** Who is signed in (members, 2026-10-19): set by the router's auth check from GET /api/auth/me. */
export interface Me {
  email: string;
  name: string;
  role: "owner" | "member";
  workspace_id: string;
}

export const me = ref<Me | null>(null);
/** Owner-only pages (Runners, Integrations, System, Members…) are hidden for members. */
export const isOwner = computed(() => me.value?.role !== "member");
