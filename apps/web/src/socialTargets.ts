import { ref } from "vue";
import { api, type SocialTarget } from "./api/http.ts";

/**
 * The room's TikTok accounts (Settings → Social accounts), loaded once and shared by every draft
 * card and form that offers a picker. `reload()` after changing accounts.
 */
const targets = ref<SocialTarget[]>([]);
let loading: Promise<void> | null = null;

export function useTiktokTargets() {
  loading ??= api
    .socialAccounts()
    .then((r) => void (targets.value = r.tiktok))
    .catch(() => void (loading = null));
  return {
    targets,
    reload: () => {
      loading = null;
      return useTiktokTargets();
    },
  };
}
