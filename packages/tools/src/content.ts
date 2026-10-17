import { z } from "zod";
import { DraftKind, FeatureNoteInput, Platform, SelfCheck, type ProjectContext } from "@agent-office/shared";
import { ToolDenied, defineTool, type ToolContext } from "./types.ts";

/**
 * Marketing's tools (spec §8.4): it reads ONLY the brief, the feature log and
 * past drafts that the hub put in the run's project context, and it can only
 * write drafts. Plus the Coder's feature note.
 */

type Ctx = ProjectContext["projects"][number];

const projectArg = z.string().max(64).optional().describe("Project slug. Defaults to the job's project.");

function contextOf(ctx: ToolContext): ProjectContext {
  if (!ctx.projectContext) throw new ToolDenied("no project context for this run (only Marketing jobs get briefs)");
  return ctx.projectContext;
}

function pickProject(ctx: ToolContext, slug: string | undefined): Ctx {
  const pc = contextOf(ctx);
  const p = slug ? pc.projects.find((x) => x.slug === slug) : pc.projects.find((x) => x.id === ctx.projectId) ?? (pc.projects.length === 1 ? pc.projects[0] : undefined);
  if (!p) {
    const names = pc.projects.map((x) => x.slug).join(", ") || "none";
    throw new ToolDenied(slug ? `unknown project "${slug}". Projects: ${names}` : `say which project (one of: ${names})`);
  }
  return p;
}

export const readBriefTool = defineTool({
  name: "read_brief",
  description:
    "Read a project's brief: what it is, who it is for, prices, facts, tone, language per platform, things never to say, the owner's favourite example posts and the style notes. " +
    "Only state facts that are in the brief or the feature log.",
  category: "read_docs",
  input: z.object({ project: projectArg }),
  risk: () => "safe",
  describe: (i) => `read the brief${i.project ? ` of ${i.project}` : ""}`,
  async execute(i, ctx) {
    const p = pickProject(ctx, i.project);
    if (!p.brief) {
      return {
        ok: true,
        summary: `${p.slug} has no brief yet`,
        output: { project: p.slug, name: p.name, brief: null, note: "No brief yet. Write only general copy without prices or claims, and say in the self-check notes that the owner should fill in the brief." },
      };
    }
    return { ok: true, summary: `brief of ${p.slug}`, output: { project: p.slug, name: p.name, live_url: p.live_url, today: contextOf(ctx).today, brief: p.brief } };
  },
});

export const readFeatureLogTool = defineTool({
  name: "read_feature_log",
  description: "Read the project's released features (user-facing notes, newest first). Never announce a feature that is not here or in the brief.",
  category: "read_docs",
  input: z.object({ project: projectArg, limit: z.number().int().min(1).max(15).default(10) }),
  risk: () => "safe",
  describe: (i) => `read the feature log${i.project ? ` of ${i.project}` : ""}`,
  async execute(i, ctx) {
    const p = pickProject(ctx, i.project);
    return { ok: true, summary: `${Math.min(i.limit, p.features.length)} features of ${p.slug}`, output: p.features.slice(0, i.limit) };
  },
});

export const readPastDraftsTool = defineTool({
  name: "read_past_drafts",
  description:
    "Read drafts the owner already decided on, with their edits and feedback. Approved and edited ones show what the owner likes " +
    "(compare original_body with body to see what they changed); rejected ones with feedback show what to avoid.",
  category: "read_docs",
  input: z.object({ project: projectArg, platform: Platform.optional() }),
  risk: () => "safe",
  describe: (i) => `read past drafts${i.project ? ` of ${i.project}` : ""}`,
  async execute(i, ctx) {
    const p = pickProject(ctx, i.project);
    const list = p.past_drafts.filter((d) => !i.platform || d.platform === i.platform);
    return { ok: true, summary: `${list.length} past drafts of ${p.slug}`, output: list };
  },
});

const COPY_RUN = 12;
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

