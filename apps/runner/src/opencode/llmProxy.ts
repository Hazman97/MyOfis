import { freshFetch, type ProviderRuntimeConfig } from "@agent-office/shared";

/** Upstream OpenAI-compatible base URL for a provider, or null if OpenCode cannot use it through the proxy yet. */
export function upstreamBase(p: ProviderRuntimeConfig): string | null {
  if (p.kind === "openai_compatible" && p.base_url) return p.base_url.replace(/\/$/, "");
  if (p.kind === "openai") return (p.base_url ?? "https://api.openai.com/v1").replace(/\/$/, "");
  return null;
}

const ALLOWED = [
  { method: "POST", path: /^\/v1\/chat\/completions$/ },
  { method: "GET", path: /^\/v1\/models$/ },
];

export interface LlmProxy {
  baseUrl: string;
  token: string;
  requests: number;
  stop(): void;
}

/**
 * Per-run local proxy so the real provider API key never enters OpenCode's
 * process or its shell children. OpenCode gets a random token that only works
 * against this proxy, only on 127.0.0.1, and only while the run lasts.
 */
export function startLlmProxy(provider: ProviderRuntimeConfig): LlmProxy {
  const upstream = upstreamBase(provider);
  if (!upstream) {
    throw new Error(
      `The OpenCode runtime needs an OpenAI-compatible provider (OpenRouter, canopy-ai, Ollama, OpenAI…); "${provider.slug}" (${provider.kind}) is not supported yet.`,
    );
  }
  const token = `aorun-${crypto.randomUUID()}`;
  const state = { requests: 0 };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 255, // long streamed completions
    async fetch(req) {
      const url = new URL(req.url);
      if (req.headers.get("authorization") !== `Bearer ${token}`) return Response.json({ error: { message: "unauthorized" } }, { status: 401 });
      if (!ALLOWED.some((a) => a.method === req.method && a.path.test(url.pathname))) {
        return Response.json({ error: { message: `blocked by Agent Office: ${req.method} ${url.pathname}` } }, { status: 403 });
      }
      state.requests++;
      const headers = new Headers();
      for (const k of ["content-type", "accept"]) {
        const v = req.headers.get(k);
        if (v) headers.set(k, v);
      }
      if (provider.api_key) headers.set("authorization", `Bearer ${provider.api_key}`);
      // Buffer the (small, JSON) request body: forwarding `req.body` as a stream stalled Bun's HTTP client.
      const body = req.method === "GET" ? undefined : await req.arrayBuffer();
      const res = await freshFetch(`${upstream}${url.pathname.replace(/^\/v1/, "")}${url.search}`, {
        method: req.method,
        headers,
        body,
        signal: req.signal,
        timeoutMs: 15 * 60_000,
      });
      const out = new Headers();
      for (const k of ["content-type", "cache-control"]) {
        const v = res.headers.get(k);
        if (v) out.set(k, v);
      }
      return new Response(res.body, { status: res.status, headers: out });
    },
  });
  return {
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    token,
    get requests() {
      return state.requests;
    },
    stop: () => void server.stop(true),
  };
}
