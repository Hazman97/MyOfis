import { eq } from "drizzle-orm";
import { BUILTIN_AGENTS } from "@agent-office/agents";
import { AgentInput, ScheduleInput } from "@agent-office/shared";
import type { HubConfig } from "./env.ts";
import { keyHint, type Secrets } from "./crypto.ts";
import type { Db } from "./db/client.ts";
import { agents, providers, schedules } from "./db/schema.ts";
import { newId } from "./repo.ts";

/** Idempotent: only inserts what is missing, never overwrites owner edits. */
export function seed(db: Db, config: HubConfig, secrets: Secrets): void {
  const has = (slug: string) => !!db.select({ id: providers.id }).from(providers).where(eq(providers.slug, slug)).get();
  const firstBoot = !db.select({ id: providers.id }).from(providers).get();

  if (!has("mock")) {
    db.insert(providers)
      .values({ id: newId("prv"), slug: "mock", name: "Mock (no LLM, for testing)", kind: "mock", models: ["mock-echo", "mock-slow", "mock-fail", "mock-script"] })
      .run();
  }
  if (firstBoot) {
    if (config.seed.anthropicApiKey && !has("anthropic")) {
      db.insert(providers)
        .values({
          id: newId("prv"),
          slug: "anthropic",
          name: "Anthropic",
          kind: "anthropic",
          api_key_enc: secrets.encrypt(config.seed.anthropicApiKey),
          api_key_hint: keyHint(config.seed.anthropicApiKey),
          models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
        })
        .run();
    }
    if (config.seed.openaiApiKey && !has("openai")) {
      db.insert(providers)
        .values({
          id: newId("prv"),
          slug: "openai",
          name: "OpenAI",
          kind: "openai",
          api_key_enc: secrets.encrypt(config.seed.openaiApiKey),
          api_key_hint: keyHint(config.seed.openaiApiKey),
        })
        .run();
    }
    if (config.seed.ollamaBaseUrl && !has("ollama")) {
      db.insert(providers)
        .values({
          id: newId("prv"),
          slug: "ollama",
          name: "Ollama (local)",
          kind: "openai_compatible",
          base_url: `${config.seed.ollamaBaseUrl.replace(/\/$/, "")}/v1`,
        })
        .run();
    }
  }

  const llm = pickLlm(db);
  for (const { agent: def, needsLlm, schedules: makeSchedules } of BUILTIN_AGENTS) {
    if (db.select({ id: agents.id }).from(agents).where(eq(agents.slug, def.slug)).get()) continue;
    const id = newId("agt");
    const parsed = AgentInput.parse(needsLlm && llm ? { ...def, provider: llm.provider, model: llm.model } : def);
    db.insert(agents).values({ ...parsed, id }).run();
    for (const s of makeSchedules?.(id) ?? []) {
      db.insert(schedules).values({ ...ScheduleInput.parse(s), id: newId("sch") }).run();
    }
  }
}

/** Default models per provider for seeded agents. The owner changes them in Agents. */
const DEFAULT_MODEL: Record<string, string> = {
  anthropic: "claude-opus-5-5",
  // Free and tool-capable; worked on 2026-10-16. Free models can be rate-limited (HTTP 429).
  openrouter: "nvidia/nemotron-3-super-120b-a12b:free",
};

/**
 * LLM for newly seeded agents: the provider + model most of the owner's agents
 * already use (their choice wins), else the first non-mock provider that has
 * an API key (or a local base URL).
 */
function pickLlm(db: Db): { provider: string; model: string } | null {
  const rows = db.select().from(providers).all();
  const enabled = new Set(rows.filter((p) => p.enabled && p.kind !== "mock").map((p) => p.slug));
  const counts = new Map<string, number>();
  for (const a of db.select({ provider: agents.provider, model: agents.model, enabled: agents.enabled }).from(agents).all()) {
    if (!a.enabled || !enabled.has(a.provider)) continue;
    const key = `${a.provider}\u0000${a.model}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const popular = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (popular) {
    const [provider, model] = popular[0].split("\u0000") as [string, string];
    return { provider, model };
  }
  const order = ["anthropic", "openrouter", "openai", "google"];
  const rank = (slug: string) => (order.includes(slug) ? order.indexOf(slug) : order.length);
  const usable = rows
    .filter((p) => p.enabled && p.kind !== "mock" && (p.api_key_enc || /127\.0\.0\.1|localhost/.test(p.base_url ?? "")))
    .sort((a, b) => rank(a.slug) - rank(b.slug));
  for (const p of usable) {
    const model = DEFAULT_MODEL[p.slug] ?? p.models[0];
    if (model) return { provider: p.slug, model };
  }
  return null;
}
