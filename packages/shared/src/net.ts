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
