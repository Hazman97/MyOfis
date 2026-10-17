import type {
  Agent,
  AgentEvent,
  ContentDraft,
  DraftDecision,
  FeatureNote,
  FeatureNoteInput,
  Job,
  OfficeState,
  Project,
  ProjectBrief,
  ProjectBriefInput,
  ProviderPreset,
  ProviderPublic,
  Run,
  Runner,
  Schedule,
} from "@agent-office/shared";

export interface ToolInfo {
  name: string;
  description: string;
  category: string;
}

export interface Approval {
  id: string;
  run_id: string;
  agent_id: string;
  action: string;
  risk_level: "safe" | "review" | "dangerous";
  details: { tool?: string; args?: Record<string, unknown> } & Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "expired";
  decided_via: "web" | "telegram" | null;
  decided_at: string | null;
  created_at: string;
}

export interface GiteaSettings {
  url: string;
  has_token: boolean;
  token_hint: string | null;
}

export interface TelegramSettings {
  has_token: boolean;
  token_hint: string | null;
  chat_id: string;
  enabled: boolean;
}

export interface ChatThread {
  thread_id: string;
  title: string;
  first_at: string;
  last_at: string;
  messages: number;
}

export interface ChatMessage {
  job_id: string;
  agent_id: string;
  text: string;
  created_at: string;
  status: Job["status"];
  run_id: string | null;
  reply: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: { path: (string | number)[]; message: string }[],
  ) {
    super(message);
  }
}

/** Relative URLs only — works on localhost, behind Vite's proxy, and behind Cloudflare Tunnel. */
async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; issues?: ApiError["issues"] };
  if (res.status === 401 && path !== "/auth/login") onUnauthorized();
  if (!res.ok) {
    const detail = data.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ApiError(res.status, detail ? `${data.error}: ${detail}` : (data.error ?? res.statusText), data.issues);
  }
  return data;
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

