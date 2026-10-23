import { appendFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { MAX_VIDEO_BYTES, MEDIA_TYPES, UPLOAD_PART_BYTES, mediaTypeFromName } from "@agent-office/shared";
import type { Publisher } from "./publisher.ts";
import { HttpError } from "./repo.ts";

const KEY = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_PENDING = 20;
const PENDING_TTL_MS = 60 * 60_000;

interface Pending {
  name: string;
  type: string;
  total: number;
  received: number;
  path: string;
  touched: number;
}

/**
 * Videos and sound recordings arrive in parts (≤ UPLOAD_PART_BYTES each) because Cloudflare refuses request bodies over
 * 100 MB. The client picks a random key and sends each part with its byte offset; a part that was
 * already received is ignored (safe retry), and a gap answers 409 with what we have so the client
 * can resume. When the last byte arrives the file becomes a normal upload.
 */
export class UploadParts {
  readonly #pending = new Map<string, Pending>();

  constructor(
    private readonly publisher: Publisher,
    private readonly filesDir: string,
  ) {}

  put(
    owner: string,
    key: string,
    p: { name: string; content_type: string; total: number; offset: number },
    bytes: Uint8Array,
    runId: string | null = null,
    workspaceId = "owner",
  ): { received: number; total: number; upload?: ReturnType<Publisher["adoptUpload"]> } {
    this.#sweep();
    if (!KEY.test(key)) throw new HttpError(400, "invalid upload key");
    // phones and some browsers send no type (or octet-stream) for .m4a, .opus, .mkv: go by the name
    if (!MEDIA_TYPES[p.content_type]) p = { ...p, content_type: mediaTypeFromName(p.name) ?? p.content_type };
    if (!MEDIA_TYPES[p.content_type]) throw new HttpError(400, "only videos (MP4, MOV, WebM, MKV) or recordings (M4A, MP3, WAV, OGG/Opus, AAC, FLAC) are sent in parts");
    if (!Number.isSafeInteger(p.total) || p.total < 1 || p.total > MAX_VIDEO_BYTES) throw new HttpError(400, `the file must be under ${MAX_VIDEO_BYTES / 1024 ** 3} GB`);
    if (bytes.length > UPLOAD_PART_BYTES) throw new HttpError(400, "part too large");
    const id = `${owner}:${key}`;
    let cur = this.#pending.get(id);
    if (!cur) {
      if (p.offset !== 0) throw new HttpError(409, "upload not found: start again from 0");
      if (this.#pending.size >= MAX_PENDING) throw new HttpError(429, "too many uploads in progress");
      const dir = join(this.filesDir, "uploads");
      mkdirSync(dir, { recursive: true });
      cur = { name: p.name, type: p.content_type, total: p.total, received: 0, path: join(dir, `${key}.part`), touched: Date.now() };
      rmSync(cur.path, { force: true });
      this.#pending.set(id, cur);
    }
    if (cur.total !== p.total || cur.type !== p.content_type) throw new HttpError(409, "this upload key is already used for another file");
    cur.touched = Date.now();
    // a retried part we already have
    if (p.offset + bytes.length <= cur.received) return { received: cur.received, total: cur.total };
    if (p.offset !== cur.received) throw new HttpError(409, `expected offset ${cur.received}`);
    if (cur.received + bytes.length > cur.total) {
      this.#drop(id);
      throw new HttpError(400, "more bytes than the declared size");
    }
    if (!bytes.length) throw new HttpError(400, "empty part");
    appendFileSync(cur.path, bytes);
    cur.received += bytes.length;
    if (cur.received < cur.total) return { received: cur.received, total: cur.total };
    this.#pending.delete(id);
    if (statSync(cur.path).size !== cur.total) {
      rmSync(cur.path, { force: true });
      throw new HttpError(400, "upload size mismatch, send it again");
    }
    return { received: cur.received, total: cur.total, upload: this.publisher.adoptUpload(cur.name, cur.type, cur.path, runId, workspaceId) };
  }

  #drop(id: string) {
    const cur = this.#pending.get(id);
    this.#pending.delete(id);
    if (cur) rmSync(cur.path, { force: true });
  }

  #sweep() {
    const now = Date.now();
    for (const [id, p] of this.#pending) if (now - p.touched > PENDING_TTL_MS) this.#drop(id);
  }
}

/**
 * Serve a file from disk, with HTTP Range support so the browser's video player can seek
 * (and Telegram / the runner can stream big files without loading them into memory).
 */
export function fileResponse(path: string, type: string, range: string | undefined, headers: Record<string, string> = {}): Response {
  if (!existsSync(path)) throw new HttpError(404, "not found");
  const file = Bun.file(path);
  const size = file.size;
  const base = { "content-type": type, "accept-ranges": "bytes", "x-content-type-options": "nosniff", ...headers };
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    let end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${size}` } });
    start = Math.max(0, start);
    end = Math.max(start, end);
    return new Response(file.slice(start, end + 1), { status: 206, headers: { ...base, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  }
  return new Response(file, { headers: { ...base, "content-length": String(size) } });
}
