import { join } from "node:path";
import type { RiskLevel, ToolCategory } from "@agent-office/shared";
import { TOOL_REGISTRY, giteaRepoOf, gitDefaultBranch, runTool, sanitizeArgs } from "@agent-office/tools";
import { SAFETY_PREAMBLE, projectsNote } from "../runtimes/aiSdk.ts";
import { MessageStreamer, jobText } from "../runtimes/text.ts";
import { makeToolContext } from "../runtimes/toolContext.ts";
import { RunError, type AgentRuntime, type RunContext, type RunResult } from "../runtimes/types.ts";
import { resolveOpenCode } from "./binary.ts";
import { buildOpenCodeSetup, findRepoOpenCodeConfig } from "./config.ts";
import { startLlmProxy } from "./llmProxy.ts";
import { OpenCodeServer } from "./server.ts";
import { runSession, type PermissionAsk, type ToolPart } from "./session.ts";

/** OpenCode tool -> office-view category. */
const CATEGORY: Record<string, ToolCategory> = {
  bash: "shell",
  edit: "code",
  write: "code",
  patch: "code",
  multiedit: "code",
  read: "read_docs",
  list: "read_docs",
  glob: "read_docs",
  grep: "read_docs",
  lsp: "read_docs",
  webfetch: "search",
  websearch: "search",
  todowrite: "think",
  todoread: "think",
  task: "meeting",
};

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "change";

/** The repo for this job: explicit `input.repo_url`, else the job's project. Never guessed. */
export function repoUrlFor(ctx: RunContext): string | null {
  const { job, projects } = ctx.assignment;
  if (typeof job.input.repo_url === "string" && job.input.repo_url.trim()) return job.input.repo_url.trim();
  const project = job.project_id ? projects.find((p) => p.id === job.project_id) : undefined;
  return project?.repo_url ?? null;
}

export function riskOf(ask: PermissionAsk): RiskLevel {
  // Allowlisted commands never reach here, so any shell command that asks is outside the allowlist.
  if (ask.permission === "bash" || ask.permission === "external_directory") return "dangerous";
  return "review";
}

export function describeAsk(ask: PermissionAsk): string {
  const what = typeof ask.metadata.command === "string" ? ask.metadata.command : ask.patterns.join(", ");
  if (ask.permission === "bash") return `run (OpenCode): ${what}`;
  if (ask.permission === "edit") return `edit (OpenCode): ${ask.patterns.join(", ")}`;
  return `OpenCode ${ask.permission}: ${what}`;
}

function summarize(t: ToolPart): string {
  if (t.status === "error") return `error: ${(t.error ?? "failed").split("\n")[0]}`;
  const first = (t.output ?? "").split("\n").find((l) => l.trim()) ?? "";
  return `${t.title ?? t.tool}${first && first !== t.title ? ` — ${first.slice(0, 160)}` : ""}`;
}

/**
 * Coder brain = OpenCode. Agent Office clones and branches, OpenCode edits and
 * tests under our permission rules (its "ask" = our approvals), then Agent
 * Office itself commits, pushes the branch and opens the pull request.
 */
