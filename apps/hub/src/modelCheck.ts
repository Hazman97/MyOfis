import { cleanJsonText, freshFetch } from "@agent-office/shared";

/** The JSON of an answer, tolerating a gateway's trailing "data: [DONE]". */
const jsonOf = async <T>(res: Response): Promise<T> => JSON.parse(cleanJsonText(await res.text())) as T;
import { HttpError } from "./repo.ts";

/**
 * Model tools for the owner (2026-10-20: "switch an agent's model easily, and know if a model can
 * do the job"). The hub lists a provider's models and tests one model with a tiny tool call: an
 * agent is only useful if its model actually calls tools (canopy-ai could not drive OpenChatCut).
 * Keys stay on the hub; local base URLs (Ollama, 9Router) are reached from this PC.
 */
export interface ProviderForCheck {
  kind: string;
  base_url: string | null;
  api_key: string | null;
}

export interface ModelTest {
  ok: boolean;
  /** The model called the test tool with the right argument. */
  tool_calls: boolean;
  ms: number;
  /** What the model said or called (short). */
  reply: string;
  error: string | null;
}

const TIMEOUT = 90_000;
const OPENAI = "https://api.openai.com/v1";
const ANTHROPIC = "https://api.anthropic.com/v1";
const GOOGLE_OPENAI = "https://generativelanguage.googleapis.com/v1beta/openai";

/** Where a provider speaks the OpenAI API (Google has an OpenAI-compatible endpoint too). */
function openaiBase(p: ProviderForCheck): string | null {
  if (p.kind === "openai") return (p.base_url ?? OPENAI).replace(/\/$/, "");
  if (p.kind === "openai_compatible") return p.base_url?.replace(/\/$/, "") ?? null;
  if (p.kind === "google") return GOOGLE_OPENAI;
  return null;
}

const errText = async (res: Response) => {
  const t = await res.text().catch(() => "");
  try {
    const j = JSON.parse(t) as { error?: { message?: string } | string; message?: string };
    const e = typeof j.error === "string" ? j.error : j.error?.message;
    return (e ?? j.message ?? t).slice(0, 300);
  } catch {
    return t.slice(0, 300) || `HTTP ${res.status}`;
  }
};

/** Model ids the provider offers (its /models list), sorted. */
export async function listModels(p: ProviderForCheck): Promise<string[]> {
  if (p.kind === "mock") return [];
  try {
    let res: Response;
    if (p.kind === "anthropic") {
      res = await freshFetch(`${(p.base_url ?? ANTHROPIC).replace(/\/$/, "")}/models?limit=100`, {
        timeoutMs: 30_000,
        headers: { "x-api-key": p.api_key ?? "", "anthropic-version": "2023-06-01" },
      });
    } else {
      const base = openaiBase(p);
      if (!base) throw new HttpError(400, "this provider has no base URL");
      res = await freshFetch(`${base}/models`, { timeoutMs: 30_000, headers: p.api_key ? { authorization: `Bearer ${p.api_key}` } : {} });
    }
    if (!res.ok) throw new HttpError(400, `the provider answered ${res.status}: ${await errText(res)}`);
    const j = await jsonOf<{ data?: { id?: string }[]; models?: { id?: string; name?: string }[] }>(res);
    const ids = [...(j.data ?? []), ...(j.models ?? [])].map((m) => (m.id ?? (m as { name?: string }).name ?? "").replace(/^models\//, "")).filter(Boolean);
    return [...new Set(ids)].sort();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, `could not reach the provider: ${(err as Error).message}`);
  }
}

const TEST_PROMPT = "What time is it in Kuala Lumpur? Use the get_time tool.";
const TEST_TOOL = { name: "get_time", description: "The current time in a city", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } };

