import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAllowlisted, isSecretPath, needsApproval, resolveAgentPath, scrubbedEnv, splitArgs } from "../src/safety.ts";

let root: string;
let ws: string;
let outside: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ao-safety-"));
  ws = join(root, "ws");
  outside = join(root, "outside");
  mkdirSync(join(ws, "src"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(ws, "src", "a.ts"), "x");
  writeFileSync(join(outside, "notes.md"), "hello");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("secret paths", () => {
  test.each([".env", ".env.local", "prod.pem", "server.key", "id_rsa", "id_ed25519.pub", ".git-credentials", ".npmrc", "agent-office.db", "x/.ssh/config", "credentials.json", "runner-state.json"])(
    "%s is secret",
    (p) => expect(isSecretPath(p)).toBe(true),
  );
  test.each(["src/index.ts", "README.md", "envelope.ts", "keyboard.vue", "monkey.ts", ".environment-notes"])("%s is not secret", (p) =>
    expect(isSecretPath(p)).toBe(false),
  );
});

describe("resolveAgentPath", () => {
  const opts = (mode: "read" | "write", readPaths: string[] = []) => ({ workspace: ws, readPaths, mode });

  test("relative paths resolve inside the workspace", async () => {
    expect(await resolveAgentPath("src/a.ts", opts("read"))).toContain(join("ws", "src", "a.ts"));
  });

  test("traversal out of the workspace is denied", async () => {
    await expect(resolveAgentPath("../outside/notes.md", opts("read"))).rejects.toThrow(/outside the workspace/);
    await expect(resolveAgentPath(join(outside, "notes.md"), opts("read"))).rejects.toThrow();
  });

  test("allowlisted read path works for reads, never for writes", async () => {
    expect(await resolveAgentPath(join(outside, "notes.md"), opts("read", [outside]))).toContain("notes.md");
    await expect(resolveAgentPath(join(outside, "notes.md"), opts("write", [outside]))).rejects.toThrow(/inside the run workspace/);
  });

  test("secrets are blocked even inside the workspace", async () => {
    writeFileSync(join(ws, ".env"), "SECRET=1");
    await expect(resolveAgentPath(".env", opts("read"))).rejects.toThrow(/secret/);
  });

  test("new files can be written in the workspace", async () => {
    expect(await resolveAgentPath("new/dir/file.txt", opts("write"))).toContain("file.txt");
  });

  test("symlink pointing outside is denied", async () => {
    let linked = false;
    try {
      symlinkSync(outside, join(ws, "link"), "junction");
      linked = true;
    } catch {
      // Symlinks may need privileges on Windows; skip silently if unavailable.
    }
    if (!linked) return;
    await expect(resolveAgentPath("link/notes.md", opts("read"))).rejects.toThrow();
  });
});

describe("shell", () => {
  test("splitArgs handles quotes and does not interpret operators", () => {
    expect(splitArgs(`git commit -m "fix: a \\"b\\""`)).toEqual(["git", "commit", "-m", 'fix: a "b"']);
    expect(splitArgs("echo 'a b' c")).toEqual(["echo", "a b", "c"]);
    expect(splitArgs("bun test && rm -rf /")).toEqual(["bun", "test", "&&", "rm", "-rf", "/"]);
    expect(splitArgs(`echo ""`)).toEqual(["echo", ""]);
    expect(() => splitArgs(`echo "oops`)).toThrow();
  });

  test("allowlist matches command prefixes only", () => {
    const allow = ["bun test", "git status", "bun run build *"];
    expect(isAllowlisted(["bun", "test"], allow)).toBe(true);
    expect(isAllowlisted(["bun", "test", "src/a.test.ts"], allow)).toBe(true);
    expect(isAllowlisted(["bun", "run", "build"], allow)).toBe(true);
    expect(isAllowlisted(["bun", "install"], allow)).toBe(false);
    expect(isAllowlisted(["bun"], allow)).toBe(false);
    expect(isAllowlisted(["bun", "test", "&&", "rm", "-rf", "/"], allow)).toBe(false);
    expect(isAllowlisted(["git", "status", "|", "sh"], allow)).toBe(false);
    expect(isAllowlisted(["git", "push"], [])).toBe(false);
  });

  test("scrubbed env drops secrets", () => {
    const env = scrubbedEnv({ PATH: "/bin", SECRETS_KEY: "s", ANTHROPIC_API_KEY: "k", LOCAL_AUTH_TOKEN: "t", GITEA_TOKEN: "g" });
    expect(env.PATH).toBe("/bin");
    expect(Object.keys(env)).not.toContain("SECRETS_KEY");
    expect(Object.keys(env)).not.toContain("ANTHROPIC_API_KEY");
    expect(Object.keys(env)).not.toContain("LOCAL_AUTH_TOKEN");
    expect(Object.keys(env)).not.toContain("GITEA_TOKEN");
  });
});

describe("needsApproval", () => {
  test("matrix", () => {
    expect(needsApproval("safe", "safe")).toBe(false);
    expect(needsApproval("safe", "review")).toBe(false);
    expect(needsApproval("review", "safe")).toBe(true);
    expect(needsApproval("review", "review")).toBe(false);
    expect(needsApproval("dangerous", "safe")).toBe(true);
    expect(needsApproval("dangerous", "review")).toBe(true);
  });
});
