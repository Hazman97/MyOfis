import type { Server, ServerWebSocket } from "bun";
import { eq } from "drizzle-orm";
import { HubToWeb, PROTOCOL_VERSION, RunnerToHub, WebToHub, parseMessage, type HubToRunner } from "@agent-office/shared";
import { createAuthenticator } from "./auth.ts";
import { Content } from "./content.ts";
import { Learning } from "./learning.ts";
import { Hub, TIMINGS, type RunnerConn } from "./core.ts";
import { Secrets, hashToken } from "./crypto.ts";
import { openDb } from "./db/client.ts";
import { runners } from "./db/schema.ts";
import type { HubConfig } from "./env.ts";
import { EventStore } from "./events.ts";
import { createHttpApp } from "./http.ts";
import { Integrations } from "./integrations.ts";
import { ReleaseWatcher } from "./releases.ts";
import { TelegramBot } from "./telegram.ts";
import { Backups } from "./backup.ts";
import { UploadParts } from "./uploads.ts";
import { Publisher } from "./publisher.ts";
import { Social } from "./social.ts";
import { Scheduler } from "./scheduler.ts";
import { seed } from "./seed.ts";
import { LocalStorage } from "./storage.ts";

type RunnerSocketData = { kind: "runner"; runnerId: string; name: string; conn: RunnerConn | null };
type WebSocketData = { kind: "web"; since: number | null; unsubscribe: (() => void) | null };
type SocketData = RunnerSocketData | WebSocketData;

const HELLO_TIMEOUT_MS = 10_000;
const RESUME_BATCH = 500;

export interface HubServer {
  url: string;
  port: number;
  hub: Hub;
  scheduler: Scheduler;
  releases: ReleaseWatcher;
  telegram: TelegramBot;
  stop(): Promise<void>;
}

