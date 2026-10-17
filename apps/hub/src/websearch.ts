import { freshFetch } from "@agent-office/shared";

/**
 * Web search for the web_search tool, always done by the hub (keys never leave it).
 * Providers, tried in order until one returns results (owner choice: no monthly limits first):
 * - duckduckgo: DuckDuckGo's lite HTML page. No key, no signup; unofficial, so it may ask for
 *   a CAPTCHA when used a lot. Rate-limited here.
 * - searxng:    the owner's own SearXNG (`/search?format=json`). No key, no limit.
 * - tavily / brave: paid APIs with a key, as the last resort.
 * `apiBase` replaces the public hosts (DuckDuckGo, Brave, Tavily) in tests.
 */
export type WebSearchProvider = "duckduckgo" | "searxng" | "tavily" | "brave";
export const WEB_SEARCH_PROVIDERS: WebSearchProvider[] = ["duckduckgo", "searxng", "tavily", "brave"];

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchPlan {
  /** Providers to try, first one first. */
  order: WebSearchProvider[];
  searxngUrl: string;
  keys: Partial<Record<"tavily" | "brave", string>>;
}

const TIMEOUT_MS = 20_000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#x27": "'", nbsp: " " };
const clean = (s: unknown) =>
  String(s ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x27|#39|amp|lt|gt|quot|nbsp);/g, (_, e: string) => ENT[e] ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);

/** Results from DuckDuckGo's lite page (ads and "more info" links dropped). Exported for tests. */
export function parseDuckDuckGoLite(html: string, count: number): WebResult[] {
  if (/anomaly|captcha/i.test(html) && !/result-link/.test(html)) throw new Error("DuckDuckGo asked for a CAPTCHA (too many searches); try again later");
  const out: WebResult[] = [];
  const link = /<a\b([^>]*class=['"]result-link['"][^>]*)>([\s\S]*?)<\/a>/g;
  const matches = [...html.matchAll(link)];
  matches.forEach((m, i) => {
    const href = m[1]!.match(/href=["']([^"']+)["']/)?.[1]?.replace(/&amp;/g, "&") ?? "";
    const title = clean(m[2]);
    // ads always go through duckduckgo.com/y.js
    if (!href || /duckduckgo\.com\/y\.js/.test(href) || title.toLowerCase() === "more info") return;
    const tail = html.slice(m.index!, matches[i + 1]?.index ?? undefined);
    const snippet = clean(tail.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/)?.[1]);
    let url = href;
    try {
      const u = new URL(href, "https://duckduckgo.com");
      url = u.searchParams.get("uddg") ?? u.toString();
    } catch {
      return;
    }
    if (out.length < count && !out.some((r) => r.url === url)) out.push({ title, url, snippet });
  });
  return out;
}

async function duckduckgo(query: string, count: number, apiBase: string): Promise<WebResult[]> {
  const res = await freshFetch(`${apiBase || "https://lite.duckduckgo.com"}/lite/`, {
    timeoutMs: TIMEOUT_MS,
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA, accept: "text/html" },
    body: new URLSearchParams({ q: query, kl: "my-en" }).toString(),
  });
  if (!res.ok) throw new Error(`DuckDuckGo answered ${res.status}`);
  return parseDuckDuckGoLite(await res.text(), count);
}

async function searxng(base: string, query: string, count: number): Promise<WebResult[]> {
  if (!base) throw new Error("no SearXNG address set");
  const url = new URL(`${base.replace(/\/$/, "")}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  const res = await freshFetch(url, { timeoutMs: TIMEOUT_MS, headers: { accept: "application/json" } });
  if (res.status === 403) throw new Error("SearXNG refused JSON: add `json` to search.formats in its settings.yml");
  if (!res.ok) throw new Error(`SearXNG answered ${res.status}`);
  const json = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
  return (json.results ?? []).slice(0, count).map((r) => ({ title: clean(r.title), url: String(r.url ?? ""), snippet: clean(r.content) }));
}

async function brave(key: string, query: string, count: number, apiBase: string): Promise<WebResult[]> {
  const url = new URL(`${apiBase || "https://api.search.brave.com"}/res/v1/web/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));
  const res = await freshFetch(url, { timeoutMs: TIMEOUT_MS, headers: { accept: "application/json", "x-subscription-token": key } });
  if (!res.ok) throw new Error(`Brave answered ${res.status}`);
  const json = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
  return (json.web?.results ?? []).slice(0, count).map((r) => ({ title: clean(r.title), url: String(r.url ?? ""), snippet: clean(r.description) }));
}

async function tavily(key: string, query: string, count: number, apiBase: string): Promise<WebResult[]> {
  const res = await freshFetch(`${apiBase || "https://api.tavily.com"}/search`, {
    timeoutMs: TIMEOUT_MS,
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: count }),
  });
  if (!res.ok) throw new Error(`Tavily answered ${res.status}`);
  const json = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
  return (json.results ?? []).slice(0, count).map((r) => ({ title: clean(r.title), url: String(r.url ?? ""), snippet: clean(r.content) }));
}

/** DuckDuckGo is unofficial: at most this many searches a minute, then the next provider is used. */
const DDG_PER_MINUTE = 20;
const ddgCalls: number[] = [];
function ddgAllowed(now = Date.now()): boolean {
  while (ddgCalls.length && now - ddgCalls[0]! > 60_000) ddgCalls.shift();
  if (ddgCalls.length >= DDG_PER_MINUTE) return false;
  ddgCalls.push(now);
  return true;
}

/** Try each provider in order; the first one with results wins. Throws only when all fail. */
export async function searchWeb(plan: WebSearchPlan, query: string, count: number, apiBase = ""): Promise<{ provider: WebSearchProvider; results: WebResult[] }> {
  const errors: string[] = [];
  let emptyFrom: WebSearchProvider | null = null;
  for (const p of plan.order) {
    try {
      let results: WebResult[];
      if (p === "duckduckgo") {
        if (!ddgAllowed()) throw new Error(`more than ${DDG_PER_MINUTE} searches this minute`);
        results = await duckduckgo(query, count, apiBase);
      } else if (p === "searxng") results = await searxng(plan.searxngUrl, query, count);
      else {
        const key = plan.keys[p];
        if (!key) throw new Error("no API key");
        results = p === "brave" ? await brave(key, query, count, apiBase) : await tavily(key, query, count, apiBase);
      }
      if (results.length) return { provider: p, results };
      emptyFrom ??= p;
    } catch (err) {
      errors.push(`${p}: ${(err as Error).message}`);
    }
  }
  if (emptyFrom) return { provider: emptyFrom, results: [] };
  throw new Error(`web search failed (${errors.join("; ")})`);
}
