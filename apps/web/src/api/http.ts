import type {
  Agent,
  AgentEvent,
  Job,
  OfficeState,
  Project,
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
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  me: () => request<{ ok: true; mode: string }>("/auth/me"),

  state: () => request<{ state: OfficeState }>("/state"),
  settings: () =>
    request<{ paused: boolean; auth_mode: string; timezone: string; public_base_url: string }>("/settings"),
  setPaused: (paused: boolean) => request<{ paused: boolean }>("/settings/pause", { body: { paused } }),

  agents: () => request<{ agents: Agent[] }>("/agents"),
  createAgent: (body: Partial<Agent>) => request<{ agent: Agent }>("/agents", { body }),
  updateAgent: (id: string, body: Partial<Agent>) => request<{ agent: Agent }>(`/agents/${id}`, { method: "PATCH", body }),

  jobs: () => request<{ jobs: Job[] }>("/jobs"),
  createJob: (body: { agent_id: string; project_id?: string | null; title: string; input: Record<string, unknown> }) =>
    request<{ job: Job }>("/jobs", { body }),
  cancelJob: (id: string) => request<{ ok: true }>(`/jobs/${id}/cancel`, { method: "POST" }),

  run: (id: string) => request<{ run: Run; events: AgentEvent[] }>(`/runs/${id}`),
  cancelRun: (id: string) => request<{ ok: true }>(`/runs/${id}/cancel`, { method: "POST" }),

  runners: () => request<{ runners: Runner[] }>("/runners"),
  pairingCode: () => request<{ code: string; expires_at: string }>("/runners/pairing-code", { method: "POST" }),
  revokeRunner: (id: string) => request<{ ok: true }>(`/runners/${id}/revoke`, { method: "POST" }),

  tools: () => request<{ tools: ToolInfo[] }>("/tools"),

  integrations: () => request<{ gitea: GiteaSettings }>("/settings/integrations"),
  saveGitea: (body: { url: string; token?: string }) =>
    request<{ gitea: GiteaSettings }>("/settings/integrations/gitea", { method: "PUT", body }),
  testGitea: () =>
    request<{ ok: boolean; login?: string | null; error?: string }>("/settings/integrations/gitea/test", { method: "POST" }),

  projects: () => request<{ projects: Project[] }>("/projects"),
  createProject: (body: Record<string, unknown>) => request<{ project: Project }>("/projects", { body }),
  updateProject: (id: string, body: Record<string, unknown>) =>
    request<{ project: Project }>(`/projects/${id}`, { method: "PATCH", body }),

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