export function startHub(
  config: HubConfig,
  opts: { timings?: Partial<typeof TIMINGS>; sweepMs?: number; releasePollMs?: number; backupCheckMs?: number } = {},
): HubServer {
  const { db, sqlite } = openDb(config.databasePath);
  const secrets = new Secrets(config.secretsKey);
  const storage = new LocalStorage(config.filesDir);
  const store = new EventStore(db, storage);
  const hub = new Hub(config, db, store, secrets, { ...TIMINGS, ...opts.timings });
  const auth = createAuthenticator(config, secrets);

  seed(db, config, secrets);
  const integrations = new Integrations(db, secrets);
  integrations.seedFromEnv(config.seed.giteaUrl, config.seed.giteaToken);
  integrations.seedTelegramFromEnv(config.seed.telegramToken, config.seed.telegramChatId);
  hub.integrations = integrations;
  hub.storage = storage;
  hub.content = new Content(db, store, config.projectsDir);
  hub.learning = new Learning(db, store, config.skillsDir);
  hub.publisher = new Publisher(db, store, secrets, config.filesDir);
  hub.uploadParts = new UploadParts(hub.publisher, config.filesDir);
  hub.social = new Social(db, store, secrets, hub.publisher, config.facebookGraphBase, config.threadsGraphBase);
  hub.backups = new Backups(sqlite, { ...config.backup, projectsDir: config.projectsDir, skillsDir: config.skillsDir });
  hub.boot();
  hub.backfillIndex();
  const scheduler = new Scheduler(hub);
  scheduler.start();
  const releases = new ReleaseWatcher(hub, integrations, opts.releasePollMs);
  releases.start();
  const telegram = new TelegramBot(hub, integrations, config.telegramApiBase, config.secretsKey);
  telegram.start();
  const app = createHttpApp(hub, auth, scheduler, integrations, telegram);

  const sendWeb = (ws: ServerWebSocket<SocketData>, msg: HubToWeb) => ws.send(JSON.stringify(msg));

  const server: Server<SocketData> = Bun.serve<SocketData>({
    hostname: config.host,
    port: config.port,
    async fetch(req, srv) {
      const url = new URL(req.url);

      if (url.pathname === "/ws/runner") {
        const header = req.headers.get("authorization") ?? "";
        const token = header.startsWith("Bearer ") ? header.slice(7) : "";
        const row = token
          ? db.select().from(runners).where(eq(runners.token_hash, hashToken(token))).get()
          : undefined;
        if (!row) return new Response("unauthorized", { status: 401 });
        if (srv.upgrade(req, { data: { kind: "runner", runnerId: row.id, name: row.name, conn: null } })) return;
        return new Response("upgrade failed", { status: 400 });
      }

      if (url.pathname === "/ws/web") {
        if (!(await auth.isOwner(req))) return new Response("unauthorized", { status: 401 });
        const sinceRaw = url.searchParams.get("since");
        const since = sinceRaw !== null && /^\d+$/.test(sinceRaw) ? Number(sinceRaw) : null;
        if (srv.upgrade(req, { data: { kind: "web", since, unsubscribe: null } })) return;
        return new Response("upgrade failed", { status: 400 });
      }

      return app.fetch(req, { server: srv });
    },
    websocket: {
      idleTimeout: 60,
      open(ws) {
        const d = ws.data;
        if (d.kind === "web") {
          if (d.since === null || d.since > store.state.last_event_id) {
            sendWeb(ws, { type: "snapshot", state: store.state, last_event_id: store.state.last_event_id });
          } else {
            // Resume / replay: everything after `since`, in batches. Synchronous, so no live event can interleave.
            let after = d.since;
            for (;;) {
              const batch = store.list(after, RESUME_BATCH);
              if (batch.length) sendWeb(ws, { type: "events", events: batch });
              if (batch.length < RESUME_BATCH) break;
              after = batch[batch.length - 1]!.id;
            }
          }
          d.unsubscribe = store.subscribe((event) => sendWeb(ws, { type: "event", event }));
          return;
        }
        setTimeout(() => {
          if (d.kind === "runner" && !d.conn && ws.readyState === 1) ws.close(4002, "no hello received");
        }, HELLO_TIMEOUT_MS);
      },
      message(ws, raw) {
        const d = ws.data;
        if (d.kind === "web") {
          const msg = parseMessage(WebToHub, raw);
          if (msg?.type === "ping") sendWeb(ws, { type: "pong" });
          return;
        }
        const msg = parseMessage(RunnerToHub, raw);
        if (!msg) {
          console.warn(`[hub] dropped invalid message from runner ${d.name}`);
          ws.send(JSON.stringify({ type: "error", message: "invalid message" } satisfies HubToRunner));
          return;
        }
        if (!d.conn) {
          if (msg.type !== "hello") return void ws.close(4002, "expected hello");
          if (msg.protocol !== PROTOCOL_VERSION) return void ws.close(4004, `protocol ${PROTOCOL_VERSION} required`);
          d.conn = {
            runnerId: d.runnerId,
            name: msg.name,
            maxRuns: msg.capabilities.max_concurrent_runs,
            lastSeen: Date.now(),
            send: (m) => ws.send(JSON.stringify(m)),
            close: (code, reason) => ws.close(code, reason),
          };
          hub.runnerConnected(d.conn, msg);
          return;
        }
        // A replaced or revoked connection may still deliver buffered frames: ignore them.
        if (hub.conns.get(d.runnerId) !== d.conn) return;
        try {
          hub.runnerMessage(d.conn, msg);
        } catch (err) {
          console.error("[hub] failed to handle runner message", err);
        }
      },
      close(ws) {
        const d = ws.data;
        if (d.kind === "web") d.unsubscribe?.();
        else if (d.conn) hub.runnerDisconnected(d.conn);
      },
    },
  });

  const sweep = setInterval(() => hub.sweep(), opts.sweepMs ?? 5_000);
  // nightly backup: checked every 10 minutes, runs once a day after BACKUP_HOUR
  const backupTimer = setInterval(() => {
    if (!hub.backups.due()) return;
    try {
      const b = hub.backups.run();
      console.log(`[hub] backup ${b.date} written (${Math.round(b.size_bytes / 1024)} KB)`);
    } catch (err) {
      console.error(`[hub] backup failed: ${(err as Error).message}`);
      telegram.notify(`⚠️ Nightly backup failed: ${(err as Error).message}`).catch(() => {});
    }
  }, opts.backupCheckMs ?? 10 * 60_000);

  return {
    url: `http://${config.host}:${server.port}`,
    port: server.port ?? config.port,
    hub,
    scheduler,
    releases,
    telegram,
    async stop() {
      clearInterval(sweep);
      clearInterval(backupTimer);
      scheduler.stop();
      releases.stop();
      telegram.stop();
      hub.shutdown();
      // Bun 1.3.x: stop(true) never resolves once the server itself has closed a WebSocket
      // (revoke / heartbeat timeout). Connections are closed regardless, so cap the wait.
      await Promise.race([server.stop(true), Bun.sleep(500)]);
      await store.flushLogs();
      sqlite.close();
    },
  };
}
