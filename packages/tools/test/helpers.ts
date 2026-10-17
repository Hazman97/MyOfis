import { AgentConfig, type FeatureNoteData, type PermissionLevel, type ProjectContext, type RunnerEventBody } from "@agent-office/shared";
import type { ApprovalRequest, DraftRequest, GiteaConfig, HandoffRequest, HandoffTarget, ToolContext } from "../src/index.ts";

export function makeCtx(
  workspace: string,
  opts: {
    permission?: PermissionLevel;
    approve?: boolean;
    allow?: string[];
    gitea?: GiteaConfig | null;
    targets?: HandoffTarget[];
    baselineDir?: string;
    httpAllow?: string[];
    projectContext?: ProjectContext | null;
    projectId?: string | null;
  } = {},
) {
  const events: RunnerEventBody[] = [];
  const approvals: ApprovalRequest[] = [];
  const handoffs: HandoffRequest[] = [];
  const uploads: string[] = [];
  const drafts: DraftRequest[] = [];
  const features: { project_id: string; note: FeatureNoteData }[] = [];
  const ctx: ToolContext = {
    workspace,
    config: AgentConfig.parse({ shell_allowlist: opts.allow ?? [], http_allowlist: opts.httpAllow ?? [] }),
    permissionLevel: opts.permission ?? "review",
    signal: new AbortController().signal,
    async requestApproval(req) {
      approvals.push(req);
      return opts.approve ?? false;
    },
    emit: (e) => events.push(e),
    agent: { slug: "coder", name: "Coder" },
    gitea: opts.gitea ?? null,
    handoffTargets: opts.targets ?? [],
    handoff: (h) => handoffs.push(h),
    projectId: opts.projectId ?? null,
    baselineDir: opts.baselineDir ?? null,
    async uploadArtifact(name) {
      uploads.push(name);
      return `artifacts/test/${name}`;
    },
    projectContext: opts.projectContext ?? null,
    saveDraft: (d) => drafts.push(d),
    addFeatureNote: (f) => features.push(f),
    memoryStores: { memory: [], user: [] },
    memoryWriteApproval: false,
    saveMemory: () => {},
    skills: [],
    proposeSkill: () => {},
    searchSessions: async () => [],
  };
  return { ctx, events, approvals, handoffs, uploads, drafts, features };
}
