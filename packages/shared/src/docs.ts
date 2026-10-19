import { z } from "zod";

/**
 * Project documents and the project log (Project Assistant, 2026-10-19). Documents the owner sends
 * (minutes, brochures, specs) are read on the owner's PC and kept per project; the log holds the
 * decisions, action items and dates the assistant (or the owner) records.
 */
export const DOC_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "text/markdown": "md",
};
export const MAX_DOC_BYTES = 25 * 1024 * 1024;
export const isDocType = (type: string) => type in DOC_TYPES;

export const LogKind = z.enum(["decision", "action", "meeting", "risk", "date", "note"]);
export type LogKind = z.infer<typeof LogKind>;

export const LogEntryInput = z.object({
  kind: LogKind,
  text: z.string().trim().min(3).max(600),
  /** Who does it (actions), e.g. "Hazman", "Irfan", "MARDI". */
  owner: z.string().trim().max(80).default(""),
  /** YYYY-MM-DD, for actions and dates. */
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  source_doc_id: z.string().max(64).nullable().default(null),
});
export type LogEntryInput = z.input<typeof LogEntryInput>;

export interface LogEntry {
  id: string;
  project_id: string | null;
  kind: LogKind;
  text: string;
  owner: string;
  due_date: string | null;
  status: "open" | "done";
  source_doc_id: string | null;
  created_at: string;
  done_at: string | null;
}

export interface ProjectDoc {
  id: string;
  project_id: string | null;
  upload_id: string;
  title: string;
  content_type: string;
  pages: number;
  chars: number;
  summary: string;
  created_at: string;
}

export interface DocHit {
  doc_id: string;
  title: string;
  page: number;
  snippet: string;
}
