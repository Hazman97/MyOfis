import { resolve } from "node:path";
import { z } from "zod";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

const EnvSchema = z
  .object({
    HUB_PORT: z.coerce.number().int().min(0).max(65535).default(8787),
    HUB_HOST: z.string().default("127.0.0.1"),
    PUBLIC_BASE_URL: z.string().url().default("http://127.0.0.1:8787"),
    AUTH_MODE: z.enum(["local", "cf-access"]).default("local"),
    LOCAL_AUTH_TOKEN: z.string().default(""),
    SECRETS_KEY: z.string().default(""),
    CF_ACCESS_TEAM_DOMAIN: z.string().default(""),
    CF_ACCESS_AUD: z.string().default(""),
    OWNER_EMAIL: z.string().default(""),
    /** Optional comma-separated Cloudflare Access Service Token client IDs (`common_name`) for assistant test access. */
    OWNER_SERVICE_TOKENS: z.string().default(""),
    /** Tests point this at a local JWKS; normally https://<team>/cdn-cgi/access/certs. */
    CF_ACCESS_CERTS_URL: z.string().url().or(z.literal("")).default(""),
    DATABASE_PATH: z.string().default("./data/agent-office.db"),
    FILES_DIR: z.string().default("./data/files"),
    WORKSPACES_DIR: z.string().default("./workspaces"),
    WEB_DIST_DIR: z.string().default("./apps/web/dist"),
    MAPS_DIR: z.string().default("./maps"),
    /** The owner's manual, shown in the app at /manual. */
    MANUAL_PATH: z.string().default("./docs/manual.html"),
    /** The system overview served without login at /aitext (for pasting one link into another AI). */
    SYSTEM_DOC_PATH: z.string().default("./SYSTEM.md"),
    PROJECTS_DIR: z.string().default("./projects"),
    SKILLS_DIR: z.string().default("./skills"),
    /** Tests point web search at a fake API. */
    WEB_SEARCH_API_BASE: z.string().default(""),
    /** Tests point Facebook posting at a fake Graph API. */
    FACEBOOK_GRAPH_BASE: z.string().default("https://graph.facebook.com/v21.0"),
    THREADS_GRAPH_BASE: z.string().default("https://graph.threads.net/v1.0"),
    ZERNIO_API_BASE: z.string().default("https://zernio.com/api/v1"),
    /** Tests point the OpenCut watcher at a fake GitHub API. */
    OPENCUT_API_BASE: z.string().default("https://api.github.com"),
    BACKUP_DIR: z.string().default("./data/backups"),
    BACKUP_KEEP: z.coerce.number().int().min(1).max(365).default(14),
    BACKUP_HOUR: z.coerce.number().int().min(0).max(23).default(3),
    ANTHROPIC_API_KEY: z.string().default(""),
    OPENAI_API_KEY: z.string().default(""),
    OLLAMA_BASE_URL: z.string().default(""),
    GITEA_URL: z.string().default(""),
    GITEA_TOKEN: z.string().default(""),
    TELEGRAM_BOT_TOKEN: z.string().default(""),
    TELEGRAM_OWNER_CHAT_ID: z.string().default(""),
    /** Tests point this at a fake Bot API. */
    TELEGRAM_API_BASE: z.string().url().default("https://api.telegram.org"),
  })
  .superRefine((e, ctx) => {
    if (e.AUTH_MODE === "local" && (e.LOCAL_AUTH_TOKEN.length < 12 || e.LOCAL_AUTH_TOKEN === "change-me")) {
      ctx.addIssue({
        code: "custom",
        path: ["LOCAL_AUTH_TOKEN"],
        message: "set LOCAL_AUTH_TOKEN in .env to a random string of at least 12 characters",
      });
    }
    if (e.AUTH_MODE === "cf-access") {
      for (const [key, hint] of [
        ["CF_ACCESS_TEAM_DOMAIN", "your Zero Trust team domain, e.g. yourteam.cloudflareaccess.com"],
        ["CF_ACCESS_AUD", "the Application Audience (AUD) tag of the Access application"],
        ["OWNER_EMAIL", "the email you log in to Cloudflare Access with"],
      ] as const) {
        if (!e[key]) ctx.addIssue({ code: "custom", path: [key], message: `AUTH_MODE=cf-access needs ${key}: ${hint}` });
      }
    }
    if (e.SECRETS_KEY.length < 32 || e.SECRETS_KEY.startsWith("change-me")) {
      ctx.addIssue({
        code: "custom",
        path: ["SECRETS_KEY"],
        message: "set SECRETS_KEY in .env to a random string of at least 32 characters",
      });
    }
  });

