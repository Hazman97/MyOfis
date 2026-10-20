import { TIMEZONE } from "@agent-office/shared";

// 24-hour clock for logs: fixed width, never wraps.
const time = new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const dateTime = new Intl.DateTimeFormat("en-MY", {
  timeZone: TIMEZONE,
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export const fmtTime = (iso: string) => time.format(new Date(iso));
export const fmtDateTime = (iso: string) => dateTime.format(new Date(iso));

export const fmtUsd = (n: number) => (n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

export const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function fmtDuration(startIso: string, endIso: string | null): string {
  const ms = (endIso ? new Date(endIso).getTime() : Date.now()) - new Date(startIso).getTime();
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago" (the work feed). */
export function fmtAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

/** "512 KB", "3.4 MB", "1.2 GB" (videos under 1 MB showed as "0 MB"). */
export function fmtBytes(n: number): string {
  if (n < 1024 ** 2) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${Math.round((n / 1024 ** 2) * 10) / 10} MB`;
  return `${Math.round((n / 1024 ** 3) * 100) / 100} GB`;
}
