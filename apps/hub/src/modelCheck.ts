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
    const res = await freshFetch(`${base}/chat/completions`, {
      method: "POST",
      timeoutMs: TIMEOUT,
      headers: { "content-type": "application/json", ...(p.api_key ? { authorization: `Bearer ${p.api_key}` } : {}) },
      body: JSON.stringify({ model, max_tokens: 300, messages: [{ role: "user", content: TEST_PROMPT }], tools: [{ type: "function", function: TEST_TOOL }] }),
    });
    if (!res.ok) return done({ ok: false, tool_calls: false, reply: "", error: await errText(res) });
    const j = await jsonOf<{ error?: { message?: string }; choices?: { message?: { content?: string | null; tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[] }>(res);
    if (j.error) return done({ ok: false, tool_calls: false, reply: "", error: j.error.message ?? "error" });
    const msg = j.choices?.[0]?.message;
    const call = msg?.tool_calls?.find((c) => c.function?.name === "get_time");
    let args: { city?: string } = {};
    try {
      args = JSON.parse(call?.function?.arguments ?? "{}");
    } catch {
      /* arguments that are not JSON: the tool call is broken */
    }
    return done({
      ok: true,
      tool_calls: !!call && /kuala lumpur/i.test(args.city ?? ""),
      reply: call ? `get_time(${call.function?.arguments ?? ""})` : (msg?.content ?? "").slice(0, 200),
      error: null,
    });
  } catch (err) {
    return done({ ok: false, tool_calls: false, reply: "", error: `could not reach the provider: ${(err as Error).message}` });
  }
}