/** One small request with one tool: does the model answer, and does it call the tool properly? */
export async function testModel(p: ProviderForCheck, model: string): Promise<ModelTest> {
  const t0 = Date.now();
  const done = (r: Omit<ModelTest, "ms">): ModelTest => ({ ...r, ms: Date.now() - t0 });
  try {
    if (p.kind === "anthropic") {
      const res = await freshFetch(`${(p.base_url ?? ANTHROPIC).replace(/\/$/, "")}/messages`, {
        method: "POST",
        timeoutMs: TIMEOUT,
        headers: { "x-api-key": p.api_key ?? "", "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 300, messages: [{ role: "user", content: TEST_PROMPT }], tools: [{ name: TEST_TOOL.name, description: TEST_TOOL.description, input_schema: TEST_TOOL.parameters }] }),
      });
      if (!res.ok) return done({ ok: false, tool_calls: false, reply: "", error: await errText(res) });
      const j = await jsonOf<{ content?: { type: string; text?: string; name?: string; input?: { city?: string } }[] }>(res);
      const call = j.content?.find((c) => c.type === "tool_use" && c.name === "get_time");
      const text = j.content?.filter((c) => c.type === "text").map((c) => c.text).join(" ") ?? "";
      return done({ ok: true, tool_calls: !!call && /kuala lumpur/i.test(call.input?.city ?? ""), reply: call ? `get_time(${JSON.stringify(call.input)})` : text.slice(0, 200), error: null });
    }
    const base = openaiBase(p);
    if (!base) return done({ ok: false, tool_calls: false, reply: "", error: p.kind === "mock" ? "the mock provider is for tests" : "this provider has no base URL" });
    // streaming, like the agents run: some gateways (9Router → Cline) answer nothing without it
    const res = await freshFetch(`${base}/chat/completions`, {
      method: "POST",
      timeoutMs: TIMEOUT,
      headers: { "content-type": "application/json", ...(p.api_key ? { authorization: `Bearer ${p.api_key}` } : {}) },
      body: JSON.stringify({ model, max_tokens: 300, stream: true, messages: [{ role: "user", content: TEST_PROMPT }], tools: [{ type: "function", function: TEST_TOOL }] }),
    });
    if (!res.ok) return done({ ok: false, tool_calls: false, reply: "", error: await errText(res) });
    const r = readChat(await res.text());
    if (r.error) return done({ ok: false, tool_calls: false, reply: "", error: r.error });
    if (!r.name && !r.text) return done({ ok: false, tool_calls: false, reply: "", error: "the model answered nothing" });
    let args: { city?: string } = {};
    try {
      args = JSON.parse(r.args || "{}");
    } catch {
      /* arguments that are not JSON: the tool call is broken */
    }
    return done({
      ok: true,
      tool_calls: r.name === "get_time" && /kuala lumpur/i.test(args.city ?? ""),
      reply: r.name ? `${r.name}(${r.args})` : r.text.slice(0, 200),
      error: null,
    });
  } catch (err) {
    return done({ ok: false, tool_calls: false, reply: "", error: `could not reach the provider: ${(err as Error).message}` });
  }
}

/**
 * An OpenAI chat answer, streamed (SSE `data:` chunks with deltas) or plain JSON: the first tool
 * call's name + arguments, the text, or the error.
 */
export function readChat(body: string): { name: string; args: string; text: string; error: string | null } {
  const out = { name: "", args: "", text: "", error: null as string | null };
  type Choice = { delta?: Msg; message?: Msg };
  type Msg = { content?: string | null; tool_calls?: { index?: number; function?: { name?: string; arguments?: string } }[] };
  const take = (j: { error?: { message?: string } | string; choices?: Choice[] }) => {
    if (j.error) out.error = typeof j.error === "string" ? j.error : (j.error.message ?? "error");
    const m = j.choices?.[0]?.delta ?? j.choices?.[0]?.message;
    if (m?.content) out.text += m.content;
    for (const c of m?.tool_calls ?? []) {
      if ((c.index ?? 0) !== 0) continue;
      if (c.function?.name) out.name = c.function.name;
      if (c.function?.arguments) out.args += c.function.arguments;
    }
  };
  const lines = body.split(/\r?\n/).filter((l) => l.startsWith("data:"));
  // a whole JSON answer (some gateways send one even for a stream request, then "data: [DONE]")
  if (!lines.length || body.trimStart().startsWith("{")) {
    try {
      take(JSON.parse(cleanJsonText(body)));
    } catch {
      out.error = body.trim().slice(0, 200) || "empty answer";
    }
    return out;
  }
  for (const l of lines) {
    const data = l.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      take(JSON.parse(data));
    } catch {
      /* a partial line */
    }
  }
  return out;
}

export interface ScanResult {
  model: string;
  ok: boolean;
  tool_calls: boolean;
  ms: number;
  error: string | null;
}

