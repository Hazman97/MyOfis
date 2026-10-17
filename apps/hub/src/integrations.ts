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
const StoredWebSearch = z.object({ provider: z.enum(["brave", "tavily"]), key_enc: z.string().nullable(), key_hint: z.string().nullable() });

export const WebSearchSettingsInput = z.object({
  provider: z.enum(["brave", "tavily"]),
  /** Write-only. Omit to keep, "" to clear. */
  api_key: z.string().max(500).optional(),
});

export interface WebSearchPublic {
  provider: "brave" | "tavily";
  has_key: boolean;
  key_hint: string | null;
}

export function webSearchSettings(db: Db, secrets: Secrets) {
  const read = () => {
    const row = db.select().from(settings).where(eq(settings.key, WEB_SEARCH_KEY)).get();
    const parsed = StoredWebSearch.safeParse(row?.value);
    return parsed.success ? parsed.data : null;
  };
  const pub = (): WebSearchPublic => {
    const s = read();
    return { provider: s?.provider ?? "brave", has_key: !!s?.key_enc, key_hint: s?.key_hint ?? null };
  };
  return {
    public: pub,
    /** Decrypted config, or null when no key is stored. */
    config(): { provider: "brave" | "tavily"; apiKey: string } | null {
      const s = read();
      return s?.key_enc ? { provider: s.provider, apiKey: secrets.decrypt(s.key_enc) } : null;
    },
    set(input: z.input<typeof WebSearchSettingsInput>): WebSearchPublic {
      const data = WebSearchSettingsInput.parse(input);
      const prev = read();
      const value = {
        provider: data.provider,
        key_enc: data.api_key === undefined ? (prev?.key_enc ?? null) : data.api_key ? secrets.encrypt(data.api_key) : null,
        key_hint: data.api_key === undefined ? (prev?.key_hint ?? null) : data.api_key ? keyHint(data.api_key) : null,
      };
      db.insert(settings).values({ key: WEB_SEARCH_KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
      return pub();
    },
  };
}
