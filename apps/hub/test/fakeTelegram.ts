/** In-memory stand-in for the Telegram Bot API (the methods TelegramBot uses). */
export interface FakeTelegram {
  url: string;
  token: string;
  sent: { method: string; body: Record<string, unknown> }[];
  /** Queue an update; the next getUpdates returns it. */
  push(update: Record<string, unknown>): void;
  stop(): void;
}

export function startFakeTelegram(token = "123456:fake-telegram-token-abcdefghij"): FakeTelegram {
  const queue: Record<string, unknown>[] = [];
  const sent: FakeTelegram["sent"] = [];
  let nextUpdate = 1;
  let nextMessage = 100;
  const waiters: (() => void)[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const file = new URL(req.url).pathname.match(/^\/file\/bot([^/]+)\/(.+)$/);
      if (file && file[1] === token) return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
      const m = new URL(req.url).pathname.match(/^\/bot([^/]+)\/(\w+)$/);
      if (!m || m[1] !== token) return Response.json({ ok: false, description: "Unauthorized" }, { status: 401 });
      const method = m[2]!;
      // sendVideo is multipart: files are recorded as their size
      const body: Record<string, unknown> = (req.headers.get("content-type") ?? "").startsWith("multipart/")
        ? Object.fromEntries([...(await req.formData()).entries()].map(([k, v]) => [k, typeof v === "string" ? v : { size: v.size }]))
        : ((await req.json().catch(() => ({}))) as Record<string, unknown>);
      if (method === "getUpdates") {
        const offset = Number(body.offset ?? 0);
        const ready = () => queue.filter((u) => Number(u.update_id) >= offset);
        if (!ready().length) await Promise.race([new Promise<void>((r) => waiters.push(r)), Bun.sleep(500)]);
        return Response.json({ ok: true, result: ready() });
      }
      sent.push({ method, body });
      if (method === "sendMessage") return Response.json({ ok: true, result: { message_id: nextMessage++, chat: { id: Number(body.chat_id) } } });
      if (method === "getFile") return Response.json({ ok: true, result: { file_id: body.file_id, file_path: `photos/${String(body.file_id)}.jpg` } });
      return Response.json({ ok: true, result: true });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    token,
    sent,
    push(update) {
      queue.push({ update_id: nextUpdate++, ...update });
      for (const w of waiters.splice(0)) w();
    },
    stop: () => void server.stop(true),
  };
}
