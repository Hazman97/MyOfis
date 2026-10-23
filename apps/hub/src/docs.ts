import { and, asc, desc, eq, lte, or } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import { DOC_TYPES, LogEntryInput, dayKey, type DocHit, type LogEntry, type ProjectDoc } from "@agent-office/shared";
import type { Db } from "./db/client.ts";
import { projectDocs, projectLog, projects } from "./db/schema.ts";
import { cleanUploadName, type Publisher } from "./publisher.ts";
import { HttpError, newId } from "./repo.ts";

/**
 * Project documents + project log (Project Assistant, owner request 2026-10-19).
 *
 * A document (PDF, DOCX, TXT, MD) sent in chat or Telegram is read here, on the owner's PC: its
 * text is split per page (PDF) or per ~3,500 characters (others) and indexed in the FTS table
 * `docs_index`, so the assistant can search every file of a project and quote the page. Nothing
 * leaves the PC except the passages the assistant reads into its own prompt.
 */
const CHUNK = 3500;
const READ_MAX = 20_000;

export class Docs {
  constructor(
    private readonly db: Db,
    private readonly publisher: Publisher,
  ) {}

  #sqlite() {
    return (this.db as unknown as { $client: import("bun:sqlite").Database }).$client;
  }

  /** Read and index an uploaded document once (the same upload is not indexed twice). */
  async ingest(uploadId: string, ws: string, projectId: string | null): Promise<ProjectDoc> {
    const existing = this.db.select().from(projectDocs).where(eq(projectDocs.upload_id, uploadId)).get();
    if (existing) return toDoc(existing);
    const f = this.publisher.readUpload(uploadId);
    if (!f || f.row.workspace_id !== ws) throw new HttpError(404, "upload not found");
    if (!DOC_TYPES[f.row.content_type]) throw new HttpError(400, "not a document (PDF, DOCX, TXT or MD)");
    if (projectId && !this.db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.workspace_id, ws))).get()) {
      throw new HttpError(400, "unknown project");
    }
    const pages = await extractPages(f.row.content_type, new Uint8Array(f.bytes));
    const chars = pages.reduce((n, p) => n + p.length, 0);
    const row = this.db
      .insert(projectDocs)
      .values({ id: newId("doc"), workspace_id: ws, project_id: projectId, upload_id: uploadId, title: f.row.name, content_type: f.row.content_type, pages: pages.length, chars })
      .returning()
      .get();
    const insert = this.#sqlite().query("INSERT INTO docs_index (doc_id, workspace_id, project_id, page, title, body) VALUES (?, ?, ?, ?, ?, ?)");
    pages.forEach((text, i) => insert.run(row.id, ws, projectId ?? "", i + 1, f.row.name, text));
    return toDoc(row);
  }

  /** A text an agent wrote (meeting notes) or made (a transcript), kept as a project document like an upload. */
  async saveText(ws: string, projectId: string | null, title: string, text: string, ext: "md" | "txt"): Promise<ProjectDoc> {
    const up = this.publisher.saveUpload(`${title.slice(0, 110)}.${ext}`, ext === "md" ? "text/markdown" : "text/plain", new TextEncoder().encode(text), ws);
    return this.ingest(up.id, ws, projectId);
  }

  /** The newest document of this room saved with this title (saveText), with its whole text. */
  findByTitle(title: string, ws: string): { doc: ProjectDoc; text: string } | null {
    const names = (["txt", "md"] as const).map((ext) => cleanUploadName(`${title.slice(0, 110)}.${ext}`));
    const row = this.db
      .select()
      .from(projectDocs)
      .where(and(eq(projectDocs.workspace_id, ws), or(...names.map((n) => eq(projectDocs.title, n)))))
      .orderBy(desc(projectDocs.created_at))
      .get();
    if (!row) return null;
    const pages = this.#sqlite().query("SELECT body FROM docs_index WHERE doc_id = ? ORDER BY page").all(row.id) as { body: string }[];
    return { doc: toDoc(row), text: pages.map((p) => p.body).join("\n") };
  }

  list(ws: string, projectId?: string | null): ProjectDoc[] {
    const mine = eq(projectDocs.workspace_id, ws);
    return this.db
      .select()
      .from(projectDocs)
      .where(projectId ? and(mine, eq(projectDocs.project_id, projectId)) : mine)
      .orderBy(desc(projectDocs.created_at))
      .all()
      .map(toDoc);
  }

  doc(id: string, ws: string): ProjectDoc {
    const row = this.db.select().from(projectDocs).where(and(eq(projectDocs.id, id), eq(projectDocs.workspace_id, ws))).get();
    if (!row) throw new HttpError(404, "document not found");
    return toDoc(row);
  }

  setSummary(id: string, ws: string, summary: string): ProjectDoc {
    this.doc(id, ws);
    this.db.update(projectDocs).set({ summary: summary.slice(0, 4000) }).where(eq(projectDocs.id, id)).run();
    return this.doc(id, ws);
  }

  /** Words only, each quoted: user text never becomes FTS syntax. Optionally one project's documents. */
  search(query: string, ws: string, projectId: string | null = null, limit = 8): DocHit[] {
    const terms = query.match(/[\p{L}\p{N}]{2,}/gu)?.slice(0, 12) ?? [];
    if (!terms.length) return [];
    const match = terms.map((t) => `"${t}"`).join(" OR ");
    const where = projectId ? "docs_index MATCH ? AND workspace_id = ? AND project_id = ?" : "docs_index MATCH ? AND workspace_id = ?";
    const args = projectId ? [match, ws, projectId] : [match, ws];
    return this.#sqlite()
      .query(`SELECT doc_id, title, page, snippet(docs_index, 5, '[', ']', ' … ', 30) AS snippet FROM docs_index WHERE ${where} ORDER BY rank LIMIT ${Math.min(limit, 20)}`)
      .all(...args) as DocHit[];
  }

  /** The text of some pages (1-based, inclusive), capped. */
  read(id: string, ws: string, from = 1, to = from + 4): { doc: ProjectDoc; text: string; truncated: boolean } {
    const doc = this.doc(id, ws);
    const rows = this.#sqlite()
      .query("SELECT page, body FROM docs_index WHERE doc_id = ? AND workspace_id = ? AND page >= ? AND page <= ? ORDER BY page")
      .all(id, ws, from, Math.min(to, from + 30)) as { page: number; body: string }[];
    let text = rows.map((r) => `--- page ${r.page} ---\n${r.body}`).join("\n\n");
    const truncated = text.length > READ_MAX;
    if (truncated) text = text.slice(0, READ_MAX);
    return { doc, text, truncated };
  }

  // ---------------------------------------------------------------- project log

  addLog(ws: string, projectId: string | null, input: LogEntryInput, agentId: string | null = null): LogEntry {
    const e = LogEntryInput.parse(input);
    if (e.source_doc_id) this.doc(e.source_doc_id, ws);
    const row = this.db
      .insert(projectLog)
      .values({ id: newId("log"), workspace_id: ws, project_id: projectId, kind: e.kind, text: e.text, owner: e.owner, due_date: e.due_date, source_doc_id: e.source_doc_id, agent_id: agentId })
      .returning()
      .get();
    return toLog(row);
  }

  log(ws: string, filter: { project_id?: string | null; status?: "open" | "done"; kind?: string } = {}): LogEntry[] {
    const conds = [eq(projectLog.workspace_id, ws)];
    if (filter.project_id) conds.push(eq(projectLog.project_id, filter.project_id));
    if (filter.status) conds.push(eq(projectLog.status, filter.status));
    if (filter.kind) conds.push(eq(projectLog.kind, filter.kind as LogEntry["kind"]));
    return this.db
      .select()
      .from(projectLog)
      .where(and(...conds))
      .orderBy(asc(projectLog.status), asc(projectLog.due_date), desc(projectLog.created_at))
      .limit(300)
      .all()
      .map(toLog);
  }

  updateLog(id: string, ws: string, patch: { status?: "open" | "done"; text?: string; owner?: string; due_date?: string | null }): LogEntry {
    const row = this.db.select().from(projectLog).where(and(eq(projectLog.id, id), eq(projectLog.workspace_id, ws))).get();
    if (!row) throw new HttpError(404, "log entry not found");
    const set: Partial<typeof projectLog.$inferInsert> = {};
    if (patch.status) {
      set.status = patch.status;
      set.done_at = patch.status === "done" ? new Date().toISOString() : null;
    }
    if (patch.text !== undefined) set.text = patch.text.trim().slice(0, 600);
    if (patch.owner !== undefined) set.owner = patch.owner.trim().slice(0, 80);
    if (patch.due_date !== undefined) {
      if (patch.due_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(patch.due_date)) throw new HttpError(400, "due_date must be YYYY-MM-DD");
      set.due_date = patch.due_date;
    }
    return toLog(this.db.update(projectLog).set(set).where(eq(projectLog.id, id)).returning().get()!);
  }

  /** Open actions and dates due within `days` (or overdue), for the morning reminder. */
  dueSoon(ws: string, days = 2, now = new Date()): LogEntry[] {
    const until = dayKey(new Date(now.getTime() + days * 86_400_000).toISOString());
    return this.db
      .select()
      .from(projectLog)
      .where(and(eq(projectLog.workspace_id, ws), eq(projectLog.status, "open"), or(eq(projectLog.kind, "action"), eq(projectLog.kind, "date")), lte(projectLog.due_date, until)))
      .orderBy(asc(projectLog.due_date))
      .all()
      .filter((r) => r.due_date)
      .map(toLog);
  }

  /** Facts for the weekly status (job type "project_status"): open items, recent documents and decisions. */
  statusFacts(ws: string, projectId: string | null, now = new Date()) {
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const inProject = <T extends { project_id: string | null }>(r: T) => !projectId || r.project_id === projectId;
    const all = this.log(ws).filter(inProject);
    const today = dayKey(now.toISOString());
    return {
      today,
      open_actions: all.filter((e) => e.status === "open" && e.kind === "action").map((e) => ({ text: e.text, owner: e.owner, due: e.due_date, overdue: !!e.due_date && e.due_date < today })),
      upcoming_dates: all.filter((e) => e.status === "open" && e.kind === "date").map((e) => ({ text: e.text, date: e.due_date })),
      done_this_week: all.filter((e) => e.status === "done" && (e.done_at ?? "") >= weekAgo).map((e) => e.text),
      decisions_this_week: all.filter((e) => e.kind === "decision" && e.created_at >= weekAgo).map((e) => e.text),
      risks: all.filter((e) => e.kind === "risk" && e.status === "open").map((e) => e.text),
      new_documents: this.list(ws).filter((d) => inProject(d) && d.created_at >= weekAgo).map((d) => ({ title: d.title, pages: d.pages, summary: d.summary.slice(0, 400) })),
    };
  }
}

