import { existsSync } from "node:fs";
import { join } from "node:path";
import { and, desc, eq, lt } from "drizzle-orm";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { setCookie, deleteCookie } from "hono/cookie";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { z, ZodError } from "zod";
import {
  AgentInput,
  AgentPatch,
  DraftDecision,
  EXAMPLE_BRIEF,
  FeatureNoteInput,
  JobInput,
  PROVIDER_PRESETS,
  ProjectInput,
  ProviderInput,
  ScheduleInput,
  TIMEZONE,
} from "@agent-office/shared";
import { TOOL_REGISTRY } from "@agent-office/tools";
import { SESSION_COOKIE, SESSION_TTL_MS, isHttps, requireOwner, type Authenticator } from "./auth.ts";
import type { Hub } from "./core.ts";
import { hashToken, keyHint, normalizeCode, pairingCode, randomToken } from "./crypto.ts";
import { agents, approvals, jobs, pairingCodes, projects, providers, runners, runs, schedules } from "./db/schema.ts";
import { assertValidCron, type Scheduler } from "./scheduler.ts";
import type { Integrations } from "./integrations.ts";
import type { TelegramBot } from "./telegram.ts";
import {
  HttpError,
  getAgent,
  getProviderBySlug,
  getRun,
  getRunner,
  newId,
  toAgent,
  toJob,
  toProviderPublic,
  toRun,
  toRunner,
} from "./repo.ts";

const PAIRING_TTL_MS = 10 * 60 * 1000;
const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const ARTIFACT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.[a-z0-9]{2,4}$/;
/** Only types that cannot run script in the browser. */
const ARTIFACT_TYPES: Record<string, string> = { png: "image/png", md: "text/plain; charset=utf-8", txt: "text/plain; charset=utf-8" };
/** Flat file names only (no dirs, no dot-files), inert types only. */
const OFFICE_ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(png|json|tmj)$/;
const OFFICE_ASSET_TYPES: Record<string, string> = { png: "image/png", json: "application/json", tmj: "application/json" };
const DEV_PORT = process.env.WEB_DEV_PORT ?? "5180";
const DEV_ORIGINS = [`http://localhost:${DEV_PORT}`, `http://127.0.0.1:${DEV_PORT}`];

/** Tiny fixed-window limiter; enough for a single-owner hub. */
function limiter(max: number, windowMs: number) {
  let windowStart = 0;
  let count = 0;
  return () => {
    const now = Date.now();
    if (now - windowStart > windowMs) {
      windowStart = now;
      count = 0;
    }
    return ++count <= max;
  };
}

const intParam = (v: string | undefined, fallback: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
};

