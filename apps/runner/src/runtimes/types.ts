import type { RunAssignment, RunnerEventBody } from "@agent-office/shared";
import type { FeatureNoteData, MemoryOp, RenderInfo } from "@agent-office/shared";
import type { ApprovalRequest, ConsultAnswer, DraftRequest, HandoffRequest, WebSearchResult } from "@agent-office/tools";

export interface RunContext {
  assignment: RunAssignment;
  /** Absolute path of this run's private working directory. */
  workspace: string;
  signal: AbortSignal;
  emit(event: RunnerEventBody): void;
  /** Ask the owner (via the hub). Resolves true on approve; rejects if the run is cancelled. */
  requestApproval(req: ApprovalRequest): Promise<boolean>;
  /** Queue a job for another agent (sent through the hub). */
  handoff(req: HandoffRequest): void;
  /** Upload a file to the hub for the owner to view; returns its storage path. */
  uploadArtifact(name: string, data: Uint8Array, contentType: string): Promise<string>;
  /** Send a content draft to the hub (Marketing). */
  saveDraft(req: DraftRequest): void;
  /** Send a released-feature note to the hub (Coder). */
  addFeatureNote(req: { project_id: string; note: FeatureNoteData }): void;
  saveMemory(target: "memory" | "user", ops: MemoryOp[]): void;
  proposeSkill(p: { name: string; action: "create" | "patch" | "delete"; content: string; reason: string }): void;
  searchSessions(query: string, allAgents: boolean): Promise<{ run_id: string; agent_id: string; job_type: string; ts: string; title: string; snippet: string }[]>;
  /** Web search through the hub (it holds the search API key). Throws when search is not set up. */
  webSearch(query: string, count: number): Promise<WebSearchResult[]>;
  /** Bytes of a photo the owner attached to this job. */
  fetchUpload(id: string): Promise<Uint8Array>;
  /** Save an attached file (a video) to `dest`, streamed. */
  downloadUpload(id: string, dest: string): Promise<void>;
  /** Send a finished video to the hub in parts; returns the new upload. */
  uploadVideo(path: string, name: string, render?: RenderInfo): Promise<{ id: string; size: number }>;
  /** Project documents and log (Project Assistant), answered by the hub. */
  projectData(action: string, params: Record<string, unknown>): Promise<unknown>;
  videoData(action: string, params: Record<string, unknown>): Promise<unknown>;
  /** Data a project's website shares with Agent Office (through the hub, which holds its secret). */
  siteData(projectId: string, resource: "bookings", params: Record<string, string>): Promise<unknown>;
  webPost(action: "update" | "take_down", draftId: string, edits: { title?: string; body?: string; meta?: Record<string, unknown> }): Promise<unknown>;
  /** Ask another agent (by slug) and wait for its answer, up to `timeoutMs`. Never throws. */
  consult(toAgent: string, question: string, timeoutMs: number): Promise<ConsultAnswer>;
  /** Runner-owned folder (outside the workspace) for this agent's screenshot baselines. */
  baselineDir: string | null;
}

export interface RunResult {
  tokens_in: number;
  tokens_out: number;
}

/** Throw this to fail a run while still reporting the tokens it already used. */
export class RunError extends Error {
  constructor(
    message: string,
    readonly tokens: RunResult,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

/**
 * One execution strategy (Vercel AI SDK tool loop, mock echo).
 * Throw to fail the run; if `signal` is aborted the run is reported as cancelled.
 */
export interface AgentRuntime {
  readonly id: string;
  execute(ctx: RunContext): Promise<RunResult>;
}