/** Text per page (PDF) or per chunk (DOCX, TXT, MD). */
export async function extractPages(type: string, bytes: Uint8Array): Promise<string[]> {
  const ext = DOC_TYPES[type];
  let pages: string[];
  if (ext === "pdf") {
    const pdf = await getDocumentProxy(bytes).catch(() => {
      throw new HttpError(400, "could not read this PDF (damaged or password-protected?)");
    });
    const r = await extractText(pdf, { mergePages: false });
    pages = (r.text as string[]).map((t) => t.replace(/[ \t]+\n/g, "\n").trim());
    if (!pages.join("").trim()) throw new HttpError(400, "this PDF has no text layer (a scan?): send the original file, or a photo of each page");
  } else {
    const text = ext === "docx" ? (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value : new TextDecoder().decode(bytes);
    pages = chunk(text.trim(), CHUNK);
  }
  return pages.length ? pages : [""];
}

function chunk(text: string, size: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    const cut = rest.lastIndexOf("\n", size) > size * 0.5 ? rest.lastIndexOf("\n", size) : size;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut);
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}

const toDoc = (r: typeof projectDocs.$inferSelect): ProjectDoc => ({
  id: r.id,
  project_id: r.project_id,
  upload_id: r.upload_id,
  title: r.title,
  content_type: r.content_type,
  pages: r.pages,
  chars: r.chars,
  summary: r.summary,
  created_at: r.created_at,
});

const toLog = (r: typeof projectLog.$inferSelect): LogEntry => ({
  id: r.id,
  project_id: r.project_id,
  kind: r.kind,
  text: r.text,
  owner: r.owner,
  due_date: r.due_date,
  status: r.status,
  source_doc_id: r.source_doc_id,
  created_at: r.created_at,
  done_at: r.done_at,
});