/** Is the endpoint there, and how many models does it list? (before saving a provider) */
export async function checkConnection(p: ProviderForCheck): Promise<{ ok: boolean; models: number; error: string | null }> {
  try {
    return { ok: true, models: (await listModels(p)).length, error: null };
  } catch (err) {
    return { ok: false, models: 0, error: (err as Error).message };
  }
}

/** Models with their group (`owned_by`; 9Router uses it for the upstream provider). */
async function modelGroups(p: ProviderForCheck): Promise<{ id: string; group: string }[]> {
  const base = openaiBase(p);
  if (!base) return (await listModels(p)).map((id) => ({ id, group: "" }));
  const res = await freshFetch(`${base}/models`, { timeoutMs: 30_000, headers: p.api_key ? { authorization: `Bearer ${p.api_key}` } : {} });
  if (!res.ok) throw new HttpError(400, `the provider answered ${res.status}: ${await errText(res)}`);
  const j = await jsonOf<{ data?: { id?: string; owned_by?: string }[] }>(res);
  const seen = new Set<string>();
  return (j.data ?? []).filter((m) => m.id && !seen.has(m.id) && seen.add(m.id)).map((m) => ({ id: m.id!, group: m.owned_by ?? "" }));
}

/** 9Router: one cheap call per upstream tells whether you have connected it. */
async function connectedGroup(p: ProviderForCheck, model: string): Promise<boolean> {
  const base = openaiBase(p)!;
  try {
    const res = await freshFetch(`${base}/chat/completions`, {
      method: "POST",
      timeoutMs: 30_000,
      headers: { "content-type": "application/json", ...(p.api_key ? { authorization: `Bearer ${p.api_key}` } : {}) },
      body: JSON.stringify({ model, max_tokens: 5, messages: [{ role: "user", content: "hi" }] }),
    });
    const t = await res.text();
    return !/no active credentials|not connected|no credentials/i.test(t);
  } catch {
    return false;
  }
}

/** Kilo Code's free models (public list), as 9Router ids. */
async function kiloFree(): Promise<string[]> {
  try {
    const res = await freshFetch("https://api.kilo.ai/api/gateway/models", { timeoutMs: 20_000 });
    const j = (await res.json()) as { data?: { id: string; pricing?: Record<string, string>; supported_parameters?: string[] }[] };
    return (j.data ?? []).filter((m) => Number(m.pricing?.prompt ?? 1) + Number(m.pricing?.completion ?? 1) === 0 && m.supported_parameters?.includes("tools")).map((m) => `kc/${m.id}`);
  } catch {
    return [];
  }
}

const SCAN_MAX = 120;

/**
 * Test the models a provider offers and say which really work with tools. For a gateway with many
 * upstreams (9Router), only the upstreams you connected are tested (plus Kilo Code's free models
 * when Kilo is connected). Runs 8 at a time (a scan must finish well under Cloudflare's 100 s).
 */
export async function scanModels(p: ProviderForCheck, concurrency = 8): Promise<ScanResult[]> {
  const all = await modelGroups(p);
  let ids: string[];
  const groups = [...new Set(all.map((m) => m.group).filter(Boolean))];
  if (groups.length > 3) {
    const probes = await Promise.all(groups.map(async (g) => ({ g, ok: await connectedGroup(p, all.find((m) => m.group === g)!.id) })));
    const live = new Set(probes.filter((x) => x.ok).map((x) => x.g));
    ids = all.filter((m) => live.has(m.group)).map((m) => m.id);
    if (live.has("kc")) ids = [...new Set([...ids, ...(await kiloFree())])];
  } else ids = all.map((m) => m.id);
  ids = ids.slice(0, SCAN_MAX);
  const out: ScanResult[] = [];
  for (let i = 0; i < ids.length; i += concurrency) {
    const batch = await Promise.all(
      ids.slice(i, i + concurrency).map(async (model) => {
        const t = await testModel(p, model);
        return { model, ok: t.ok, tool_calls: t.tool_calls, ms: t.ms, error: t.error };
      }),
    );
    out.push(...batch);
  }
  return out.sort((a, b) => Number(b.tool_calls) - Number(a.tool_calls) || Number(b.ok) - Number(a.ok) || a.ms - b.ms);
}