export function createHttpApp(hub: Hub, auth: Authenticator, scheduler: Scheduler, integrations: Integrations, telegram: TelegramBot): Hono {
  const { db, store, secrets, config } = hub;
  const app = new Hono();
  const publicOrigin = new URL(config.publicBaseUrl).origin;
  const pairLimit = limiter(20, 60_000);
  const loginLimit = limiter(20, 60_000);

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    if (err instanceof HTTPException) return err.getResponse();
    if (err instanceof ZodError) return c.json({ error: "validation failed", issues: err.issues }, 400);
    if (err instanceof SyntaxError) return c.json({ error: "invalid JSON body" }, 400);
    console.error("[hub] unhandled error", err);
    return c.json({ error: "internal error" }, 500);
  });

  // Same-origin check for state-changing requests (cookie auth is SameSite=Strict too).
  app.use(
    "/api/*",
    csrf({
      origin: (origin, c) =>
        origin === publicOrigin || origin === new URL(c.req.url).origin || DEV_ORIGINS.includes(origin),
    }),
  );

  // ------------------------------------------------------------ public

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.post("/api/auth/login", async (c) => {
    if (!loginLimit()) throw new HttpError(429, "too many attempts, wait a minute");
    const { token } = z.object({ token: z.string().min(1).max(500) }).parse(await c.req.json());
    const value = auth.login(token);
    if (!value) throw new HttpError(401, "wrong token");
    setCookie(c, SESSION_COOKIE, value, {
      httpOnly: true,
      sameSite: "Strict",
      secure: isHttps(c),
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    return c.json({ ok: true });
  });

  app.post("/api/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  /** Runner exchanges a one-time pairing code for a long-lived token. */
  app.post("/api/runners/pair", async (c) => {
    if (!pairLimit()) throw new HttpError(429, "too many pairing attempts, wait a minute");
    const body = z.object({ code: z.string().min(4).max(20), name: z.string().min(1).max(80) }).parse(await c.req.json());
    const codeHash = hashToken(normalizeCode(body.code));
    const now = new Date().toISOString();
    const token = randomToken(32);
    const runnerId = newId("rnr");
    const ok = db.transaction((tx) => {
      const row = tx.select().from(pairingCodes).where(eq(pairingCodes.code_hash, codeHash)).get();
      if (!row || row.used_at || row.expires_at < now) return false;
      tx.insert(runners).values({ id: runnerId, name: body.name, token_hash: hashToken(token), status: "offline" }).run();
      tx.update(pairingCodes).set({ used_at: now, runner_id: runnerId }).where(eq(pairingCodes.code_hash, codeHash)).run();
      return true;
    });
    if (!ok) throw new HttpError(401, "pairing code is invalid, used or expired");
    return c.json({ runner_id: runnerId, token });
  });

  /** Runner uploads a run artifact (screenshot, report). Authenticated with the runner's own token. */
  app.post("/api/runner/artifacts/:runId/:name", async (c) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const runner = token ? db.select().from(runners).where(eq(runners.token_hash, hashToken(token))).get() : undefined;
    if (!runner) throw new HttpError(401, "unauthorized");
    const { runId, name } = c.req.param();
    const run = getRun(db, runId);
    if (!run || run.runner_id !== runner.id) throw new HttpError(404, "run not found");
    if (!ARTIFACT_NAME.test(name)) throw new HttpError(400, "invalid artifact name");
    const ext = name.split(".").pop()!.toLowerCase();
    if (!ARTIFACT_TYPES[ext]) throw new HttpError(400, `artifact type .${ext} not allowed`);
    const len = Number(c.req.header("content-length") ?? 0);
    if (len > MAX_ARTIFACT_BYTES) throw new HttpError(400, "artifact too large");
    const data = new Uint8Array(await c.req.arrayBuffer());
    if (data.byteLength > MAX_ARTIFACT_BYTES) throw new HttpError(400, "artifact too large");
    const key = `artifacts/${runId}/${name}`;
    await hub.storage.put(key, data);
    return c.json({ path: key }, 201);
  });

  // ------------------------------------------------------------ owner only

  const api = new Hono();
  api.use("*", requireOwner(auth));

  api.get("/auth/me", (c) => c.json({ ok: true, mode: auth.mode }));

  api.get("/state", (c) => c.json({ state: store.state }));

  api.get("/events", (c) => {
    const since = intParam(c.req.query("since"), 0, Number.MAX_SAFE_INTEGER);
    const limit = intParam(c.req.query("limit"), 500, 5000);
    return c.json({ events: store.list(since, limit, c.req.query("run_id") || undefined) });
  });

  // settings / kill switch
  api.get("/settings", (c) =>
    c.json({ paused: hub.paused, auth_mode: auth.mode, timezone: TIMEZONE, public_base_url: config.publicBaseUrl }),
  );
  api.post("/settings/pause", async (c) => {
    const { paused } = z.object({ paused: z.boolean() }).parse(await c.req.json());
    hub.setPaused(paused);
    return c.json({ paused: hub.paused });
  });

  // integrations (Gitea). The token is write-only, like provider keys.
  api.get("/settings/integrations", (c) => c.json({ gitea: integrations.giteaPublic(), telegram: integrations.telegramPublic() }));
  api.put("/settings/integrations/telegram", async (c) => c.json({ telegram: integrations.setTelegram(await c.req.json()) }));
  api.post("/settings/integrations/telegram/test", async (c) => {
    try {
      await telegram.test();
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message });
    }
  });
  api.put("/settings/integrations/gitea", async (c) => c.json({ gitea: integrations.setGitea(await c.req.json()) }));
  api.post("/settings/integrations/gitea/test", async (c) => {
    const cfg = integrations.gitea();
    if (!cfg) throw new HttpError(400, "set the Gitea URL and token first");
    const res = await fetch(`${cfg.url}/api/v1/user`, { headers: { authorization: `token ${cfg.token}` } }).catch((e: Error) => e);
    if (res instanceof Error) return c.json({ ok: false, error: res.message });
    if (!res.ok) return c.json({ ok: false, error: `Gitea answered ${res.status}` });
    const user = (await res.json()) as { login?: string };
    return c.json({ ok: true, login: user.login ?? null });
  });

  // agents
  api.get("/agents", (c) => c.json({ agents: db.select().from(agents).orderBy(agents.created_at).all().map(toAgent) }));
  api.get("/agents/:id", (c) => {
    const a = getAgent(db, c.req.param("id"));
    if (!a) throw new HttpError(404, "agent not found");
    return c.json({ agent: toAgent(a) });
  });
  api.post("/agents", async (c) => {
    const data = AgentInput.parse(await c.req.json());
    assertAgentRefs(data.provider, data.runner_id);
    assertTools(data.tools);
    if (db.select({ id: agents.id }).from(agents).where(eq(agents.slug, data.slug)).get()) {
      throw new HttpError(409, "slug already used");
    }
    const row = db.insert(agents).values({ ...data, id: newId("agt") }).returning().get();
    return c.json({ agent: toAgent(row) }, 201);
  });
  api.patch("/agents/:id", async (c) => {
    const id = c.req.param("id");
    if (!getAgent(db, id)) throw new HttpError(404, "agent not found");
    const raw = z.record(z.string(), z.unknown()).parse(await c.req.json());
    const patch = AgentPatch.parse(raw);
    // Partial parse still fills defaults; keep only keys the client actually sent.
    const changes = Object.fromEntries(Object.entries(patch).filter(([k]) => k in raw));
    assertTools(changes.tools);
    if (typeof changes.provider === "string" || changes.runner_id !== undefined) {
      assertAgentRefs(changes.provider as string | undefined, changes.runner_id as string | null | undefined);
    }
    const row = db.update(agents).set(changes).where(eq(agents.id, id)).returning().get();
    hub.dispatch();
    return c.json({ agent: toAgent(row!) });
  });

  function assertTools(tools: unknown) {
    if (!Array.isArray(tools)) return;
    const unknown = tools.filter((t) => typeof t !== "string" || !(t in TOOL_REGISTRY));
    if (unknown.length) throw new HttpError(400, `unknown tools: ${unknown.join(", ")}`);
  }

  function assertAgentRefs(provider: string | undefined, runnerId: string | null | undefined) {
    if (provider !== undefined && !getProviderBySlug(db, provider)) throw new HttpError(400, `unknown provider "${provider}"`);
    if (runnerId && !getRunner(db, runnerId)) throw new HttpError(400, "unknown runner");
  }

  // projects
  api.get("/projects", (c) => c.json({ projects: db.select().from(projects).orderBy(projects.name).all() }));
  api.post("/projects", async (c) => {
    const data = ProjectInput.parse(await c.req.json());
    if (db.select({ id: projects.id }).from(projects).where(eq(projects.slug, data.slug)).get()) {
      throw new HttpError(409, "slug already used");
    }
    const row = db.insert(projects).values({ ...data, id: newId("prj") }).returning().get();
    return c.json({ project: row }, 201);
  });
  api.patch("/projects/:id", async (c) => {
    const id = c.req.param("id");
    if (!db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).get()) throw new HttpError(404, "project not found");
    const raw = z.record(z.string(), z.unknown()).parse(await c.req.json());
    const patch = ProjectInput.omit({ slug: true }).partial().parse(raw);
    const changes = Object.fromEntries(Object.entries(patch).filter(([k]) => k in raw));
    const row = db.update(projects).set(changes).where(eq(projects.id, id)).returning().get();
    return c.json({ project: row });
  });

  // project briefs (projects/<slug>/brief.yaml) and the feature log
  api.get("/projects/:id/brief", (c) => {
    const p = hub.content.project(c.req.param("id"));
    return c.json({ brief: hub.content.readBrief(p), example: EXAMPLE_BRIEF, path: `projects/${p.slug}/brief.yaml` });
  });
  api.put("/projects/:id/brief", async (c) => {
    const p = hub.content.project(c.req.param("id"));
    return c.json({ brief: hub.content.writeBrief(p, await c.req.json()) });
  });
  api.get("/projects/:id/features", (c) => {
    const p = hub.content.project(c.req.param("id"));
    return c.json({ features: hub.content.features(p.id) });
  });
  api.post("/projects/:id/features", async (c) => {
    const p = hub.content.project(c.req.param("id"));
    const note = FeatureNoteInput.parse(await c.req.json());
    return c.json({ feature: hub.addFeature(p.id, { title: note.title, user_facing_note: note.user_facing_note, source_pr_url: note.source_pr_url ?? null }) }, 201);
  });

  // content drafts: Marketing's output, never published by the system
  api.get("/drafts", (c) => {
    const status = c.req.query("status");
    return c.json({ drafts: hub.content.listDrafts({ status: status === "pending" || status === "decided" ? status : undefined, project_id: c.req.query("project_id") || undefined }) });
  });
  api.post("/drafts/:id/decide", async (c) => {
    const decision = DraftDecision.parse(await c.req.json());
    return c.json({ draft: hub.content.decideDraft(c.req.param("id"), decision) });
  });

  // chat with an agent (each message is a "chat" job; replies are the run's text)
  api.post("/chat", async (c) => {
    const body = z
      .object({ agent_id: z.string().min(1), text: z.string().trim().min(1).max(8000), thread_id: z.string().regex(/^cht_[a-z0-9]+$/).nullish(), project_id: z.string().nullish() })
      .parse(await c.req.json());
    const { job, thread_id } = hub.chat(body);
    return c.json({ job, thread_id }, 201);
  });
  api.get("/chat/threads", (c) => {
    const agentId = c.req.query("agent_id");
    if (!agentId) throw new HttpError(400, "agent_id is required");
    const rows = db
      .select({ input: jobs.input, title: jobs.title, created_at: jobs.created_at })
      .from(jobs)
      .where(and(eq(jobs.agent_id, agentId), eq(jobs.type, "chat")))
      .orderBy(desc(jobs.created_at))
      .limit(500)
      .all();
    const threads = new Map<string, { thread_id: string; title: string; last_at: string; first_at: string; messages: number }>();
    for (const r of rows) {
      const id = typeof r.input.thread_id === "string" ? r.input.thread_id : null;
      if (!id) continue;
      const t = threads.get(id);
      if (t) {
        t.messages++;
        t.first_at = r.created_at;
        t.title = r.title;
      } else threads.set(id, { thread_id: id, title: r.title, last_at: r.created_at, first_at: r.created_at, messages: 1 });
    }
    return c.json({ threads: [...threads.values()].slice(0, 50) });
  });
  api.get("/chat/threads/:id", (c) => {
    const rows = hub.chatJobs(c.req.param("id"));
    return c.json({
      messages: rows.map((j) => ({
        job_id: j.id,
        agent_id: j.agent_id,
        text: String(j.input.text ?? j.title),
        created_at: j.created_at,
        status: j.status,
        run_id: hub.store.state.jobs[j.id]?.run_ids.at(-1) ?? null,
        reply: hub.chatReply(j),
      })),
    });
  });

  // schedules
  const getSchedule = (id: string) => {
    const row = db.select().from(schedules).where(eq(schedules.id, id)).get();
    if (!row) throw new HttpError(404, "schedule not found");
    return row;
  };
  api.get("/schedules", (c) => {
    const agentId = c.req.query("agent_id");
    const q = db.select().from(schedules);
    const rows = (agentId ? q.where(eq(schedules.agent_id, agentId)) : q).all();
    return c.json({ schedules: rows.map((r) => scheduler.toSchedule(r)) });
  });
  api.post("/schedules", async (c) => {
    const data = ScheduleInput.parse(await c.req.json());
    if (!getAgent(db, data.agent_id)) throw new HttpError(400, "unknown agent");
    assertValidCron(data.cron);
    const row = db.insert(schedules).values({ ...data, id: newId("sch") }).returning().get();
    scheduler.reload();
    return c.json({ schedule: scheduler.toSchedule(row) }, 201);
  });
  api.patch("/schedules/:id", async (c) => {
    const id = c.req.param("id");
    getSchedule(id);
    const raw = z.record(z.string(), z.unknown()).parse(await c.req.json());
    const patch = ScheduleInput.omit({ agent_id: true }).partial().parse(raw);
    const changes = Object.fromEntries(Object.entries(patch).filter(([k]) => k in raw));
    if (typeof changes.cron === "string") assertValidCron(changes.cron);
    const row = db.update(schedules).set(changes).where(eq(schedules.id, id)).returning().get();
    scheduler.reload();
    return c.json({ schedule: scheduler.toSchedule(row!) });
  });
  api.delete("/schedules/:id", (c) => {
    const id = c.req.param("id");
    getSchedule(id);
    db.delete(schedules).where(eq(schedules.id, id)).run();
    scheduler.reload();
    return c.json({ ok: true });
  });
  api.post("/schedules/:id/run-now", (c) => {
    getSchedule(c.req.param("id"));
    const jobId = scheduler.fire(c.req.param("id"), { force: true });
    if (!jobId) throw new HttpError(409, "could not start: the agent is disabled");
    return c.json({ job_id: jobId });
  });

  // run artifacts (screenshots, reports) uploaded by runners
  api.get("/artifacts/:runId/:name", async (c) => {
    const { runId, name } = c.req.param();
    if (!ARTIFACT_NAME.test(name) || !/^[a-z0-9_]+$/.test(runId)) throw new HttpError(400, "invalid path");
    const ext = name.split(".").pop()!.toLowerCase();
    const type = ARTIFACT_TYPES[ext];
    if (!type) throw new HttpError(404, "not found");
    const data = await hub.storage.get(`artifacts/${runId}/${name}`);
    if (!data) throw new HttpError(404, "not found");
    return new Response(data, {
      headers: {
        // Only inert types are served (see ARTIFACT_TYPES): markdown and text render as plain text, never as a page.
        "content-type": type,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; img-src 'self'",
        "cache-control": "private, max-age=3600",
      },
    });
  });

  // office view art: Tiled map, tileset and sprite atlases from MAPS_DIR (swappable without a rebuild)
  api.get("/office/assets/:name", async (c) => {
    const name = c.req.param("name");
    if (!OFFICE_ASSET_NAME.test(name)) throw new HttpError(400, "invalid asset name");
    const type = OFFICE_ASSET_TYPES[name.split(".").pop()!.toLowerCase()]!;
    const file = Bun.file(join(config.mapsDir, name));
    if (!(await file.exists())) throw new HttpError(404, "not found");
    return new Response(file, {
      headers: { "content-type": type, "x-content-type-options": "nosniff", "cache-control": "private, no-cache" },
    });
  });

  // tools catalog (for the agent editor)
  api.get("/tools", (c) =>
    c.json({
      tools: Object.values(TOOL_REGISTRY).map((t) => ({ name: t.name, description: t.description, category: t.category })),
    }),
  );

  // approvals
  api.get("/approvals", (c) => {
    const status = z.enum(["pending", "approved", "rejected", "expired", "all"]).catch("pending").parse(c.req.query("status"));
    const q = db.select().from(approvals);
    const rows = (status === "all" ? q : q.where(eq(approvals.status, status))).orderBy(desc(approvals.created_at)).limit(200).all();
    return c.json({ approvals: rows });
  });
  api.post("/approvals/:id/decide", async (c) => {
    const { decision } = z.object({ decision: z.enum(["approved", "rejected"]) }).parse(await c.req.json());
    hub.decideApproval(c.req.param("id"), decision, "web");
    return c.json({ ok: true });
  });

  // jobs
  api.get("/jobs", (c) => {
    const limit = intParam(c.req.query("limit"), 100, 500);
    const rows = db.select().from(jobs).orderBy(desc(jobs.created_at)).limit(limit).all();
    return c.json({ jobs: rows.map(toJob) });
  });
  api.post("/jobs", async (c) => {
    const job = hub.createJob(JobInput.parse(await c.req.json()));
    return c.json({ job }, 201);
  });
  api.post("/jobs/:id/cancel", (c) => {
    hub.cancelJob(c.req.param("id"));
    return c.json({ ok: true });
  });

  // runs
  api.get("/runs", (c) => {
    const jobId = c.req.query("job_id");
    const limit = intParam(c.req.query("limit"), 100, 500);
    const q = db.select().from(runs);
    const rows = (jobId ? q.where(eq(runs.job_id, jobId)) : q).orderBy(desc(runs.started_at)).limit(limit).all();
    return c.json({ runs: rows.map(toRun) });
  });
  api.get("/runs/:id", (c) => {
    const run = getRun(db, c.req.param("id"));
    if (!run) throw new HttpError(404, "run not found");
    return c.json({ run: toRun(run), events: store.list(0, 5000, run.id) });
  });
  api.post("/runs/:id/cancel", (c) => {
    hub.cancelRun(c.req.param("id"));
    return c.json({ ok: true });
  });

  // runners
  api.get("/runners", (c) => c.json({ runners: db.select().from(runners).orderBy(runners.created_at).all().map(toRunner) }));
  api.post("/runners/pairing-code", (c) => {
    const code = pairingCode();
    const expires = new Date(Date.now() + PAIRING_TTL_MS).toISOString();
    db.delete(pairingCodes).where(lt(pairingCodes.expires_at, new Date().toISOString())).run();
    db.insert(pairingCodes).values({ code_hash: hashToken(normalizeCode(code)), expires_at: expires }).run();
    return c.json({ code, expires_at: expires });
  });
  api.post("/runners/:id/revoke", (c) => {
    const id = c.req.param("id");
    if (!getRunner(db, id)) throw new HttpError(404, "runner not found");
    // A random hash nobody has the token for; keeps run history (FKs) intact.
    db.update(runners).set({ token_hash: `revoked:${randomToken(16)}` }).where(eq(runners.id, id)).run();
    const conn = hub.conns.get(id);
    if (conn) {
      conn.close(4003, "revoked");
      hub.runnerDisconnected(conn);
    }
    return c.json({ ok: true });
  });

  // providers
  api.get("/providers/presets", (c) => c.json({ presets: PROVIDER_PRESETS }));
  api.get("/providers", (c) =>
    c.json({ providers: db.select().from(providers).orderBy(providers.created_at).all().map(toProviderPublic) }),
  );
  api.post("/providers", async (c) => {
    const data = ProviderInput.parse(await c.req.json());
    if (getProviderBySlug(db, data.slug)) throw new HttpError(409, "slug already used");
    if (data.kind === "openai_compatible" && !data.base_url) throw new HttpError(400, "base_url is required for OpenAI-compatible providers");
    const { api_key, ...rest } = data;
    const row = db
      .insert(providers)
      .values({
        ...rest,
        id: newId("prv"),
        api_key_enc: api_key ? secrets.encrypt(api_key) : null,
        api_key_hint: api_key ? keyHint(api_key) : null,
      })
      .returning()
      .get();
    return c.json({ provider: toProviderPublic(row) }, 201);
  });
  api.patch("/providers/:id", async (c) => {
    const id = c.req.param("id");
    const existing = db.select().from(providers).where(eq(providers.id, id)).get();
    if (!existing) throw new HttpError(404, "provider not found");
    const raw = z.record(z.string(), z.unknown()).parse(await c.req.json());
    const patch = ProviderInput.omit({ slug: true }).partial().parse(raw);
    const changes: Partial<typeof providers.$inferInsert> = {};
    for (const k of ["name", "kind", "base_url", "models", "pricing", "enabled"] as const) {
      if (k in raw) (changes as Record<string, unknown>)[k] = patch[k];
    }
    if (typeof patch.api_key === "string") {
      changes.api_key_enc = patch.api_key ? secrets.encrypt(patch.api_key) : null;
      changes.api_key_hint = patch.api_key ? keyHint(patch.api_key) : null;
    }
    const row = db.update(providers).set(changes).where(eq(providers.id, id)).returning().get();
    return c.json({ provider: toProviderPublic(row!) });
  });
  api.delete("/providers/:id", (c) => {
    const id = c.req.param("id");
    const existing = db.select().from(providers).where(eq(providers.id, id)).get();
    if (!existing) throw new HttpError(404, "provider not found");
    if (db.select({ id: agents.id }).from(agents).where(eq(agents.provider, existing.slug)).get()) {
      throw new HttpError(409, "provider is used by an agent; switch those agents first");
    }
    db.delete(providers).where(eq(providers.id, id)).run();
    return c.json({ ok: true });
  });

  app.route("/api", api);
  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  // ------------------------------------------------------------ web app (production build)

  if (existsSync(join(config.webDistDir, "index.html"))) {
    const root = config.webDistDir;
    app.use("/*", serveStatic({ root }));
    app.get("*", serveStatic({ path: join(root, "index.html") }));
  } else {
    app.get("/", (c) =>
      c.text("Agent Office hub is running. Web UI not built: run `bun run dev` (Vite on :5180) or `bun run build`."),
    );
  }

  return app;
}

