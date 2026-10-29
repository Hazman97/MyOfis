import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Secrets } from "./crypto.ts";
import { keyHint } from "./crypto.ts";
import type { Db } from "./db/client.ts";
import { settings } from "./db/schema.ts";

const GITEA_KEY = "integrations.gitea";

const Stored = z.object({ url: z.string(), token_enc: z.string().nullable(), token_hint: z.string().nullable() });

export const GiteaSettingsInput = z.object({
  url: z.string().url().or(z.literal("")),
  /** Write-only. Omit to keep, "" to clear. */
  token: z.string().max(500).optional(),
});

export interface GiteaPublic {
  url: string;
  has_token: boolean;
  token_hint: string | null;
}

/** Gitea connection settings, stored in `settings` with the token encrypted like provider keys. */
export class Integrations {
  constructor(
    private readonly db: Db,
    private readonly secrets: Secrets,
  ) {}

  #read() {
    const row = this.db.select().from(settings).where(eq(settings.key, GITEA_KEY)).get();
    const parsed = Stored.safeParse(row?.value);
    return parsed.success ? parsed.data : null;
  }

  giteaPublic(): GiteaPublic {
    const s = this.#read();
    return { url: s?.url ?? "", has_token: !!s?.token_enc, token_hint: s?.token_hint ?? null };
  }

  /** Decrypted config for runners, or null if Gitea is not fully configured. */
  gitea(): { url: string; token: string } | null {
    const s = this.#read();
    if (!s?.url || !s.token_enc) return null;
    return { url: s.url.replace(/\/$/, ""), token: this.secrets.decrypt(s.token_enc) };
  }

  setGitea(input: z.input<typeof GiteaSettingsInput>): GiteaPublic {
    const data = GiteaSettingsInput.parse(input);
    const prev = this.#read();
    const value = {
      url: data.url.replace(/\/$/, ""),
      token_enc: data.token === undefined ? (prev?.token_enc ?? null) : data.token ? this.secrets.encrypt(data.token) : null,
      token_hint: data.token === undefined ? (prev?.token_hint ?? null) : data.token ? keyHint(data.token) : null,
    };
    this.db
      .insert(settings)
      .values({ key: GITEA_KEY, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
    return this.giteaPublic();
  }

  /** First boot: take GITEA_URL / GITEA_TOKEN from .env if nothing is stored yet. */
  seedFromEnv(url: string, token: string): void {
    if (url && token && !this.#read()) this.setGitea({ url, token });
  }

  // ---------------------------------------------------------------- Telegram

  #readTelegram() {
    const row = this.db.select().from(settings).where(eq(settings.key, TELEGRAM_KEY)).get();
    const parsed = StoredTelegram.safeParse(row?.value);
    return parsed.success ? parsed.data : null;
  }

  telegramPublic(): TelegramPublic {
    const s = this.#readTelegram();
    return { has_token: !!s?.token_enc, token_hint: s?.token_hint ?? null, chat_id: s?.chat_id ?? "", enabled: s?.enabled ?? true };
  }

  /** Decrypted bot settings, or null when no token is stored or Telegram is switched off. */
  telegram(): { token: string; chatId: string } | null {
    const s = this.#readTelegram();
    if (!s?.token_enc || !s.enabled) return null;
    return { token: this.secrets.decrypt(s.token_enc), chatId: s.chat_id };
  }

  setTelegram(input: z.input<typeof TelegramSettingsInput>): TelegramPublic {
    const data = TelegramSettingsInput.parse(input);
    const prev = this.#readTelegram();
    const value = {
      token_enc: data.token === undefined ? (prev?.token_enc ?? null) : data.token ? this.secrets.encrypt(data.token) : null,
      token_hint: data.token === undefined ? (prev?.token_hint ?? null) : data.token ? keyHint(data.token) : null,
      chat_id: data.chat_id ?? prev?.chat_id ?? "",
      enabled: data.enabled ?? prev?.enabled ?? true,
    };
    this.db
      .insert(settings)
      .values({ key: TELEGRAM_KEY, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
    for (const fn of this.#telegramListeners) fn();
    return this.telegramPublic();
  }

  /** Called whenever the Telegram settings change (the bot restarts its polling). */
  onTelegramChange(fn: () => void): void {
    this.#telegramListeners.add(fn);
  }
  readonly #telegramListeners = new Set<() => void>();

  seedTelegramFromEnv(token: string, chatId: string): void {
    if (token && !this.#readTelegram()) this.setTelegram({ token, chat_id: chatId });
  }

  /** A getter, not a field: parameter properties are not set yet when field initialisers run. */
  get webSearch() {
    return webSearchSettings(this.db, this.secrets);
  }

  get tts() {
    return ttsSettings(this.db, this.secrets);
  }
}

const TELEGRAM_KEY = "integrations.telegram";

const StoredTelegram = z.object({
  token_enc: z.string().nullable(),
  token_hint: z.string().nullable(),
  chat_id: z.string(),
  enabled: z.boolean().default(true),
});

export const TelegramSettingsInput = z.object({
  /** Write-only. Omit to keep, "" to clear. */
  token: z.string().max(200).regex(/^(\d+:[A-Za-z0-9_-]{20,})?$/, "looks like 123456:ABC… from @BotFather").optional(),
  /** Numeric chat id of the owner (send /id to the bot to see it). */
  chat_id: z.string().regex(/^-?\d{0,20}$/, "numbers only").optional(),
  enabled: z.boolean().optional(),
});

export interface TelegramPublic {
  has_token: boolean;
  token_hint: string | null;
  chat_id: string;
  enabled: boolean;
}

// ---------------------------------------------------------------- web search (Researcher)

const WEB_SEARCH_KEY = "integrations.web_search";
const Provider = z.enum(["duckduckgo", "searxng", "tavily", "brave"]);
const KeyProvider = z.enum(["tavily", "brave"]);
const StoredWebSearch = z.object({
  provider: Provider.default("duckduckgo"),
  key_provider: KeyProvider.nullable().default(null),
  key_enc: z.string().nullable().default(null),
  key_hint: z.string().nullable().default(null),
  searxng_url: z.string().default(""),
});

export const WebSearchSettingsInput = z.object({
  /** Tried first; the others that are set up are the fallbacks. */
  provider: Provider,
  searxng_url: z.string().url().or(z.literal("")).optional(),
  key_provider: KeyProvider.optional(),
  /** Write-only. Omit to keep, "" to clear. */
  api_key: z.string().max(500).optional(),
});

export interface WebSearchPublic {
  provider: z.infer<typeof Provider>;
  searxng_url: string;
  key_provider: "tavily" | "brave" | null;
  has_key: boolean;
  key_hint: string | null;
  /** The order the hub will try, given what is set up. */
  order: z.infer<typeof Provider>[];
}

const FALLBACK: z.infer<typeof Provider>[] = ["duckduckgo", "searxng", "tavily", "brave"];

export function webSearchSettings(db: Db, secrets: Secrets) {
  const read = () => {
    const row = db.select().from(settings).where(eq(settings.key, WEB_SEARCH_KEY)).get();
    const v = row?.value as Record<string, unknown> | undefined;
    // before DuckDuckGo/SearXNG the key belonged to `provider` (brave or tavily)
    const legacy = v && !("key_provider" in v) && (v.provider === "brave" || v.provider === "tavily") ? { key_provider: v.provider } : {};
    const parsed = StoredWebSearch.safeParse({ ...v, ...legacy });
    return parsed.success ? parsed.data : StoredWebSearch.parse({});
  };
  const usable = (s: ReturnType<typeof read>, p: z.infer<typeof Provider>) =>
    p === "duckduckgo" || (p === "searxng" ? !!s.searxng_url : s.key_provider === p && !!s.key_enc);
  const order = (s: ReturnType<typeof read>) => [s.provider, ...FALLBACK.filter((p) => p !== s.provider)].filter((p) => usable(s, p));
  const pub = (): WebSearchPublic => {
    const s = read();
    return { provider: s.provider, searxng_url: s.searxng_url, key_provider: s.key_provider, has_key: !!s.key_enc, key_hint: s.key_hint, order: order(s) };
  };
  return {
    public: pub,
    /** What searchWeb needs: the order and the decrypted key. DuckDuckGo needs nothing, so there is always a plan. */
    plan(): { order: z.infer<typeof Provider>[]; searxngUrl: string; keys: Partial<Record<"tavily" | "brave", string>> } {
      const s = read();
      const keys = s.key_provider && s.key_enc ? { [s.key_provider]: secrets.decrypt(s.key_enc) } : {};
      return { order: order(s), searxngUrl: s.searxng_url, keys };
    },
    set(input: z.input<typeof WebSearchSettingsInput>): WebSearchPublic {
      const data = WebSearchSettingsInput.parse(input);
      const prev = read();
      const keyChanged = data.api_key !== undefined;
      const value = {
        provider: data.provider,
        searxng_url: (data.searxng_url ?? prev.searxng_url).replace(/\/$/, ""),
        key_provider: data.key_provider ?? prev.key_provider ?? (data.provider === "brave" || data.provider === "tavily" ? data.provider : null),
        key_enc: keyChanged ? (data.api_key ? secrets.encrypt(data.api_key) : null) : prev.key_enc,
        key_hint: keyChanged ? (data.api_key ? keyHint(data.api_key) : null) : prev.key_hint,
      };
      db.insert(settings).values({ key: WEB_SEARCH_KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
      return pub();
    },
  };
}

// ---------------------------------------------------------------- TTS (Cikgu Tech / explainer)

const TTS_KEY = "integrations.tts";

const StoredTts = z.object({
  base_url: z.string().default(""),
  key_enc: z.string().nullable().default(null),
  key_hint: z.string().nullable().default(null),
  voice: z.string().default("af_sarah"),
  speed: z.number().default(1.0),
});

export const TtsSettingsInput = z.object({
  base_url: z.string().max(500),
  /** Write-only. Omit to keep, "" to clear. */
  api_key: z.string().max(500).optional(),
  voice: z.string().max(50).optional(),
  speed: z.number().min(0.25).max(4.0).optional(),
});

export interface TtsPublic {
  base_url: string;
  has_key: boolean;
  key_hint: string | null;
  voice: string;
  speed: number;
}

export function ttsSettings(db: Db, secrets: Secrets) {
  const read = () => {
    const row = db.select().from(settings).where(eq(settings.key, TTS_KEY)).get();
    const parsed = StoredTts.safeParse(row?.value);
    return parsed.success ? parsed.data : StoredTts.parse({});
  };

  const pub = (): TtsPublic => {
    const s = read();
    return {
      base_url: s.base_url,
      has_key: !!s.key_enc,
      key_hint: s.key_hint,
      voice: s.voice,
      speed: s.speed,
    };
  };

  return {
    public: pub,
    plan(): { base_url: string; key: string | null; voice: string; speed: number } | null {
      const envBase = process.env.TTS_API_BASE?.trim();
      const s = read();
      const base = envBase || s.base_url.replace(/\/$/, "");
      if (!base) return null;
      return {
        base_url: base,
        key: s.key_enc ? secrets.decrypt(s.key_enc) : null,
        voice: s.voice || "af_sarah",
        speed: s.speed || 1.0,
      };
    },
    set(input: z.input<typeof TtsSettingsInput>): TtsPublic {
      const data = TtsSettingsInput.parse(input);
      const prev = read();
      const keyChanged = data.api_key !== undefined;
      const value = {
        base_url: data.base_url.replace(/\/$/, ""),
        key_enc: keyChanged ? (data.api_key ? secrets.encrypt(data.api_key) : null) : prev.key_enc,
        key_hint: keyChanged ? (data.api_key ? keyHint(data.api_key) : null) : prev.key_hint,
        voice: data.voice ?? prev.voice ?? "af_sarah",
        speed: data.speed ?? prev.speed ?? 1.0,
      };
      db.insert(settings).values({ key: TTS_KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
      return pub();
    },
  };
}
