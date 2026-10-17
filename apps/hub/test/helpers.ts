import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HubToWeb, freshFetch, parseMessage, type AgentEvent, type OfficeState } from "@agent-office/shared";
import { RunnerClient } from "../../runner/src/client.ts";
import type { HubConfig } from "../src/env.ts";
import { startHub, type HubServer } from "../src/server.ts";

export const TOKEN = "test-owner-token-123456";

export function testConfig(dir: string): HubConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    publicBaseUrl: "http://127.0.0.1:8787",
    authMode: "local",
    localAuthToken: TOKEN,
    secretsKey: "test-secrets-key-0123456789abcdef0123456789",
    cfAccess: { teamDomain: "", aud: "", ownerEmail: "", certsUrl: "" },
    databasePath: join(dir, "hub.db"),
    filesDir: join(dir, "files"),
    webDistDir: join(dir, "no-web"),
    mapsDir: join(import.meta.dir, "../../../maps"),
    projectsDir: join(dir, "projects"),
    skillsDir: join(dir, "skills"),
    telegramApiBase: "http://127.0.0.1:9",
    seed: { anthropicApiKey: "", openaiApiKey: "", ollamaBaseUrl: "", giteaUrl: "", giteaToken: "", telegramToken: "", telegramChatId: "" },
  };
}

export async function waitFor<T>(fn: () => T | undefined | null | false, timeoutMs = 5000, label = "condition"): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(10);
  }
}

export interface TestEnv {
  dir: string;
  hub: HubServer;
  api: <T = any>(path: string, init?: { method?: string; body?: unknown; auth?: string | null }) => Promise<{ status: number; body: T }>;
  pairRunner(name?: string): Promise<RunnerClient>;
  web(since?: number): Promise<WebClient>;
  close(): Promise<void>;
}

export class WebClient {
  readonly messages: HubToWeb[] = [];
  readonly events: AgentEvent[] = [];
  snapshot: OfficeState | null = null;
  constructor(readonly ws: WebSocket) {
    ws.onmessage = (e) => {
      const m = parseMessage(HubToWeb, String(e.data));
      if (!m) throw new Error(`invalid message from hub: ${e.data}`);
      this.messages.push(m);
      if (m.type === "snapshot") this.snapshot = m.state;
      if (m.type === "events") this.events.push(...m.events);
      if (m.type === "event") this.events.push(m.event);
    };
  }
  close() {
    this.ws.close();
  }
}

export async function createTestEnv(timings: Parameters<typeof startHub>[1] = {}, config: Partial<HubConfig> = {}): Promise<TestEnv> {
  const dir = mkdtempSync(join(tmpdir(), "agent-office-"));
  const hub = startHub({ ...testConfig(dir), ...config }, { sweepMs: 50, ...timings });
  const runners: RunnerClient[] = [];
  const webs: WebClient[] = [];

  const api: TestEnv["api"] = async (path, init = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const auth = init.auth === undefined ? TOKEN : init.auth;
    if (auth) headers.authorization = `Bearer ${auth}`;
    const res = await freshFetch(`${hub.url}${path}`, {
      timeoutMs: 30_000,
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  return {
    dir,
    hub,
    api,
    async pairRunner(name = "test-runner") {
      const { body: code } = await api<{ code: string }>("/api/runners/pairing-code", { method: "POST" });
      const { body } = await api<{ token: string }>("/api/runners/pair", { body: { code: code.code, name }, auth: null });
      const client = new RunnerClient({
        hubUrl: hub.url,
        token: body.token,
        name,
        workspacesDir: join(dir, "workspaces"),
        log: () => {},
      });
      runners.push(client);
      await client.start();
      return client;
    },
    async web(since?: number) {
      const url = `${hub.url.replace("http", "ws")}/ws/web${since !== undefined ? `?since=${since}` : ""}`;
      const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${TOKEN}` } } as never);
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("web ws failed"));
      });
      const client = new WebClient(ws);
      webs.push(client);
      return client;
    },
    async close() {
      for (const w of webs) w.close();
      for (const r of runners) r.stop();
      await hub.stop();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* Windows may still hold the WAL file briefly */
      }
    },
  };
}
