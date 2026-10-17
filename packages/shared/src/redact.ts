/**
 * Best-effort masking of things that look like credentials before they are
 * written to events or logs. Not a security boundary on its own — secrets
 * should never reach this point — but it stops accidental leaks.
 */
const PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g, // Anthropic
  /sk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{20,}/g, // OpenAI / OpenRouter style
  /gsk_[A-Za-z0-9]{20,}/g, // Groq
  /AIza[0-9A-Za-z_-]{30,}/g, // Google API key
  /gh[pousr]_[A-Za-z0-9]{30,}/g, // GitHub
  /xox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g, // Telegram bot token
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(Bearer|token|api[_-]?key|password|secret)(["'\s:=]+)([A-Za-z0-9._~+/=-]{12,})/gi,
];

export const REDACTED = "[REDACTED]";

export function redactString(input: string): string {
  let out = input;
  for (const re of PATTERNS) {
    out = out.replace(re, (...m: string[]) => {
      // keyword-style pattern keeps the keyword and separator
      if (m.length > 4 && typeof m[1] === "string" && typeof m[2] === "string" && /^[A-Za-z]/.test(m[1])) {
        return `${m[1]}${m[2]}${REDACTED}`;
      }
      return REDACTED;
    });
  }
  return out;
}

/** Deeply redacts every string inside a JSON-like value. */
export function redact<T>(value: T): T {
  if (typeof value === "string") return redactString(value) as T;
  if (Array.isArray(value)) return value.map((v) => redact(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v);
    return out as T;
  }
  return value;
}
