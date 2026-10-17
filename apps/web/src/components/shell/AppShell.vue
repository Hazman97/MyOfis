<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import {
  Bot,
  Building2,
  CalendarClock,
  Ellipsis,
  FilePenLine,
  FolderGit2,
  Inbox,
  LogOut,
  MessagesSquare,
  Pause,
  Play,
  Plus,
  Server,
  Settings2,
  X,
} from "lucide-vue-next";
import BrandMark from "./BrandMark.vue";
import { api } from "../../api/http.ts";
import { resetAuthCheck } from "../../router.ts";
import { useOffice } from "../../stores/office.ts";
import { fmtUsd } from "../../format.ts";

const office = useOffice();
const route = useRoute();
const router = useRouter();

const pending = computed(() => Object.keys(office.state.pending_approvals).length);
const drafts = computed(() => Object.keys(office.state.pending_drafts ?? {}).length);
const badgeOf = (item: { badge?: "approvals" | "drafts" }) => (item.badge === "approvals" ? pending.value : item.badge === "drafts" ? drafts.value : 0);
const runners = computed(() => Object.values(office.state.runners));
const runnersOnline = computed(() => runners.value.filter((r) => r.online).length);
const confirmPause = ref(false);
const moreOpen = ref(false);
watch(() => route.fullPath, () => (moreOpen.value = false));

interface NavItem {
  to: string;
  label: string;
  icon: typeof Bot;
  exact?: boolean;
  badge?: "approvals" | "drafts";
}
const groups: { sign: string; items: NavItem[] }[] = [
  {
    sign: "Office",
    items: [
      { to: "/", label: "Office", icon: Building2, exact: true },
      { to: "/chat", label: "Chat", icon: MessagesSquare },
      { to: "/approvals", label: "Approvals", icon: Inbox, badge: "approvals" },
    ],
  },
  { sign: "Team", items: [{ to: "/agents", label: "Agents", icon: Bot }, { to: "/schedules", label: "Schedules", icon: CalendarClock }] },
  { sign: "Work", items: [{ to: "/drafts", label: "Drafts", icon: FilePenLine, badge: "drafts" }, { to: "/projects", label: "Projects", icon: FolderGit2 }] },
  { sign: "System", items: [{ to: "/runners", label: "Runners", icon: Server }, { to: "/settings", label: "Settings", icon: Settings2 }] },
];
const moreItems: NavItem[] = [
  { to: "/chat", label: "Chat", icon: MessagesSquare },
  { to: "/drafts", label: "Drafts", icon: FilePenLine, badge: "drafts" },
  { to: "/schedules", label: "Schedules", icon: CalendarClock },
  { to: "/projects", label: "Projects", icon: FolderGit2 },
  { to: "/runners", label: "Runners", icon: Server },
  { to: "/settings", label: "Settings", icon: Settings2 },
];

const isActive = (to: string, exact = false) =>
  exact ? route.path === to || route.path.startsWith("/runs") || route.path.startsWith("/jobs/") && route.path !== "/jobs/new" : route.path.startsWith(to);

async function togglePause() {
  if (!office.state.paused && !confirmPause.value) {
    confirmPause.value = true; // second click confirms (no browser dialogs)
    setTimeout(() => (confirmPause.value = false), 4000);
    return;
  }
  confirmPause.value = false;
  await api.setPaused(!office.state.paused);
}

async function logout() {
  await api.logout();
  resetAuthCheck();
  await router.push({ name: "login" });
}
</script>

