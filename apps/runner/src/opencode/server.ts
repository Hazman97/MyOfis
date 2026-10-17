import { freshFetch } from "@agent-office/shared";
import { killTree } from "./binary.ts";

/** One SSE event from OpenCode's `GET /event` bus. */
export interface OcEvent {
  type: string;
  properties: Record<string, unknown> & { sessionID?: string };
}

async function freePort(): Promise<number> {
  const s = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = s.port;
  s.stop(true);
  return port;
}

/** Keep only the tail of a stream (and keep draining it, so the child never blocks on a full pipe). */
function drain(stream: ReadableStream<Uint8Array> | null, keep = 8000): () => string {
  let tail = "";
  if (stream) {
    void (async () => {
      const dec = new TextDecoder();
      try {
        for await (const chunk of stream) tail = (tail + dec.decode(chunk)).slice(-keep);
      } catch {
        /* process ended */
      }
    })();
  }
  return () => tail;
}

/**
 * A private `opencode serve` for one run: random port on 127.0.0.1, random
 * basic-auth password, stdout/stderr drained, whole process tree killed on stop.
 */
export class OpenCodeServer {
  private constructor(
    readonly baseUrl: string,
    private readonly authHeader: string,
    private readonly proc: ReturnType<typeof Bun.spawn>,
    private readonly stderrTail: () => string,
  ) {}

  static async start(opts: { binary: string; cwd: string; env: Record<string, string>; timeoutMs?: number }): Promise<OpenCodeServer> {
    const port = await freePort();
    const password = crypto.randomUUID() + crypto.randomUUID();
    const proc = Bun.spawn([opts.binary, "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: opts.cwd,
      env: { ...opts.env, OPENCODE_SERVER_PASSWORD: password },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      // POSIX: own process group so killTree can stop children too.
      ...(process.platform === "win32" ? {} : { detached: true }),
    } as Parameters<typeof Bun.spawn>[1]);
    drain(proc.stdout as ReadableStream<Uint8Array>);
    const stderrTail = drain(proc.stderr as ReadableStream<Uint8Array>);
    const server = new OpenCodeServer(`http://127.0.0.1:${port}`, `Basic ${btoa(`opencode:${password}`)}`, proc, stderrTail);

    // Generous: the very first start fetches the provider package and model catalog.
    const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
    for (;;) {
      if (proc.exitCode !== null) throw new Error(`OpenCode exited during start (code ${proc.exitCode}): ${stderrTail().slice(-800)}`);
      try {
        const r = await freshFetch(`${server.baseUrl}/doc`, { headers: { authorization: server.authHeader }, timeoutMs: 5_000 });
        if (r.ok) break;
      } catch {
        /* not listening yet */
      }
      if (Date.now() > deadline) {
        await server.stop();
        throw new Error(`OpenCode did not start within ${(opts.timeoutMs ?? 120_000) / 1000}s: ${stderrTail().slice(-800)}`);
      }
      await Bun.sleep(300);
    }
    return server;
  }

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    // Fresh connection: a permission reply can come minutes after the previous call.
    const res = await freshFetch(`${this.baseUrl}${path}`, {
      timeoutMs: 60_000,
      method,
      headers: { authorization: this.authHeader, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`OpenCode ${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
    return (text ? JSON.parse(text) : null) as T;
  }

  /** Server-sent events until `signal` aborts or the server goes away. */
  async *events(signal: AbortSignal): AsyncGenerator<OcEvent> {
    const res = await freshFetch(`${this.baseUrl}/event`, { headers: { authorization: this.authHeader }, signal });
    if (!res.ok || !res.body) throw new Error(`OpenCode event stream -> ${res.status}`);
    const dec = new TextDecoder();
    let buf = "";
    try {
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const data = frame
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n");
          if (!data) continue;
          try {
            yield JSON.parse(data) as OcEvent;
          } catch {
            /* ignore malformed frame */
          }
        }
      }
    } catch (err) {
      if (!signal.aborted) throw err;
    }
  }

  stderr(): string {
    return this.stderrTail();
  }

  /** Kill the process tree and wait (max 5 s) until it has really exited, so its folder is released (Windows). */
  async stop(): Promise<void> {
    if (this.proc.exitCode !== null) return;
    killTree(this.proc.pid);
    await Promise.race([this.proc.exited, Bun.sleep(5_000)]);
  }
}
