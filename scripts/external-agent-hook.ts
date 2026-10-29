#!/usr/bin/env bun
/**
 * Claude Code hook reporter for MyOfis (Agent Office).
 *
 * Reads a Claude Code hook JSON payload from stdin (SessionStart, PreToolUse,
 * PostToolUse, PostToolUseFailure, Stop, SessionEnd) and POSTs a sanitized
 * activity event to `$MYOFIS_URL/api/external/activity` with
 * `Authorization: Bearer $MYOFIS_EXTERNAL_TOKEN`.
 *
 * Safety & reliability rules:
 * - Never blocks or fails the worker: 2 s timeout, swallows all errors, exits 0.
 * - Never sends file contents, command outputs, query strings, or secrets.
 */

export interface ExternalActivityPayload {
  session_id: string;
  event: "start" | "thinking" | "tool" | "tool_result" | "done" | "failed";
  title?: string;
  tool?: string;
  input_summary?: string;
  ok?: boolean;
  summary?: string;
  output?: string;
}

const SECRET_RE =
  /\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AIza[0-9A-Za-z_-]{12,}|Bearer\s+\S+|[A-Za-z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|PASS|AUTH|COOKIE)[A-Za-z0-9_]*\s*=\s*\S+)/gi;

export function redactSafe(text: string, maxLen = 120): string {
  return text
    .replace(SECRET_RE, "[REDACTED]")
    .replace(/https?:\/\/[^/\s:@]+:[^/\s@]+@/gi, "https://[REDACTED]@")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

/** Keep at most the last 3 path segments so workspace paths stay readable and compact. */
export function shortPath(rawPath: string): string {
  const clean = rawPath.replace(/\\/g, "/").replace(/\/+$/, "").trim();
  if (!clean) return "";
  const parts = clean.split("/").filter(Boolean);
  return redactSafe(parts.slice(-3).join("/"), 120);
}

/** Summarize a command by its binary + safe subcommand/flags, stripping env vars and inline secrets. */
function shortCommand(rawCmd: string): string {
  const firstLine = rawCmd.trim().split(/\r?\n/)[0]?.trim() ?? "";
  if (!firstLine) return "";
  // Strip leading FOO=bar env assignments
  const withoutEnv = firstLine.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)+/, "");
  const tokens = withoutEnv.split(/\s+/).filter(Boolean);
  if (!tokens.length) return "command";
  const safeTokens: string[] = [];
  for (const tok of tokens.slice(0, 4)) {
    if (SECRET_RE.test(tok) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) {
      SECRET_RE.lastIndex = 0;
      safeTokens.push("[REDACTED]");
    } else if (/^https?:\/\//i.test(tok)) {
      try {
        const u = new URL(tok);
        safeTokens.push(`${u.host}${u.pathname}`);
      } catch {
        safeTokens.push("[url]");
      }
    } else {
      safeTokens.push(tok);
    }
  }
  return redactSafe(safeTokens.join(" "), 120);
}

/**
 * Produce a short, safe summary of a tool's input (file path or command name).
 * Never reads `content`, `new_string`, `old_string`, `patch`, `edits`, or raw bodies.
 */
export function summarizeToolInput(toolName: string, toolInput: unknown): string {
  if (!toolInput || typeof toolInput !== "object") return "";
  const inp = toolInput as Record<string, unknown>;

  for (const key of ["file_path", "path", "notebook_path", "target_file"]) {
    if (typeof inp[key] === "string" && inp[key].trim()) {
      return shortPath(inp[key]);
    }
  }

  if (typeof inp.command === "string" && inp.command.trim()) {
    return shortCommand(inp.command);
  }
  if (typeof inp.cmd === "string" && inp.cmd.trim()) {
    return shortCommand(inp.cmd);
  }

  if (typeof inp.url === "string" && inp.url.trim()) {
    try {
      const u = new URL(inp.url);
      return redactSafe(`${u.host}${u.pathname}`, 120);
    } catch {
      return "url";
    }
  }

  for (const key of ["pattern", "query", "glob", "description"]) {
    if (typeof inp[key] === "string" && inp[key].trim()) {
      return redactSafe(inp[key], 100);
    }
  }

  return redactSafe(toolName, 60);
}

