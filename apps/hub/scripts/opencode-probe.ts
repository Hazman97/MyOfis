// One-off probe: run OpenCode with the OpenRouter key stored (encrypted) in the hub.
// The key is decrypted in memory and passed via env only; it is never printed or written to disk.
// Usage (repo root): bun apps/hub/scripts/opencode-probe.ts <workdir> "<prompt>" [model]
import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { Secrets } from "../src/crypto.ts";

const [workdir, prompt, model = "openrouter/nvidia/nemotron-3-super-120b-a12b:free"] = process.argv.slice(2);
if (!workdir || !prompt) throw new Error("usage: opencode-probe.ts <workdir> <prompt> [model]");

const db = new Database(resolve(process.env.DATABASE_PATH ?? "./data/agent-office.db"), { readonly: true });
const row = db.query("select api_key_enc from providers where slug = 'openrouter'").get() as { api_key_enc: string | null } | null;
db.close();
if (!row?.api_key_enc) throw new Error("no OpenRouter key stored in the hub");
const key = new Secrets(process.env.SECRETS_KEY!).decrypt(row.api_key_enc);

const modelId = model.replace(/^openrouter\//, "");
const config = {
  $schema: "https://opencode.ai/config.json",
  provider: { openrouter: { options: { apiKey: "{env:OPENROUTER_API_KEY}" }, models: { [modelId]: {} } } },
  // Probe only: allow edits/reads in the workdir, deny shell and network.
  permission: { "*": "deny", read: "allow", edit: "allow", list: "allow", glob: "allow", grep: "allow" },
};

const proc = Bun.spawn(["opencode", "run", "--format", "json", "--model", model, "--dir", workdir, prompt], {
  cwd: workdir,
  env: {
    PATH: process.env.PATH ?? "",
    USERPROFILE: process.env.USERPROFILE ?? "",
    APPDATA: process.env.APPDATA ?? "",
    LOCALAPPDATA: process.env.LOCALAPPDATA ?? "",
    SYSTEMROOT: process.env.SYSTEMROOT ?? "",
    TEMP: process.env.TEMP ?? "",
    TMP: process.env.TMP ?? "",
    OPENROUTER_API_KEY: key,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
  },
  stdout: "pipe",
  stderr: "pipe",
});
const timer = setTimeout(() => proc.kill(), 180_000);
const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
clearTimeout(timer);
const scrub = (s: string) => s.split(key).join("[REDACTED]");
console.log(`exit ${code}`);
console.log("--- stdout (json events) ---");
console.log(scrub(out).slice(0, 12000));
if (err.trim()) console.log("--- stderr ---\n" + scrub(err).slice(-3000));
