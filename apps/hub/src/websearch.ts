import { freshFetch } from "@agent-office/shared";

/**
 * Web search for the web_search tool. The API key stays in the hub (encrypted in
 * `settings`); runners ask through /api/runner/web-search. Two providers:
 * - brave:  https://api.search.brave.com (header X-Subscription-Token)
 * - tavily: https://api.tavily.com (Bearer key)
 * `apiBase` replaces the provider's host in tests.
 */
export type WebSearchProvider = "brave" | "tavily";
export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

const clean = (s: unknown) =>
  String(s ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);

export async function searchWeb(
  cfg: { provider: WebSearchProvider; apiKey: string },
  query: string,
  count: number,
  apiBase = "",
): Promise<WebResult[]> {
  const timeoutMs = 20_000;
  if (cfg.provider === "brave") {
    const url = new URL(`${apiBase || "https://api.search.brave.com"}/res/v1/web/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(count));
    const res = await freshFetch(url, { timeoutMs, headers: { accept: "application/json", "x-subscription-token": cfg.apiKey } });
    if (!res.ok) throw new Error(`Brave search failed (${res.status})`);
    const json = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
    return (json.web?.results ?? []).slice(0, count).map((r) => ({ title: clean(r.title), url: String(r.url ?? ""), snippet: clean(r.description) }));
  }
  const res = await freshFetch(`${apiBase || "https://api.tavily.com"}/search`, {
    timeoutMs,
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ query, max_results: count }),
  });
  if (!res.ok) throw new Error(`Tavily search failed (${res.status})`);
  const json = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
  return (json.results ?? []).slice(0, count).map((r) => ({ title: clean(r.title), url: String(r.url ?? ""), snippet: clean(r.content) }));
}
