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
  WebPost,
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

export type WebSearchProvider = "duckduckgo" | "searxng" | "tavily" | "brave";
export interface WebSearchSettings {
  /** Tried first; the other providers that are set up are fallbacks (`order`). */
  provider: WebSearchProvider;
  searxng_url: string;
  key_provider: "tavily" | "brave" | null;
  has_key: boolean;
  key_hint: string | null;
  order: WebSearchProvider[];
}
export interface BackupInfo {
  date: string;
  size_bytes: number;
  created_at: string;
}
export interface TelegramSettings {
  has_token: boolean;
  token_hint: string | null;
  chat_id: string;
  enabled: boolean;
}

export type MemoryTarget = "memory" | "user";
export interface AgentMemory {
  memory: string[];
  user: string[];
  limits: Record<MemoryTarget, number>;
  write_approval: boolean;
}
/** Usage comes from GET /skills only (see apps/hub/src/learning.ts skillsWithUsage). */
export interface SkillUsage {
  runs: number;
  last_used_at: string | null;
  bad_runs: number;
  stale: string | null;
}
export interface Skill {
  name: string;
  description: string;
  content: string;
  usage?: SkillUsage;
}
/** A change an agent wants: a skill (create/patch/delete) or memory ops when write approval is on. */
export interface Proposal {
  id: string;
  kind: "skill" | "memory";
  agent_id: string;
  run_id: string | null;
  name: string;
  action: string;
  content: string;
  previous: string | null;
  reason: string;
  status: "pending" | "approved" | "rejected";
  error: string | null;
  warnings: string[];
  created_at: string;
  decided_at: string | null;
}

export interface ChatThread {
  thread_id: string;
  title: string;
  first_at: string;
  last_at: string;
  messages: number;
}

export interface CatalogSkill {
  source: "anthropic" | "hermes";
  path: string;
  name: string;
  description: string;
  category: string;
  license: string;
  open_license: boolean;
  has_extra_files: boolean;
  url: string;
}
export interface InstagramSettings {
  connected: boolean;
  enabled: boolean;
  ig_user_id: string | null;
  username: string | null;
}
export interface ThreadsSettings {
  has_token: boolean;
  token_hint: string | null;
  user_id: string | null;
  username: string | null;
}
export interface FacebookSettings {
  page_id: string;
  page_name: string | null;
  has_token: boolean;
  token_hint: string | null;
}
export interface PublishSettings {
  url: string;
  has_secret: boolean;
  secret_hint: string | null;
  info: { site_name: string; post_types: string[] } | null;
  checked_at: string | null;
}
export interface ChatAttachment {
  id: string;
  name: string;
  content_type: string;
}
export interface ChatMessage {
  job_id: string;
  agent_id: string;
  text: string;
  created_at: string;
  status: Job["status"];
  run_id: string | null;
  reply: string | null;
  /** Photos sent with the message (Publisher). */
  attachments?: ChatAttachment[];
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
  agentMemory: (id: string) => request<AgentMemory>(`/agents/${id}/memory`),
  setMemory: (id: string, target: MemoryTarget, entries: string[]) =>
    request<{ entries: string[] }>(`/agents/${id}/memory/${target}`, { method: "PUT", body: { entries } }),
  memorySettings: () => request<{ write_approval: boolean; limits: Record<MemoryTarget, number> }>("/memory/settings"),
  setMemoryApproval:(write_approval: boolean) => request<{ write_approval: boolean }>("/memory/settings", { method: "PUT", body: { write_approval } }),
  skills: () => request<{ skills: Skill[] }>("/skills"),
  importSkill: (content: string) => request<{ skill: Skill }>("/skills", { body: { content } }),
  deleteSkill: (name: string) => request<{ ok: true }>(`/skills/${encodeURIComponent(name)}`, { method: "DELETE" }),
  proposals: (pendingOnly = false) => request<{ proposals: Proposal[] }>(`/proposals${pendingOnly ? "?status=pending" : ""}`),
  decideProposal: (id: string, decision: "approve" | "reject") => request<{ proposal: Proposal }>(`/proposals/${id}/decide`, { body: { decision } }),
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

