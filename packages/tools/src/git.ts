import { z } from "zod";
import { displayPath, isSecretPath, resolveAgentPath } from "./safety.ts";
import { execArgv, type ExecResult } from "./shell.ts";
import { ToolDenied, defineTool, type ToolContext } from "./types.ts";

const PROTECTED_BRANCHES = new Set(["main", "master", "production", "prod", "release"]);
const BRANCH_RE = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._\/-]{1,100}(?<!\.lock)(?<![/.])$/;

const dirInput = z.string().default("repo").describe("Repository folder, relative to the workspace");

/**
 * Environment for git: identity of the agent, never prompt, and the Gitea
 * token as an http.extraHeader scoped to the Gitea URL only (never in argv,
 * never sent to other hosts).
 */
export function gitEnv(ctx: ToolContext): Record<string, string> {
  const email = `${ctx.agent.slug}@agent-office.local`;
  const env: Record<string, string> = {
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: `${ctx.agent.name} (Agent Office)`,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: `${ctx.agent.name} (Agent Office)`,
    GIT_COMMITTER_EMAIL: email,
  };
  if (ctx.gitea) {
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = `http.${ctx.gitea.url.replace(/\/?$/, "/")}.extraheader`;
    env.GIT_CONFIG_VALUE_0 = `Authorization: token ${ctx.gitea.token}`;
  }
  return env;
}

async function git(ctx: ToolContext, cwd: string, args: string[], timeoutMs = 120_000): Promise<ExecResult> {
  return execArgv(["git", ...args], { cwd, signal: ctx.signal, timeoutMs, env: gitEnv(ctx) });
}

const fail = (r: ExecResult, what: string) => {
  throw new Error(`${what} failed (exit ${r.code}): ${(r.stderr || r.stdout).trim().slice(-1500)}`);
};

async function repoDir(ctx: ToolContext, dir: string) {
  return resolveAgentPath(dir, { workspace: ctx.workspace, readPaths: [], mode: "write" });
}

export const gitCloneTool = defineTool({
  name: "git_clone",
  description: "Clone a repository into your workspace (default folder: repo). Then work inside that folder.",
  category: "git",
  input: z.object({
    url: z.string().min(1).describe("Clone URL (https://… or a local path)"),
    dir: dirInput,
    branch: z.string().regex(BRANCH_RE).optional(),
  }),
  risk: () => "review",
  describe: (i) => `clone ${i.url} into ${i.dir}`,
  async execute(i, ctx) {
    if (i.url.startsWith("-")) throw new ToolDenied("invalid URL");
    const dest = await repoDir(ctx, i.dir);
    const args = ["clone", "--depth", "50", ...(i.branch ? ["--branch", i.branch] : []), "--", i.url, dest];
    const r = await git(ctx, ctx.workspace, args, 600_000);
    if (r.code !== 0) fail(r, "clone");
    return { ok: true, summary: `cloned into ${displayPath(ctx.workspace, dest)}`, output: { dir: displayPath(ctx.workspace, dest) } };
  },
});

export const gitStatusTool = defineTool({
  name: "git_status",
  description: "Show the current branch and changed files.",
  category: "git",
  input: z.object({ dir: dirInput }),
  risk: () => "safe",
  describe: (i) => `git status in ${i.dir}`,
  async execute(i, ctx) {
    const r = await git(ctx, await repoDir(ctx, i.dir), ["status", "--short", "--branch"]);
    if (r.code !== 0) fail(r, "status");
    return { ok: true, summary: r.stdout.split("\n")[0] ?? "status", output: { status: r.stdout } };
  },
});

export const gitDiffTool = defineTool({
  name: "git_diff",
  description: "Show uncommitted changes (or staged changes with staged=true).",
  category: "git",
  input: z.object({ dir: dirInput, staged: z.boolean().default(false) }),
  risk: () => "safe",
  describe: (i) => `git diff in ${i.dir}`,
  async execute(i, ctx) {
    const r = await git(ctx, await repoDir(ctx, i.dir), ["diff", ...(i.staged ? ["--cached"] : []), "--stat", "--patch"]);
    if (r.code !== 0) fail(r, "diff");
    return { ok: true, summary: `${r.stdout.length} chars of diff`, output: { diff: r.stdout } };
  },
});