function isToolError(hookEvent: string, response: unknown): boolean {
  if (hookEvent === "PostToolUseFailure") return true;
  if (!response || typeof response !== "object") return false;
  const r = response as Record<string, unknown>;
  if (r.is_error === true || r.ok === false || r.success === false) return true;
  if (typeof r.exit_code === "number" && r.exit_code !== 0) return true;
  if (typeof r.exitCode === "number" && r.exitCode !== 0) return true;
  if (typeof r.error === "string" && r.error.trim().length > 0) return true;
  return false;
}

/**
 * Map a Claude Code hook stdin JSON object to a MyOfis ExternalActivityPayload,
 * or null if the hook event is unrecognized or missing `session_id`.
 */
export function mapHookPayload(raw: unknown): ExternalActivityPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const sessionId = typeof data.session_id === "string" ? data.session_id.trim().slice(0, 120) : "";
  if (!sessionId) return null;

  const eventName = typeof data.hook_event_name === "string" ? data.hook_event_name.trim() : "";

  switch (eventName) {
    case "SessionStart": {
      const cwd = typeof data.cwd === "string" ? shortPath(data.cwd) : "";
      const customTitle = typeof data.title === "string" ? redactSafe(data.title, 140) : "";
      const title = customTitle || (cwd ? `Claude Code · ${cwd}` : "Claude Code session");
      return {
        session_id: sessionId,
        event: "start",
        title: title.slice(0, 200),
      };
    }

    case "UserPromptSubmit": {
      return {
        session_id: sessionId,
        event: "thinking",
        summary: "Planning next step…",
      };
    }

    case "PreToolUse": {
      const tool = typeof data.tool_name === "string" && data.tool_name.trim() ? data.tool_name.trim().slice(0, 80) : "tool";
      const inputSummary = summarizeToolInput(tool, data.tool_input);
      return {
        session_id: sessionId,
        event: "tool",
        tool,
        ...(inputSummary ? { input_summary: inputSummary } : {}),
      };
    }

    case "PostToolUse":
    case "PostToolUseFailure": {
      const tool = typeof data.tool_name === "string" && data.tool_name.trim() ? data.tool_name.trim().slice(0, 80) : "tool";
      const failed = isToolError(eventName, data.tool_response ?? data.tool_result);
      const target = summarizeToolInput(tool, data.tool_input);
      const label = target && target !== tool ? `${tool} ${target}` : tool;
      return {
        session_id: sessionId,
        event: "tool_result",
        tool,
        ok: !failed,
        summary: `${label} (${failed ? "failed" : "ok"})`.slice(0, 200),
      };
    }

    case "Stop":
    case "SessionEnd": {
      const hasError = typeof data.error === "string" && data.error.trim().length > 0;
      if (hasError) {
        return {
          session_id: sessionId,
          event: "failed",
          summary: redactSafe(String(data.error), 200),
        };
      }
      return {
        session_id: sessionId,
        event: "done",
        output: "Session finished",
      };
    }

    default:
      return null;
  }
}

export async function sendActivity(
  payload: ExternalActivityPayload,
  opts: {
    url?: string;
    token?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<boolean> {
  const baseUrl = (opts.url ?? process.env.MYOFIS_URL ?? "http://127.0.0.1:8788").replace(/\/+$/, "");
  const token = (opts.token ?? process.env.MYOFIS_EXTERNAL_TOKEN ?? "").trim();
  if (!token) return false;
  const fetchFn = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 2000;
  try {
    const res = await fetchFn(`${baseUrl}/api/external/activity`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  try {
    const rawText = await Bun.stdin.text();
    if (!rawText.trim()) return;
    const parsed = JSON.parse(rawText);
    const payload = mapHookPayload(parsed);
    if (!payload) return;
    await sendActivity(payload);
  } catch {
    // Never block or fail the worker
  }
}

if (import.meta.main) {
  await main();
  process.exit(0);
}

