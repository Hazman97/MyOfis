/**
 * fetch on a fresh connection, with a timeout.
 *
 * Bun's HTTP client can reuse a pooled keep-alive socket that the server already
 * closed (e.g. Bun.serve's 10 s idle timeout) and then wait forever. Calls with long
 * gaps between them — runner -> hub uploads, replies to OpenCode after an owner
 * approval, LLM calls after a wait — must not reuse sockets. See LEARNINGS.md.
 */
export function freshFetch(input: string | URL | Request, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs, signal, ...rest } = init;
  const signals = [signal, timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined].filter((s): s is AbortSignal => !!s);
  return fetch(input, {
    ...rest,
    keepalive: false,
    ...(signals.length ? { signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals) } : {}),
  } as RequestInit);
}

/** Same, shaped like `fetch` for libraries that accept a custom fetch (AI SDK providers). */
export const freshFetchImpl = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
  freshFetch(input as string | URL | Request, init ?? {})) as typeof fetch;

/**
 * A JSON body some OpenAI-compatible gateways spoil with stream leftovers (9Router adds
 * "data: [DONE]" after a non-streaming answer): keep only the first JSON value.
 */
export function cleanJsonText(text: string): string {
  const t = text.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return t;
  try {
    JSON.parse(t);
    return t;
  } catch {
    // walk to the end of the first complete JSON value (strings and escapes respected)
    let depth = 0;
    let inStr = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (inStr) {
        if (c === "\\") i++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        depth--;
        if (depth === 0) return t.slice(0, i + 1);
      }
    }
    return t;
  }
}

/**
 * freshFetch for OpenAI-compatible providers: JSON answers are cleaned with cleanJsonText, so a
 * gateway's stray "data: [DONE]" does not break non-streaming calls. Streams pass through.
 */
export const tolerantFetchImpl = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const res = await freshFetch(input as string | URL | Request, init ?? {});
  // a streaming request gets the stream as is
  if (typeof init?.body === "string" && /"stream"\s*:\s*true/.test(init.body)) return res;
  // non-streaming: 9Router may answer with JSON + "data: [DONE]" and even a text/event-stream type
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("json") && !type.includes("event-stream")) return res;
  const text = await res.text();
  const clean = cleanJsonText(text);
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  if (clean.startsWith("{") || clean.startsWith("[")) headers.set("content-type", "application/json");
  return new Response(clean, { status: res.status, statusText: res.statusText, headers });
}) as typeof fetch;