export interface HubConfig {
  host: string;
  port: number;
  publicBaseUrl: string;
  authMode: "local" | "cf-access";
  localAuthToken: string;
  secretsKey: string;
  cfAccess: { teamDomain: string; aud: string; ownerEmail: string; certsUrl: string; ownerServiceTokens?: string[] };
  databasePath: string;
  filesDir: string;
  webDistDir: string;
  /** Office map + sprite art served to the office view (swap files here to re-skin it). */
  mapsDir: string;
  manualPath: string;
  opencutApiBase: string;
  systemDocPath: string;
  /** projects/<slug>/brief.yaml and FEATURES.md (spec §4). */
  projectsDir: string;
  /** skills/<name>/SKILL.md (agentskills.io format). */
  skillsDir: string;
  /** Nightly backups (data/backups/<date>/): keep this many days; run after this hour (Malaysia time). */
  backup: { dir: string; keep: number; hour: number };
  webSearchApiBase: string;
  facebookGraphBase: string;
  threadsGraphBase: string;
  zernioApiBase: string;
  telegramApiBase: string;
  seed: {
    anthropicApiKey: string;
    openaiApiKey: string;
    ollamaBaseUrl: string;
    giteaUrl: string;
    giteaToken: string;
    telegramToken: string;
    telegramChatId: string;
  };
}

export function loadConfig(env: Record<string, string | undefined> = process.env): HubConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid hub configuration (copy .env.example to .env and fill it in):\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  if (!LOOPBACK.has(e.HUB_HOST)) {
    console.warn(
      `[hub] WARNING: HUB_HOST=${e.HUB_HOST} is not loopback. Expose the hub only through Cloudflare Tunnel + Access.`,
    );
  }
  return {
    host: e.HUB_HOST,
    port: e.HUB_PORT,
    publicBaseUrl: e.PUBLIC_BASE_URL.replace(/\/$/, ""),
    authMode: e.AUTH_MODE,
    localAuthToken: e.LOCAL_AUTH_TOKEN,
    secretsKey: e.SECRETS_KEY,
    cfAccess: {
      teamDomain: e.CF_ACCESS_TEAM_DOMAIN,
      aud: e.CF_ACCESS_AUD,
      ownerEmail: e.OWNER_EMAIL,
      certsUrl: e.CF_ACCESS_CERTS_URL,
      ownerServiceTokens: e.OWNER_SERVICE_TOKENS.split(",").map((s) => s.trim()).filter(Boolean),
    },
    databasePath: e.DATABASE_PATH === ":memory:" ? ":memory:" : resolve(e.DATABASE_PATH),
    filesDir: resolve(e.FILES_DIR),
    webDistDir: resolve(e.WEB_DIST_DIR),
    mapsDir: resolve(e.MAPS_DIR),
    manualPath: resolve(e.MANUAL_PATH),
    opencutApiBase: e.OPENCUT_API_BASE,
    systemDocPath: resolve(e.SYSTEM_DOC_PATH),
    projectsDir: resolve(e.PROJECTS_DIR),
    skillsDir: resolve(e.SKILLS_DIR),
    backup: { dir: resolve(e.BACKUP_DIR), keep: e.BACKUP_KEEP, hour: e.BACKUP_HOUR },
    webSearchApiBase: e.WEB_SEARCH_API_BASE.replace(/\/$/, ""),
    facebookGraphBase: e.FACEBOOK_GRAPH_BASE.replace(/\/$/, ""),
    threadsGraphBase: e.THREADS_GRAPH_BASE.replace(/\/$/, ""),
    zernioApiBase: e.ZERNIO_API_BASE.replace(/\/$/, ""),
    telegramApiBase: e.TELEGRAM_API_BASE.replace(/\/$/, ""),
    seed: {
      anthropicApiKey: e.ANTHROPIC_API_KEY,
      openaiApiKey: e.OPENAI_API_KEY,
      ollamaBaseUrl: e.OLLAMA_BASE_URL,
      giteaUrl: e.GITEA_URL,
      giteaToken: e.GITEA_TOKEN,
      telegramToken: e.TELEGRAM_BOT_TOKEN,
      telegramChatId: e.TELEGRAM_OWNER_CHAT_ID,
    },
  };
}
