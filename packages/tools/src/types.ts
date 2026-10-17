import type { z } from "zod";
import type {
  AgentConfig,
  DraftKind,
  FeatureNoteData,
  MemoryOp,
  PermissionLevel,
  Platform,
  ProjectContext,
  RiskLevel,
  RunnerEventBody,
  SelfCheck,
  ToolCategory,
} from "@agent-office/shared";

export interface ApprovalRequest {
  /** Human-readable, shown in the approvals inbox. e.g. `run: rm -rf build` */
  action: string;
  risk_level: RiskLevel;
  details: Record<string, unknown>;
}

export interface GiteaConfig {
  url: string;
  token: string;
}

export interface HandoffTarget {
  slug: string;
  name: string;
  role: string;
}

export interface HandoffRequest {
  to_agent: string;
  title: string;
  input: Record<string, unknown>;
  reason: string;
  project_id: string | null;
}

export interface ToolContext {
  /** Absolute path of the run's workspace. Writes are confined here. */
  workspace: string;
  config: AgentConfig;
  permissionLevel: PermissionLevel;
  signal: AbortSignal;
  /** Resolves true when the owner approves. */
  requestApproval(req: ApprovalRequest): Promise<boolean>;
  emit(event: RunnerEventBody): void;
  agent: { slug: string; name: string };
  /** Only present when the agent was granted Gitea/git tools and Gitea is configured. */
  gitea: GiteaConfig | null;
  /** Agents this one may hand work to (enabled, not itself). */
  handoffTargets: HandoffTarget[];
  /** Queue a job for another agent (delivered via the hub, survives reconnects). */
  handoff(req: HandoffRequest): void;
  /** Job this run belongs to (for handoff parenting). */
  projectId: string | null;
  /** Runner-owned folder outside the workspace for screenshot baselines (null = no visual diff). */
  baselineDir: string | null;
  /** Send a file to the hub so the owner can see it in the UI. Returns the storage path. */
  uploadArtifact(name: string, data: Uint8Array, contentType: string): Promise<string>;
  /** Briefs, feature log and past drafts (Marketing only; null otherwise). */
  projectContext: ProjectContext | null;
  /** Hand a content draft to the hub for the owner's review (sequenced, applied once). */
  saveDraft(req: DraftRequest): void;
  /** Record a released feature (hub writes the feature log and emits feature.released). */
  addFeatureNote(req: { project_id: string; note: FeatureNoteData }): void;
  /** Live copy of this agent's memory stores (memory tool updates it as it goes). */
  memoryStores: { memory: string[]; user: string[] };
  memoryWriteApproval: boolean;
  /** Send memory ops to the hub (applied there, or staged when write approval is on). */
  saveMemory(target: "memory" | "user", ops: MemoryOp[]): void;
  /** Approved skills (name, description, full SKILL.md). */
  skills: { name: string; description: string; content: string }[];
  /** Propose a skill change; the owner approves it. */
  proposeSkill(p: { name: string; action: "create" | "patch" | "delete"; content: string; reason: string }): void;
  /** Full-text search over past runs (the hub answers). */
  searchSessions(query: string, allAgents: boolean): Promise<{ run_id: string; agent_id: string; job_type: string; ts: string; title: string; snippet: string }[]>;
  /** Web search through the hub (it holds the search API key). Throws when search is not set up. */
  webSearch(query: string, count: number): Promise<WebSearchResult[]>;
  /** Ask another agent (by slug) and wait for its answer, up to `timeoutMs`. Never throws. */
  consult(toAgent: string, question: string, timeoutMs: number): Promise<ConsultAnswer>;
}

export interface DraftRequest {
  project_id: string;
  platform: Platform;
  kind: DraftKind;
  title: string;
  body: string;
  self_check: SelfCheck;
}

export interface ToolOutput {
  ok: boolean;
  /** Short line for the event log / office view. */
  summary: string;
  /** What the model gets back. */
  output: unknown;
}

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  category: ToolCategory;
  input: S;
  /** Risk can depend on the input (e.g. allowlisted vs. arbitrary shell command). */
  risk(input: z.infer<S>, ctx: ToolContext): RiskLevel;
  /** One-line description of what this call will do (used for approvals). */
  describe(input: z.infer<S>): string;
  execute(input: z.infer<S>, ctx: ToolContext): Promise<ToolOutput>;
}

export const defineTool = <S extends z.ZodType>(def: ToolDef<S>): ToolDef<S> => def;

/** Thrown by safety guards. The message is safe to show to the model. */
export class ToolDenied extends Error {}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface ConsultAnswer {
  ok: boolean;
  answer: string;
  error?: string;
}
