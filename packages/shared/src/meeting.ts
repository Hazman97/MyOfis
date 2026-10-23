/**
 * Meeting recordings → readable transcript (Notulis, owner request 2026-10-23).
 *
 * whisper.cpp writes segments (a phrase with its start/end). On quiet meeting recordings whisper
 * sometimes "hears" text in silence, mostly YouTube outros ("Terima kasih kerana menonton!"), and
 * once it repeats a line it can loop on it for minutes. VAD and no carried context (runner side)
 * stop most of it; what is left is removed here. Times are seconds in the recording.
 */
export interface MeetingSegment {
  s: number;
  e: number;
  text: string;
}

/** Lines whisper invents in silence: video outros and channel plugs, never meeting content. */
const HALLUCINATION = /terima kasih kerana menonton|terima kasih kerana menyaksikan|sila (langgan|subscribe)|jangan lupa (like|subscribe|langgan)|like dan share|thanks? (you )?for watching|subtitles? by|amara\.org/i;

/** whisper-cli -oj output → segments (seconds). */
export function parseWhisperSegments(json: unknown): MeetingSegment[] {
  const j = json as { transcription?: { offsets?: { from?: number; to?: number }; text?: string }[] };
  return (j.transcription ?? []).map((seg) => ({
    s: Math.max(0, (seg.offsets?.from ?? 0) / 1000),
    e: Math.max(0, (seg.offsets?.to ?? 0) / 1000),
    text: (seg.text ?? "").trim(),
  }));
}

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Drop empty and bracket-only segments ([BLANK_AUDIO], (muzik)), invented outros, a segment equal to
 * the one before, and loops (the same line 3+ times among the last 6 kept).
 */
export function cleanSegments(segs: MeetingSegment[]): { segments: MeetingSegment[]; dropped: number } {
  const out: MeetingSegment[] = [];
  let dropped = 0;
  for (const seg of segs) {
    const text = seg.text.trim();
    const n = norm(text);
    const recent = out.slice(-6).map((x) => norm(x.text));
    const loop = recent.filter((r) => r === n).length >= 2;
    if (!n || /^[[(].*[\])]$/.test(text) || HALLUCINATION.test(text) || recent.at(-1) === n || loop) {
      dropped++;
      continue;
    }
    out.push({ ...seg, text });
  }
  return { segments: out, dropped };
}

/** 75 → "01:15", 3725 → "1:02:05". */
export function stamp(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Paragraphs of about `every` seconds, each starting with its time: "[12:30] line line line". */
export function formatTranscript(segs: MeetingSegment[], every = 60): string {
  const paras: string[] = [];
  let start = -Infinity;
  let cur: string[] = [];
  for (const seg of segs) {
    if (seg.s - start >= every && cur.length) {
      paras.push(cur.join(" "));
      cur = [];
    }
    if (!cur.length) {
      start = seg.s;
      cur.push(`[${stamp(seg.s)}]`);
    }
    cur.push(seg.text);
  }
  if (cur.length) paras.push(cur.join(" "));
  return paras.join("\n");
}

/** Split a long transcript into parts of at most `max` characters, at paragraph ends. */
export function transcriptParts(text: string, max = 40_000): string[] {
  const parts: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur && cur.length + line.length + 1 > max) {
      parts.push(cur);
      cur = "";
    }
    // one paragraph longer than a part (no times for a long stretch): cut it hard
    for (let rest = line; rest.length; ) {
      const room = max - (cur ? cur.length + 1 : 0);
      if (rest.length <= room) {
        cur = cur ? `${cur}\n${rest}` : rest;
        break;
      }
      parts.push(cur ? `${cur}\n${rest.slice(0, room)}` : rest.slice(0, room));
      cur = "";
      rest = rest.slice(room);
    }
  }
  if (cur) parts.push(cur);
  return parts.length ? parts : [""];
}
