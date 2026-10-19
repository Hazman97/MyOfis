import { createRouter, createWebHistory } from "vue-router";
import { api } from "./api/http.ts";
import { me } from "./me.ts";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: () => import("./views/LoginView.vue"), meta: { public: true } },
    { path: "/", name: "dashboard", component: () => import("./views/DashboardView.vue") },
    { path: "/jobs/new", name: "new-job", component: () => import("./views/NewJobView.vue") },
    { path: "/jobs/:id", name: "job", component: () => import("./views/JobView.vue"), props: true },
    { path: "/runs/:id", name: "run", component: () => import("./views/RunView.vue"), props: true },
    { path: "/approvals", name: "approvals", component: () => import("./views/ApprovalsView.vue") },
    { path: "/drafts", name: "drafts", component: () => import("./views/DraftsView.vue") },
    { path: "/chat", name: "chat", component: () => import("./views/ChatView.vue") },
    { path: "/replay", name: "replay", component: () => import("./views/ReplayView.vue") },
    { path: "/agents", name: "agents", component: () => import("./views/AgentsView.vue") },
    { path: "/schedules", name: "schedules", component: () => import("./views/SchedulesView.vue") },
    { path: "/skills", name: "skills", component: () => import("./views/SkillsView.vue") },
    { path: "/projects", name: "projects", component: () => import("./views/ProjectsView.vue") },
    { path: "/studio/:id", name: "studio", component: () => import("./views/VideoStudioView.vue"), props: true },
    { path: "/members", name: "members", component: () => import("./views/MembersView.vue") },
    { path: "/system", name: "system", component: () => import("./views/SystemView.vue") },
    { path: "/manual", name: "manual", component: () => import("./views/ManualView.vue") },
    { path: "/runners", name: "runners", component: () => import("./views/RunnersView.vue") },
    { path: "/settings/providers", name: "providers", component: () => import("./views/ProvidersView.vue") },
    { path: "/settings/integrations", name: "integrations", component: () => import("./views/IntegrationsView.vue") },
    { path: "/settings", redirect: "/settings/providers" },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

let authChecked = false;

router.beforeEach(async (to) => {
  if (to.meta.public || authChecked) return true;
  try {
    const m = await api.me();
    me.value = { email: m.email, name: m.name, role: m.role, workspace_id: m.workspace_id };
    authChecked = true;
    return true;
  } catch {
    return { name: "login", query: { next: to.fullPath } };
  }
});

export const resetAuthCheck = () => {
  authChecked = false;
};
