/**
 * Turn an LLM/provider error into one readable line for the run log.
 * AI SDK wraps retried failures in RetryError ("Failed after 3 attempts…") whose
 * `lastError` is an APICallError carrying the HTTP status and the provider's
 * response body; the useful reason (e.g. "rate-limited upstream") lives there.
 */
export function describeError(err: unknown): string {
  const retried = (err as { lastError?: unknown } | null)?.lastError;
  const e = retried ?? err;
  const message = e instanceof Error ? e.message : String(e);
  const status = (e as { statusCode?: number } | null)?.statusCode;
  const body = (e as { responseBody?: string } | null)?.responseBody;
  let detail = "";
  if (body) {
    try {
      const j = JSON.parse(body) as { error?: { message?: string; metadata?: { raw?: unknown } } | string; message?: string };
      const errObj = typeof j.error === "object" ? j.error : undefined;
      const raw = errObj?.metadata?.raw;
      detail = (typeof raw === "string" ? raw : "") || errObj?.message || (typeof j.error === "string" ? j.error : "") || j.message || "";
    } catch {
      detail = body.slice(0, 300);
    }
  }
  const parts = [status ? `HTTP ${status}` : null, detail && detail !== message ? detail : null, message].filter(Boolean);
  return `${parts.join(": ")}${retried ? " (after retries)" : ""}`.slice(0, 1000);
}