/** Phrases the brief forbids, taken from quoted text in `do_not` (e.g. guna "terbaik di Malaysia"), plus the spec's example. */
function forbiddenPhrases(p: Ctx): string[] {
  const out = new Set(["terbaik di malaysia"]);
  for (const rule of p.brief?.do_not ?? []) for (const m of rule.matchAll(/["“”']([^"“”']{3,80})["“”']/g)) out.add(m[1]!.toLowerCase());
  return [...out];
}

/** A run of COPY_RUN identical words shared with an example post means copying, not learning the style. */
function copiedFrom(body: string, examples: string[]): string | null {
  const shingles = new Set<string>();
  for (const ex of examples) {
    const w = words(ex);
    for (let i = 0; i + COPY_RUN <= w.length; i++) shingles.add(w.slice(i, i + COPY_RUN).join(" "));
  }
  if (!shingles.size) return null;
  const w = words(body);
  for (let i = 0; i + COPY_RUN <= w.length; i++) {
    const s = w.slice(i, i + COPY_RUN).join(" ");
    if (shingles.has(s)) return s;
  }
  return null;
}

export const saveDraftTool = defineTool({
  name: "save_draft",
  description:
    "Save ONE content draft for the owner to review (one per variant). Nothing is ever published; the owner approves, edits or rejects it. " +
    "Before saving, review it yourself and fill self_check honestly: if a check would be false, fix the draft first.",
  category: "write",
  input: z.object({
    project: projectArg,
    platform: Platform,
    kind: DraftKind,
    title: z.string().min(1).max(200).describe('Short label, e.g. "Caption A: cuti sekolah"'),
    body: z.string().min(1).max(20_000).describe("The full draft, ready to paste"),
    self_check: SelfCheck,
  }),
  risk: () => "safe",
  describe: (i) => `save a ${i.platform} ${i.kind} draft: ${i.title}`,
  async execute(i, ctx) {
    const p = pickProject(ctx, i.project);
    const failed = (["facts_match_brief", "only_released_features", "no_overclaims", "tone_and_language_match"] as const).filter((k) => !i.self_check[k]);
    if (failed.length) throw new ToolDenied(`self-check failed (${failed.join(", ")}). Fix the draft so every check is true, then save it again.`);
    const lower = i.body.toLowerCase();
    const banned = forbiddenPhrases(p).find((f) => lower.includes(f));
    if (banned) throw new ToolDenied(`the draft says "${banned}", which the brief forbids. Rewrite without it.`);
    const copied = i.kind === "style_guide" ? null : copiedFrom(i.body, p.brief?.good_examples ?? []);
    if (copied) throw new ToolDenied(`the draft copies an example post word for word ("${copied}…"). Learn the style; write new sentences.`);
    ctx.saveDraft({ project_id: p.id, platform: i.platform, kind: i.kind, title: i.title, body: i.body, self_check: i.self_check });
    return { ok: true, summary: `draft saved: ${i.platform} ${i.kind}`, output: { saved: true, project: p.slug, status: "waiting for the owner" } };
  },
});

export const addFeatureNoteTool = defineTool({
  name: "add_feature_note",
  description:
    "Record a released change in the project's feature log, in plain customer language (no jargon, no file names, no ticket numbers). " +
    "This tells Marketing and Tester about it. Only call it when the change is merged and its CI passed.",
  category: "write",
  input: FeatureNoteInput.extend({ source_pr_url: z.string().url().optional() }),
  risk: () => "safe",
  describe: (i) => `add a feature note: ${i.title}`,
  async execute(i, ctx) {
    if (!ctx.projectId) throw new ToolDenied("this job has no project; feature notes belong to a project");
    ctx.addFeatureNote({ project_id: ctx.projectId, note: { title: i.title, user_facing_note: i.user_facing_note, source_pr_url: i.source_pr_url ?? null } });
    return { ok: true, summary: `feature note: ${i.title}`, output: { recorded: true } };
  },
});

export const CONTENT_TOOLS = [readBriefTool, readFeatureLogTool, readPastDraftsTool, saveDraftTool];
