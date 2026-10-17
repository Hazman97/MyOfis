import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

const IS_WIN = process.platform === "win32";

/**
 * Locate the OpenCode executable. Prefers the real binary over npm's launcher
 * wrapper so the process we start is the one we stop.
 * Order: AGENT_OFFICE_OPENCODE env, npm global install next to a PATH entry, a plain binary on PATH.
 */
export function resolveOpenCode(env: Record<string, string | undefined> = process.env): string | null {
  const override = env.AGENT_OFFICE_OPENCODE;
  if (override) return existsSync(override) ? override : null;
  const exe = IS_WIN ? "opencode.exe" : "opencode";
  const dirs = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    const npmBin = join(dir, "node_modules", "opencode-ai", "bin", exe);
    if (existsSync(npmBin)) return npmBin;
    const npmBinUnix = join(dir, "..", "lib", "node_modules", "opencode-ai", "bin", exe);
    if (!IS_WIN && existsSync(npmBinUnix)) return npmBinUnix;
  }
  for (const dir of dirs) {
    const plain = join(dir, exe);
    if (existsSync(plain)) return plain;
  }
  return null;
}

/** Stop a process and everything it started (OpenCode spawns shells, LSP servers…). */
export function killTree(pid: number): void {
  try {
    if (IS_WIN) {
      Bun.spawnSync(["taskkill", "/PID", String(pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" });
    } else {
      process.kill(-pid, "SIGTERM"); // process group (spawned detached)
    }
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}