  integrations: () => request<{ gitea: GiteaSettings; telegram: TelegramSettings; web_search: WebSearchSettings }>("/settings/integrations"),
  saveWebSearch: (body: { provider: WebSearchProvider; searxng_url?: string; key_provider?: "tavily" | "brave"; api_key?: string }) =>
    request<{ web_search: WebSearchSettings }>("/settings/integrations/web-search", { method: "PUT", body }),
  testWebSearch: () =>
    request<{ ok: boolean; provider?: WebSearchProvider; results?: { title: string; url: string }[]; error?: string }>("/settings/integrations/web-search/test", { method: "POST" }),
  backups: () => request<{ backups: BackupInfo[]; dir: string }>("/backups"),
  backupNow: () => request<{ backup: BackupInfo }>("/backups", { method: "POST" }),
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
  skillCatalog: (refresh = false) => request<{ skills: CatalogSkill[]; updated_at: string | null }>(`/skills/catalog${refresh ? "?refresh=1" : ""}`),
  installCatalogSkill: (source: string, path: string) => request<{ skill: Skill; warnings: string[] }>("/skills/catalog/install", { body: { source, path } }),
  instagramSettings: (projectId: string) => request<{ instagram: InstagramSettings }>(`/projects/${projectId}/instagram`),
  connectInstagram: (projectId: string) => request<{ instagram: InstagramSettings }>(`/projects/${projectId}/instagram/connect`, { method: "POST" }),
  setInstagramEnabled: (projectId: string, enabled: boolean) => request<{ instagram: InstagramSettings }>(`/projects/${projectId}/instagram`, { method: "PUT", body: { enabled } }),
  threadsSettings: (projectId: string) => request<{ threads: ThreadsSettings }>(`/projects/${projectId}/threads`),
  saveThreads: (projectId: string, token: string) => request<{ threads: ThreadsSettings }>(`/projects/${projectId}/threads`, { method: "PUT", body: { token } }),
  facebookSettings: (projectId: string) => request<{ facebook: FacebookSettings }>(`/projects/${projectId}/facebook`),
  saveFacebookSettings: (projectId: string, body: { page_id: string; token?: string }) =>
    request<{ facebook: FacebookSettings }>(`/projects/${projectId}/facebook`, { method: "PUT", body }),
  testFacebookSettings: (projectId: string) => request<{ facebook: FacebookSettings }>(`/projects/${projectId}/facebook/test`, { method: "POST" }),
  publishSettings: (projectId: string) => request<{ publish: PublishSettings }>(`/projects/${projectId}/publish`),
  savePublishSettings: (projectId: string, body: { url: string; secret?: string }) =>
    request<{ publish: PublishSettings }>(`/projects/${projectId}/publish`, { method: "PUT", body }),
  testPublishSettings: (projectId: string) => request<{ publish: PublishSettings }>(`/projects/${projectId}/publish/test`, { method: "POST" }),
  publishDraft: (id: string) => request<{ draft: ContentDraft }>(`/drafts/${id}/publish`, { method: "POST" }),
  updatePublished: (id: string, body: { title?: string; body?: string; meta?: Partial<WebPost> }) => request<{ draft: ContentDraft }>(`/drafts/${id}/update-published`, { body }),
  takeDownPost: (id: string) => request<{ draft: ContentDraft }>(`/drafts/${id}/take-down`, { method: "POST" }),
  decideDraft: (id: string, decision: DraftDecision) => request<{ draft: ContentDraft }>(`/drafts/${id}/decide`, { body: decision }),

  chat: (body: { agent_id: string; text: string; thread_id?: string | null; project_id?: string | null; attachments?: string[] }) =>
    request<{ job: Job; thread_id: string }>("/chat", { body }),
  /** Upload a photo to send in chat (raw body, not JSON). */
  uploadImage: async (file: File): Promise<ChatAttachment> => {
    const res = await fetch(`/api/uploads?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file, headers: { "content-type": file.type }, credentials: "same-origin" });
    const data = (await res.json().catch(() => ({}))) as { upload?: ChatAttachment; error?: string };
    if (res.status === 401) onUnauthorized();
    if (!res.ok || !data.upload) throw new ApiError(res.status, data.error ?? res.statusText);
    return data.upload;
  },
  uploadUrl: (id: string) => `/api/uploads/${encodeURIComponent(id)}`,
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