export const api = {
  login: (token: string) => request<{ ok: true }>("/auth/login", { body: { token } }),
  logout: async () => {
    const r = await request<{ ok: true; logout_url?: string | null }>("/auth/logout", { method: "POST" });
    // Cloudflare Access keeps its own session: end it there too
    if (r.logout_url) window.location.assign(r.logout_url);
    return r;
  },
  authMode: () => request<{ mode: "local" | "cf-access" }>("/auth/mode"),
  me: () => request<{ ok: true; mode: string }>("/auth/me"),

  state: () => request<{ state: OfficeState }>("/state"),
  settings: () =>
    request<{ paused: boolean; auth_mode: string; timezone: string; public_base_url: string }>("/settings"),
  setPaused: (paused: boolean) => request<{ paused: boolean }>("/settings/pause", { body: { paused } }),

  agents: () => request<{ agents: Agent[] }>("/agents"),
  createAgent: (body: Partial<Agent>) => request<{ agent: Agent }>("/agents", { body }),
  agentMemory: (id: string) => request<{ memories: { id: string; content: string; created_at: string }[] }>(`/agents/${id}/memory`),
  forgetMemory: (id: string, memoryId: string) => request<{ ok: true }>(`/agents/${id}/memory/${memoryId}`, { method: "DELETE" }),
  updateAgent: (id: string, body: Partial<Agent>) => request<{ agent: Agent }>(`/agents/${id}`, { method: "PATCH", body }),

  jobs: () => request<{ jobs: Job[] }>("/jobs"),
  createJob: (body: { agent_id: string; project_id?: string | null; title: string; type?: string; input: Record<string, unknown> }) =>
    request<{ job: Job }>("/jobs", { body }),
  cancelJob: (id: string) => request<{ ok: true }>(`/jobs/${id}/cancel`, { method: "POST" }),

  events: (since: number, limit = 5000) => request<{ events: AgentEvent[] }>(`/events?since=${since}&limit=${limit}`),
  run: (id: string) => request<{ run: Run; events: AgentEvent[] }>(`/runs/${id}`),
  cancelRun: (id: string) => request<{ ok: true }>(`/runs/${id}/cancel`, { method: "POST" }),

  runners: () => request<{ runners: Runner[] }>("/runners"),
  pairingCode: () => request<{ code: string; expires_at: string }>("/runners/pairing-code", { method: "POST" }),
  revokeRunner: (id: string) => request<{ ok: true }>(`/runners/${id}/revoke`, { method: "POST" }),

  tools: () => request<{ tools: ToolInfo[] }>("/tools"),

  integrations: () => request<{ gitea: GiteaSettings; telegram: TelegramSettings }>("/settings/integrations"),
  saveTelegram: (body: { token?: string; chat_id?: string; enabled?: boolean }) =>
    request<{ telegram: TelegramSettings }>("/settings/integrations/telegram", { method: "PUT", body }),
  testTelegram: () => request<{ ok: boolean; error?: string }>("/settings/integrations/telegram/test", { method: "POST" }),
  saveGitea: (body: { url: string; token?: string }) =>
    request<{ gitea: GiteaSettings }>("/settings/integrations/gitea", { method: "PUT", body }),
  testGitea: () =>
    request<{ ok: boolean; login?: string | null; error?: string }>("/settings/integrations/gitea/test", { method: "POST" }),

  projects: () => request<{ projects: Project[] }>("/projects"),
  createProject: (body: Record<string, unknown>) => request<{ project: Project }>("/projects", { body }),
  updateProject: (id: string, body: Record<string, unknown>) =>
    request<{ project: Project }>(`/projects/${id}`, { method: "PATCH", body }),
  brief: (projectId: string) => request<{ brief: ProjectBrief | null; example: ProjectBriefInput; path: string }>(`/projects/${projectId}/brief`),
  saveBrief: (projectId: string, brief: ProjectBriefInput) =>
    request<{ brief: ProjectBrief }>(`/projects/${projectId}/brief`, { method: "PUT", body: brief }),
  features: (projectId: string) => request<{ features: FeatureNote[] }>(`/projects/${projectId}/features`),
  addFeature: (projectId: string, note: FeatureNoteInput) => request<{ feature: FeatureNote }>(`/projects/${projectId}/features`, { body: note }),

  drafts: (q: { status?: "pending" | "decided"; project_id?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    return request<{ drafts: ContentDraft[] }>(`/drafts${qs.size ? `?${qs}` : ""}`);
  },
  decideDraft: (id: string, decision: DraftDecision) => request<{ draft: ContentDraft }>(`/drafts/${id}/decide`, { body: decision }),

  chat: (body: { agent_id: string; text: string; thread_id?: string | null; project_id?: string | null }) =>
    request<{ job: Job; thread_id: string }>("/chat", { body }),
  chatThreads: (agentId: string) => request<{ threads: ChatThread[] }>(`/chat/threads?agent_id=${encodeURIComponent(agentId)}`),
  chatThread: (threadId: string) => request<{ messages: ChatMessage[] }>(`/chat/threads/${threadId}`),

  schedules: () => request<{ schedules: Schedule[] }>("/schedules"),
  createSchedule: (body: Record<string, unknown>) => request<{ schedule: Schedule }>("/schedules", { body }),
  updateSchedule: (id: string, body: Record<string, unknown>) =>
    request<{ schedule: Schedule }>(`/schedules/${id}`, { method: "PATCH", body }),
  deleteSchedule: (id: string) => request<{ ok: true }>(`/schedules/${id}`, { method: "DELETE" }),
  runScheduleNow: (id: string) => request<{ job_id: string }>(`/schedules/${id}/run-now`, { method: "POST" }),

  approvals: (status: "pending" | "all" = "pending") => request<{ approvals: Approval[] }>(`/approvals?status=${status}`),
  decideApproval: (id: string, decision: "approved" | "rejected") =>
    request<{ ok: true }>(`/approvals/${id}/decide`, { body: { decision } }),

  presets: () => request<{ presets: ProviderPreset[] }>("/providers/presets"),
  providers: () => request<{ providers: ProviderPublic[] }>("/providers"),
  createProvider: (body: Record<string, unknown>) => request<{ provider: ProviderPublic }>("/providers", { body }),
  updateProvider: (id: string, body: Record<string, unknown>) =>
    request<{ provider: ProviderPublic }>(`/providers/${id}`, { method: "PATCH", body }),
  deleteProvider: (id: string) => request<{ ok: true }>(`/providers/${id}`, { method: "DELETE" }),
};