<template>
  <div class="min-h-dvh lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
    <!-- Desktop sidebar -->
    <aside class="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface lg:flex">
      <RouterLink to="/" class="flex items-center gap-2.5 px-5 pt-5 pb-4">
        <BrandMark />
        <div class="leading-tight">
          <div class="text-[15px] font-semibold tracking-tight">Agent Office</div>
          <div class="sign">MyOfis</div>
        </div>
      </RouterLink>

      <nav class="flex-1 space-y-5 overflow-y-auto px-3 py-2" aria-label="Main">
        <div v-for="g in groups" :key="g.sign">
          <div class="sign mb-1.5 px-2">{{ g.sign }}</div>
          <RouterLink
            v-for="item in g.items"
            :key="item.to"
            :to="item.to"
            class="group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
            :class="isActive(item.to, item.exact) && 'bg-accent-soft! text-fg!'"
          >
            <component :is="item.icon" :size="17" :stroke-width="1.8" :class="isActive(item.to, item.exact) ? 'text-accent' : 'text-faint group-hover:text-muted'" />
            <span class="flex-1">{{ item.label }}</span>
            <span v-if="badgeOf(item)" class="rounded-full bg-signal px-1.5 font-mono text-[11px] leading-4.5 font-medium text-white">{{ badgeOf(item) }}</span>
          </RouterLink>
        </div>
      </nav>

      <div class="space-y-3 border-t border-line p-4">
        <RouterLink to="/jobs/new" class="btn btn-primary w-full"><Plus :size="16" /> New job</RouterLink>
        <dl class="grid grid-cols-2 gap-2 text-xs">
          <div class="rounded-md bg-surface-2 px-2.5 py-2">
            <dt class="sign">Today</dt>
            <dd class="mt-0.5 font-mono text-sm font-medium tabular-nums">{{ fmtUsd(office.costToday) }}</dd>
          </div>
          <RouterLink to="/runners" class="rounded-md bg-surface-2 px-2.5 py-2 hover:bg-sunken">
            <dt class="sign">Runners</dt>
            <dd class="mt-0.5 flex items-center gap-1.5 font-mono text-sm font-medium tabular-nums">
              <span class="size-2 rounded-full" :class="runnersOnline ? 'bg-accent' : 'bg-danger'" />{{ runnersOnline }}/{{ runners.length }}
            </dd>
          </RouterLink>
        </dl>
        <button class="btn w-full" :class="office.state.paused ? 'btn-primary' : confirmPause ? 'btn-signal' : 'btn-danger'" @click="togglePause">
          <component :is="office.state.paused ? Play : Pause" :size="15" />
          {{ office.state.paused ? "Resume all agents" : confirmPause ? "Click again to pause" : "Pause all agents" }}
        </button>
        <div class="flex items-center justify-between text-xs">
          <span class="inline-flex items-center gap-1.5" :class="office.connected ? 'text-accent' : 'text-signal'">
            <span class="size-1.5 rounded-full" :class="office.connected ? 'bg-accent' : 'animate-pulse bg-signal'" />
            {{ office.connected ? "Live" : "Reconnecting…" }}
          </span>
          <button class="inline-flex items-center gap-1 text-faint hover:text-fg" @click="logout"><LogOut :size="13" /> Log out</button>
        </div>
      </div>
    </aside>

    <!-- Phone top bar -->
    <header
      class="sticky top-[env(safe-area-inset-top,0px)] z-20 flex items-center gap-2.5 border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur lg:hidden"
    >
      <RouterLink to="/" class="flex items-center gap-2"><BrandMark :size="24" /><span class="font-semibold tracking-tight">Agent Office</span></RouterLink>
      <span class="ml-auto inline-flex items-center gap-1.5 text-xs" :class="office.connected ? 'text-accent' : 'text-signal'">
        <span class="size-1.5 rounded-full" :class="office.connected ? 'bg-accent' : 'animate-pulse bg-signal'" />{{ office.connected ? "Live" : "…" }}
      </span>
      <span class="font-mono text-xs text-muted tabular-nums">{{ fmtUsd(office.costToday) }}</span>
      <button
        class="btn btn-sm"
        :class="office.state.paused ? 'btn-primary' : confirmPause ? 'btn-signal' : 'btn-danger'"
        :aria-label="office.state.paused ? 'Resume all agents' : 'Pause all agents'"
        @click="togglePause"
      >
        <component :is="office.state.paused ? Play : Pause" :size="14" />{{ confirmPause ? "Sure?" : "" }}
      </button>
    </header>

    <main class="min-w-0 pb-24 lg:pb-0">
      <div v-if="office.state.paused" class="border-b border-signal/30 bg-signal-soft px-4 py-2 text-center text-sm text-signal lg:px-8">
        All agents are paused. New jobs wait in the queue until you resume.
      </div>
      <div class="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <slot />
      </div>
    </main>

    <!-- Phone tab bar -->
    <nav
      class="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur lg:hidden"
      aria-label="Main"
    >
      <RouterLink to="/" class="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium" :class="isActive('/', true) ? 'text-accent' : 'text-muted'">
        <Building2 :size="20" :stroke-width="1.8" />Office
      </RouterLink>
      <RouterLink to="/approvals" class="relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium" :class="isActive('/approvals') ? 'text-accent' : 'text-muted'">
        <Inbox :size="20" :stroke-width="1.8" />Approvals
        <span v-if="pending" class="absolute top-1 left-1/2 ml-2 rounded-full bg-signal px-1.5 font-mono text-[10px] leading-4 text-white">{{ pending }}</span>
      </RouterLink>
      <RouterLink to="/jobs/new" class="flex flex-col items-center justify-center" aria-label="New job">
        <span class="flex size-10 items-center justify-center rounded-full bg-accent text-accent-ink shadow-card"><Plus :size="22" /></span>
      </RouterLink>
      <RouterLink to="/agents" class="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium" :class="isActive('/agents') ? 'text-accent' : 'text-muted'">
        <Bot :size="20" :stroke-width="1.8" />Agents
      </RouterLink>
      <button class="relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted" @click="moreOpen = true">
        <Ellipsis :size="20" :stroke-width="1.8" />More
        <span v-if="drafts" class="absolute top-1 left-1/2 ml-2 rounded-full bg-signal px-1.5 font-mono text-[10px] leading-4 text-white">{{ drafts }}</span>
      </button>
    </nav>

    <!-- Phone "More" sheet -->
    <div v-if="moreOpen" class="fixed inset-0 z-40 lg:hidden" @click.self="moreOpen = false">
      <div class="absolute inset-0 bg-black/30" @click="moreOpen = false" />
      <div class="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-line bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
        <div class="mb-3 flex items-center">
          <span class="sign">More</span>
          <button class="btn btn-ghost btn-sm ml-auto" aria-label="Close" @click="moreOpen = false"><X :size="16" /></button>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <RouterLink v-for="m in moreItems" :key="m.to" :to="m.to" class="flex items-center gap-2 rounded-lg border border-line px-3 py-3 text-sm font-medium">
            <component :is="m.icon" :size="18" class="text-accent" /><span class="flex-1">{{ m.label }}</span>
            <span v-if="badgeOf(m)" class="rounded-full bg-signal px-1.5 font-mono text-[11px] leading-4.5 text-white">{{ badgeOf(m) }}</span>
          </RouterLink>
        </div>
        <button class="btn btn-ghost mt-3 w-full text-muted" @click="logout"><LogOut :size="15" /> Log out</button>
      </div>
    </div>
  </div>
</template>
