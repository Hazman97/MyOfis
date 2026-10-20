import { existsSync } from "node:fs";
import { join } from "node:path";
import { modelCandidates, type RunAssignment } from "@agent-office/shared";
import { scrubbedEnv } from "@agent-office/tools";

type Rule = "allow" | "ask" | "deny";

/**
 * Git commands OpenCode may never run: Agent Office itself commits, pushes and
 * opens the PR after OpenCode finishes, and history rewrites are never needed.
 */
export const GIT_DENY = [
  "git push*",
  "git remote*",
  "git config*",
  "git commit*",
  "git reset --hard*",
  "git clean*",
  "git rebase*",
  "git filter-branch*",
  "git update-ref*",
];

/** Secret-looking files OpenCode's own read/edit tools must not touch (our path guard does not run inside OpenCode). */
export const SECRET_GLOBS = ["*.env", "*.env.*", ".env", ".env.*", "**/.env", "**/.env.*", "*.pem", "*.key", "**/id_rsa*", "**/id_ed25519*", "*.p12", "*.pfx", "**/.npmrc", "**/.git-credentials"];

/** Map our agent settings onto OpenCode's permission config. Pure; covered by unit tests. */
export function buildPermissions(agent: RunAssignment["agent"]): Record<string, Rule | Record<string, Rule>> {
  // Object key order matters: OpenCode applies the LAST matching rule, so "*" first, deny rules last.
  const bash: Record<string, Rule> = { "*": "ask" };
  for (const prefix of agent.config.shell_allowlist) {
    bash[prefix] = "allow";
    bash[`${prefix} *`] = "allow";
  }
  for (const p of GIT_DENY) bash[p] = "deny";

  const guarded = (base: Rule): Record<string, Rule> => {
    const r: Record<string, Rule> = { "*": base };
    for (const g of SECRET_GLOBS) r[g] = "deny";
    return r;
  };

  return {
    "*": "ask", // any tool we do not know about asks the owner
    read: guarded("allow"),
    list: "allow",
    glob: "allow",
    grep: "allow",
    lsp: "allow",
    todowrite: "allow",
    todoread: "allow",
    edit: guarded(agent.permission_level === "review" ? "allow" : "ask"),
    bash,
    task: "allow", // sub-agents inherit these same rules
    webfetch: "deny", // fetched pages are a prompt-injection channel; Coder works from the repo
    websearch: "deny",
    skill: "deny",
    external_directory: "deny",
    doom_loop: "ask",
  };
}

export interface OpenCodeSetup {
  config: Record<string, unknown>;
  env: Record<string, string>;
  model: { providerID: string; modelID: string };
}

/**
 * Inline OpenCode config + env for one run. The model endpoint is `llmBaseUrl`
 * (the runner's local key-injecting proxy), so OpenCode never holds the real API key.
 */
export function buildOpenCodeSetup(a: RunAssignment, llm: { baseUrl: string; token: string }): OpenCodeSetup {
  const providerID = "agentoffice";
  // OpenCode takes one model: "auto" means the provider's best one (no fallback inside OpenCode)
  const modelID = modelCandidates(a.agent.model, a.provider.models ?? [])[0];
  if (!modelID) throw new Error(`model "auto" needs the provider's model list: open Settings → AI providers and press "Scan models", or pick a model for this agent`);
  const config = {
    $schema: "https://opencode.ai/config.json",
    autoupdate: false,
    share: "disabled",
    model: `${providerID}/${modelID}`,
    small_model: `${providerID}/${modelID}`,
    provider: {
      [providerID]: {
        npm: "@ai-sdk/openai-compatible",
        name: `Agent Office (${a.provider.slug})`,
        options: { baseURL: llm.baseUrl, apiKey: llm.token },
        models: { [modelID]: { name: modelID } },
      },
    },
    permission: buildPermissions(a.agent),
  };
  const env: Record<string, string> = {
    ...scrubbedEnv(),
    OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
  };
  return { config, env, model: { providerID, modelID } };
}

/** OpenCode config shipped inside a repo would be loaded (plugins/MCP = code running on this machine). */
export function findRepoOpenCodeConfig(repoDir: string): string[] {
  return ["opencode.json", "opencode.jsonc", ".opencode"].filter((f) => existsSync(join(repoDir, f)));
}
