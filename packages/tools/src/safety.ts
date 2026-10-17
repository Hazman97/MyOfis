import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { PermissionLevel, RiskLevel } from "@agent-office/shared";
import { ToolDenied } from "./types.ts";

// ---------------------------------------------------------------- secrets

const SECRET_FILE_PATTERNS: RegExp[] = [
  /^\.env(\..*)?$/i, // .env, .env.local, .env.production ...
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /^id_[a-z0-9]+(\.pub)?$/i, // id_rsa, id_ed25519 ...
  /^credentials(\..*)?$/i,
  /^\.git-credentials$/i,
  /^\.netrc$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^runner-state\.json$/i, // the runner's own hub token
  /\.(db|sqlite|sqlite3)(-wal|-shm)?$/i, // hub database
];
const SECRET_DIRS = new Set([".ssh", ".aws", ".gnupg", ".azure", ".kube", ".docker"]);

/** True if any segment of the path looks like a secret file or secret directory. */
export function isSecretPath(p: string): boolean {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  if (parts.some((s) => SECRET_DIRS.has(s.toLowerCase()))) return true;
  const name = basename(p);
  return SECRET_FILE_PATTERNS.some((re) => re.test(name));
}

// ---------------------------------------------------------------- paths

const isInside = (root: string, target: string) => {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/** realpath of the deepest existing ancestor + the remaining (not yet created) tail. Defeats symlink escapes. */
async function realResolve(p: string): Promise<string> {
  let head = p;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await realpath(head);
      return tail.length ? resolve(real, ...tail.reverse()) : real;
    } catch {
      const parent = dirname(head);
      if (parent === head) return p;
      tail.push(basename(head));
      head = parent;
    }
  }
}

/**
 * Resolve a path requested by an agent.
 * - relative paths are relative to the workspace
 * - reads: workspace or one of `readPaths`
 * - writes: workspace only
 * - secrets are always refused
 */
export async function resolveAgentPath(
  requested: string,
  opts: { workspace: string; readPaths: string[]; mode: "read" | "write" },
): Promise<string> {
  if (!requested || requested.includes("\0")) throw new ToolDenied("invalid path");
  const workspace = await realResolve(resolve(opts.workspace));
  const target = await realResolve(resolve(workspace, requested));
  if (isSecretPath(target)) throw new ToolDenied(`access to secret files is blocked: ${basename(target)}`);
  if (isInside(workspace, target)) return target;
  if (opts.mode === "read") {
    for (const allowed of opts.readPaths) {
      if (isInside(await realResolve(resolve(allowed)), target)) return target;
    }
  }
  throw new ToolDenied(
    opts.mode === "write"
      ? "writes are only allowed inside the run workspace"
      : "path is outside the workspace and not in this agent's read allowlist",
  );
}

/** Path shown to the model and in events: relative to the workspace when possible. */
export const displayPath = (workspace: string, abs: string) => {
  const rel = relative(workspace, abs);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel.split(sep).join("/") : abs;
};

// ---------------------------------------------------------------- shell

/**
 * Split a command line into argv without invoking a shell. Supports single
 * and double quotes and backslash escapes inside double quotes. Shell
 * operators are NOT interpreted: `a && b` becomes ["a", "&&", "b"].
 */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < line.length && /["\\$`]/.test(line[i + 1]!)) cur += line[++i];
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (quote) throw new ToolDenied("unterminated quote in command");
  if (has || cur) out.push(cur);
  return out;
}

const SHELL_OPERATORS = new Set(["&&", "||", ";", "|", ">", ">>", "<", "&", "2>", "2>&1"]);

/**
 * An allowlist entry is a command prefix, e.g. "bun test" allows
 * `bun test` and `bun test src/a.test.ts` but not `bun install`.
 * A trailing " *" is accepted for readability and means the same thing.
 * Commands containing shell operators never match.
 */
export function isAllowlisted(argv: string[], allowlist: string[]): boolean {
  if (!argv.length || argv.some((a) => SHELL_OPERATORS.has(a))) return false;
  return allowlist.some((entry) => {
    const prefix = splitArgs(entry.replace(/\s+\*$/, ""));
    return prefix.length > 0 && prefix.length <= argv.length && prefix.every((p, i) => p === argv[i]);
  });
}

/** Env for child processes: enough to run tools, nothing secret. */
export function scrubbedEnv(source: Record<string, string | undefined> = process.env): Record<string, string> {
  const keep = [
    "PATH", "Path", "PATHEXT", "SYSTEMROOT", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR",
    "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)",
    "LANG", "LC_ALL", "TERM", "SHELL", "USER", "USERNAME", "OS", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
  ];
  const env: Record<string, string> = {};
  for (const k of keep) if (source[k] !== undefined) env[k] = source[k]!;
  env.CI = "1";
  env.NO_COLOR = "1";
  return env;
}

// ---------------------------------------------------------------- risk

/**
 * `dangerous` always needs the owner. `review` needs the owner unless the agent
 * is trusted with `permission_level: review`. `safe` never asks.
 */
export function needsApproval(risk: RiskLevel, permission: PermissionLevel): boolean {
  if (risk === "dangerous") return true;
  if (risk === "review") return permission === "safe";
  return false;
}