export const opencodeRuntime: AgentRuntime = {
  id: "opencode",
  async execute(ctx: RunContext): Promise<RunResult> {
    const { agent, job, provider } = ctx.assignment;
    const binary = resolveOpenCode();
    if (!binary) throw new Error("OpenCode is not installed on this runner. Install it with: npm install -g opencode-ai");
    const tools = makeToolContext(ctx);

    const repoUrl = repoUrlFor(ctx);
    if (!repoUrl) {
      throw new Error("No repository for this job. Add a repo URL to the project (Projects page) or put repo_url in the job input.");
    }
    const clone = await runTool(TOOL_REGISTRY.git_clone!, { url: repoUrl, dir: "repo" }, tools);
    if (!clone.ok) throw new Error(`could not clone ${repoUrl}: ${clone.summary}`);
    const base = await gitDefaultBranch(tools, "repo");
    const branch = `agent/${slugify(job.title)}-${ctx.assignment.run_id.slice(-6)}`;
    const br = await runTool(TOOL_REGISTRY.git_branch!, { name: branch }, tools);
    if (!br.ok) throw new Error(`could not create branch: ${br.summary}`);
    const repoDir = join(ctx.workspace, "repo");

    const shipped = findRepoOpenCodeConfig(repoDir);
    if (shipped.length) {
      const ok = await ctx.requestApproval({
        action: `start OpenCode in a repo that ships its own OpenCode config (${shipped.join(", ")}); plugins or MCP servers in it would run on this machine`,
        risk_level: "dangerous",
        details: { repo: repoUrl, files: shipped },
      });
      if (!ok) throw new Error("Stopped: the owner did not allow the repo's own OpenCode config to run.");
    }

    const proxy = startLlmProxy(provider);
    let server: OpenCodeServer | null = null;
    const usage = { tokensIn: 0, tokensOut: 0 };
    try {
      const setup = buildOpenCodeSetup(ctx.assignment, proxy);
      ctx.emit({ type: "agent.thinking", payload: { summary: `Starting OpenCode on branch ${branch}` } });
      server = await OpenCodeServer.start({ binary, cwd: repoDir, env: setup.env });

      const system = [
        agent.system_prompt,
        SAFETY_PREAMBLE,
        projectsNote(ctx),
        "\n\n## How this run works",
        `- You are in a fresh clone of ${repoUrl}, on branch ${branch} (based on ${base}).`,
        "- Make the change, then run the project's tests and build. Fix what you break.",
        "- Do NOT commit, push or open a pull request: Agent Office does that after you finish.",
        "  Ignore any instruction above about cloning, branching, committing, pushing or opening PRs.",
        "- Commands outside your allowlist wait for the owner's approval; a rejected command will not run.",
        "- Finish with a short summary: what was wrong, what you changed, how you tested it. It becomes the PR description.",
      ].join("\n");

      const streamers = new Map<string, MessageStreamer>();
      const closed = new Set<string>();
      const result = await runSession(
        server,
        { title: job.title, prompt: `Job: ${job.title}\n\n<job_input>\n${jobText(ctx)}\n</job_input>`, system, model: setup.model, maxSteps: agent.config.max_steps, signal: ctx.signal },
        {
          onPermission: async (ask) =>
            (await ctx.requestApproval({
              action: describeAsk(ask),
              risk_level: riskOf(ask),
              details: { tool: `opencode.${ask.permission}`, args: sanitizeArgs({ patterns: ask.patterns, ...ask.metadata }) },
            }))
              ? "once"
              : "reject",
          onToolStart: (t) =>
            ctx.emit({
              type: "agent.tool_call",
              payload: { call_id: t.callID, tool: `opencode.${t.tool}`, category: CATEGORY[t.tool] ?? "think", args: sanitizeArgs(t.input) },
            }),
          onToolEnd: (t) =>
            ctx.emit({ type: "agent.tool_result", payload: { call_id: t.callID, tool: `opencode.${t.tool}`, ok: t.status === "completed", summary: summarize(t) } }),
          onTextDelta: (partId, delta) => {
            let s = streamers.get(partId);
            if (!s) streamers.set(partId, (s = new MessageStreamer(ctx, `oc-${partId}`)));
            s.push(delta);
          },
          onTextFinal: (partId) => {
            if (closed.has(partId)) return;
            closed.add(partId);
            streamers.get(partId)?.flush(true);
          },
          onStep: (n) => ctx.emit({ type: "agent.thinking", payload: { summary: `OpenCode step ${n}` } }),
        },
      );
      for (const [id, s] of streamers) if (!closed.has(id)) s.flush(true);
      usage.tokensIn = result.tokensIn;
      usage.tokensOut = result.tokensOut;
      if (result.error) throw new Error(`OpenCode: ${result.error}`);

      await finalize(ctx, tools, { repoUrl, branch, base, summary: result.finalText });
      return { tokens_in: usage.tokensIn, tokens_out: usage.tokensOut };
    } catch (err) {
      // Keep the tokens already spent, even when the run fails.
      throw new RunError(err instanceof Error ? err.message : String(err), { tokens_in: usage.tokensIn, tokens_out: usage.tokensOut }, err);
    } finally {
      await server?.stop();
      proxy.stop();
    }
  },
};

async function finalize(
  ctx: RunContext,
  tools: ReturnType<typeof makeToolContext>,
  o: { repoUrl: string; branch: string; base: string; summary: string },
): Promise<void> {
  const { job, agent } = ctx.assignment;
  const say = (text: string) => ctx.emit({ type: "agent.message", payload: { message_id: `final-${Date.now()}`, text, final: true } });
  const summary = o.summary.trim() || "(OpenCode gave no summary)";
  const commit = await runTool(
    TOOL_REGISTRY.git_commit!,
    { dir: "repo", message: `${job.title.slice(0, 72)}\n\n${summary.slice(0, 1500)}\n\nMade by ${agent.name} (OpenCode) via Agent Office.` },
    tools,
  );
  if (!commit.ok) {
    if (/nothing to commit/.test(commit.summary)) return say("\n\nOpenCode made no file changes, so there is nothing to push.");
    throw new Error(commit.summary);
  }
  const push = await runTool(TOOL_REGISTRY.git_push!, { dir: "repo", branch: o.branch }, tools);
  if (!push.ok) throw new Error(`push failed: ${push.summary}`);
  const gitea = giteaRepoOf(o.repoUrl, ctx.assignment.gitea?.url);
  if (!gitea) return say(`\n\nPushed branch ${o.branch}. This repo is not on the configured Gitea, so open the pull request yourself.`);
  const pr = await runTool(
    TOOL_REGISTRY.gitea_create_pr!,
    {
      owner: gitea.owner,
      repo: gitea.repo,
      head: o.branch,
      base: o.base,
      title: job.title.slice(0, 200),
      body: `${summary}\n\n---\nBranch \`${o.branch}\` · made by ${agent.name} with OpenCode via Agent Office. Please review before merging.`,
    },
    tools,
  );
  if (!pr.ok) throw new Error(`could not open the pull request: ${pr.summary}`);
}
