import { eq } from "drizzle-orm";
import { z } from "zod";
import { GiteaClient, giteaRepoOf } from "@agent-office/tools";
import type { Hub } from "./core.ts";
import { projects, settings } from "./db/schema.ts";
import type { Integrations } from "./integrations.ts";

const SEEN_KEY = "releases.merged_prs";
const SEEN_MAX = 2000;
/** PRs on Agent Office branch names (agent/…, fix/…, feat/…) get a release note. */
const AGENT_BRANCH = /^(agent|fix|feat)\//;

const Seen = z.object({ projects: z.array(z.string()).default([]), prs: z.array(z.string()).default([]) });

interface GiteaPull {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  merged: boolean;
  merged_at: string | null;
  merge_commit_sha: string | null;
  head: { ref: string };
  base: { ref: string };
}

/**
 * Polls Gitea for merged pull requests on agent branches (the hub runs on
 * 127.0.0.1, so Gitea webhooks could not reach it). Each newly merged PR
 * becomes a `feature_note` job for the Coder. PRs merged before a project was
 * first watched are skipped, so connecting Gitea never floods the queue.
 */
export class ReleaseWatcher {
  #timer: ReturnType<typeof setInterval> | null = null;
  #busy = false;

  constructor(
    private readonly hub: Hub,
    private readonly integrations: Integrations,
    private readonly intervalMs = 5 * 60_000,
  ) {}

  start(): void {
    this.#timer = setInterval(() => void this.check().catch((err) => console.error("[releases] check failed", err)), this.intervalMs);
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  #seen() {
    const row = this.hub.db.select().from(settings).where(eq(settings.key, SEEN_KEY)).get();
    return Seen.parse(row?.value ?? {});
  }

  #save(value: z.infer<typeof Seen>) {
    const v = { projects: value.projects, prs: value.prs.slice(-SEEN_MAX) };
    this.hub.db.insert(settings).values({ key: SEEN_KEY, value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v } }).run();
  }

  /** One pass over every project with a Gitea repo. Returns the jobs created. */
  async check(): Promise<string[]> {
    if (this.#busy) return [];
    const gitea = this.integrations.gitea();
    if (!gitea) return [];
    this.#busy = true;
    try {
      const seen = this.#seen();
      const known = new Set(seen.prs);
      const created: string[] = [];
      const client = new GiteaClient(gitea);
      for (const p of this.hub.db.select().from(projects).where(eq(projects.enabled, true)).all()) {
        const repo = p.repo_url ? giteaRepoOf(p.repo_url, gitea.url) : null;
        if (!repo) continue;
        let pulls: GiteaPull[];
        try {
          pulls = await client.request<GiteaPull[]>("GET", `/repos/${repo.owner}/${repo.repo}/pulls?state=closed&sort=recentupdate&limit=30`);
        } catch (err) {
          console.error(`[releases] ${p.slug}: ${(err as Error).message}`);
          continue;
        }
        const firstLook = !seen.projects.includes(p.id);
        for (const pr of pulls) {
          if (!pr.merged || !AGENT_BRANCH.test(pr.head.ref)) continue;
          const key = `${p.id}#${pr.number}`;
          if (known.has(key)) continue;
          known.add(key);
          seen.prs.push(key);
          if (firstLook) continue;
          const job = this.hub.createFeatureNoteJob(p.id, {
            number: pr.number,
            title: pr.title,
            body: pr.body ?? "",
            url: pr.html_url,
            merge_commit_sha: pr.merge_commit_sha,
            repo: `${repo.owner}/${repo.repo}`,
            base: pr.base.ref,
          });
          if (job) created.push(job.id);
        }
        if (firstLook) seen.projects.push(p.id);
      }
      this.#save(seen);
      return created;
    } finally {
      this.#busy = false;
    }
  }
}