export const gitBranchTool = defineTool({
  name: "git_branch",
  description: "Create a new branch from the current HEAD and switch to it. Use names like fix/short-description.",
  category: "git",
  input: z.object({ dir: dirInput, name: z.string().regex(BRANCH_RE, "invalid branch name") }),
  risk: () => "review",
  describe: (i) => `create branch ${i.name}`,
  async execute(i, ctx) {
    if (PROTECTED_BRANCHES.has(i.name)) throw new ToolDenied(`"${i.name}" is a protected branch name`);
    const r = await git(ctx, await repoDir(ctx, i.dir), ["switch", "-c", i.name]);
    if (r.code !== 0) fail(r, "branch");
    return { ok: true, summary: `on new branch ${i.name}`, output: { branch: i.name } };
  },
});

export const gitCommitTool = defineTool({
  name: "git_commit",
  description: "Stage all changes and commit them with a clear message. Secret files are never committed.",
  category: "git",
  input: z.object({ dir: dirInput, message: z.string().min(3).max(2000) }),
  risk: () => "review",
  describe: (i) => `commit: ${i.message.split("\n")[0]}`,
  async execute(i, ctx) {
    const cwd = await repoDir(ctx, i.dir);
    const add = await git(ctx, cwd, ["add", "-A"]);
    if (add.code !== 0) fail(add, "add");
    const staged = await git(ctx, cwd, ["diff", "--cached", "--name-only", "-z"]);
    const files = staged.stdout.split("\0").filter(Boolean);
    const secrets = files.filter((f) => isSecretPath(f));
    if (secrets.length) {
      await git(ctx, cwd, ["reset", "-q", "--", ...secrets]);
      throw new ToolDenied(`refusing to commit secret files: ${secrets.join(", ")} (unstaged; add them to .gitignore)`);
    }
    if (!files.length) return { ok: false, summary: "nothing to commit", output: { error: "nothing to commit" } };
    const r = await git(ctx, cwd, ["commit", "-m", i.message]);
    if (r.code !== 0) fail(r, "commit");
    const sha = (await git(ctx, cwd, ["rev-parse", "--short", "HEAD"])).stdout.trim();
    return { ok: true, summary: `committed ${sha} (${files.length} files)`, output: { sha, files } };
  },
});

export const gitPushTool = defineTool({
  name: "git_push",
  description:
    "Push a branch to origin. Pushing feature branches is normal; pushing main/master needs the owner's approval and should almost never be done — open a pull request instead.",
  category: "git",
  input: z.object({ dir: dirInput, branch: z.string().regex(BRANCH_RE, "invalid branch name") }),
  risk: (i) => (PROTECTED_BRANCHES.has(i.branch) ? "dangerous" : "review"),
  describe: (i) => `git push origin ${i.branch}`,
  async execute(i, ctx) {
    // No --force, ever: the refspec only fast-forwards.
    const r = await git(ctx, await repoDir(ctx, i.dir), ["push", "origin", `HEAD:refs/heads/${i.branch}`], 300_000);
    if (r.code !== 0) fail(r, "push");
    return { ok: true, summary: `pushed ${i.branch}`, output: { branch: i.branch } };
  },
});

export const GIT_TOOLS = [gitCloneTool, gitStatusTool, gitDiffTool, gitBranchTool, gitCommitTool, gitPushTool];

/** Branch the clone's origin points HEAD at (e.g. "main"); falls back to "main". */
export async function gitDefaultBranch(ctx: ToolContext, dir: string): Promise<string> {
  const r = await git(ctx, await repoDir(ctx, dir), ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).catch(() => null);
  const name = r?.code === 0 ? r.stdout.trim().replace(/^origin\//, "") : "";
  return BRANCH_RE.test(name) ? name : "main";
}

/**
 * owner/repo of a Gitea clone URL, only when it is on the configured Gitea host
 * (so we never send the Gitea token anywhere else).
 */
export function giteaRepoOf(cloneUrl: string, giteaUrl: string | undefined): { owner: string; repo: string } | null {
  if (!giteaUrl) return null;
  try {
    const u = new URL(cloneUrl);
    const g = new URL(giteaUrl);
    if (u.host !== g.host) return null;
    const rest = u.pathname.slice(g.pathname.replace(/\/$/, "").length).replace(/^\//, "").replace(/\.git$/, "");
    const [owner, repo, ...extra] = rest.split("/");
    return owner && repo && !extra.length ? { owner, repo } : null;
  } catch {
    return null;
  }
}
