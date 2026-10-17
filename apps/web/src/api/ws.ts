import { HubToWeb, parseMessage, type AgentEvent, type OfficeState } from "@agent-office/shared";

export interface StreamHandlers {
  snapshot(state: OfficeState): void;
  events(events: AgentEvent[]): void;
  status(connected: boolean): void;
  /** Called when the hub refuses the socket (likely logged out). */
  unauthorized(): void;
}

/**
 * Same-origin WebSocket to the hub. On reconnect it resumes from the last
 * applied event id, so nothing is missed and nothing is applied twice.
 */
export function connectEventStream(lastEventId: () => number, h: StreamHandlers): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let backoff = 500;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;
  let opened = false;

  const open = () => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const since = lastEventId();
    ws = new WebSocket(`${proto}//${location.host}/ws/web${since > 0 ? `?since=${since}` : ""}`);
    opened = false;
    ws.onopen = () => {
      opened = true;
      backoff = 500;
      h.status(true);
      ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "ping" })), 25_000);
    };
    ws.onmessage = (e) => {
      const msg = parseMessage(HubToWeb, String(e.data));
      if (!msg) return console.warn("[ws] invalid message", e.data);
      if (msg.type === "snapshot") h.snapshot(msg.state);
      else if (msg.type === "events") h.events(msg.events);
      else if (msg.type === "event") h.events([msg.event]);
    };
    ws.onclose = async () => {
      if (ping) clearInterval(ping);
      h.status(false);
      if (stopped) return;
      if (!opened) {
        // Upgrade refused: check whether we are still logged in before retrying.
        const res = await fetch("/api/auth/me", { credentials: "same-origin" }).catch(() => null);
        if (res?.status === 401) return h.unauthorized();
      }
      timer = setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, 15_000);
    };
  };

  open();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (ping) clearInterval(ping);
    ws?.close();
  };
}
