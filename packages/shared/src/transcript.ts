import { z } from "zod";
import { EditPlan, transitionsForCuts, transitionSeconds, type Clip } from "./video.ts";

/**
 * Speech in a video, word by word (whisper.cpp on the runner PC). Editor reads it to suggest
 * edits ("cut the ums and pauses", "a 30 s highlight from these lines"); the Video Studio shows it
 * and builds subtitles and tight cuts from it without the AI. Times are seconds in the source video.
 */
export const TranscriptWord = z.object({ w: z.string(), s: z.number().min(0), e: z.number().min(0) });
export type TranscriptWord = z.infer<typeof TranscriptWord>;

export const Transcript = z.object({
  language: z.string().max(16),
  duration: z.number().min(0),
  model: z.string().max(80),
  words: z.array(TranscriptWord).max(60_000),
  /** Quiet stretches measured on the sound itself (ffmpeg silencedetect): whisper's word times run
   *  into each other, so pauses come from here. */
  silences: z.array(z.object({ s: z.number().min(0), e: z.number().min(0) })).max(20_000).optional(),
});
export type Transcript = z.infer<typeof Transcript>;

/** Hesitation sounds (English and Malay speakers), never real words. */
const FILLERS = new Set(["um", "umm", "uhm", "uh", "uhh", "er", "erm", "em", "emm", "hmm", "hm", "mm", "mmm", "ah", "aah", "eh", "ehh", "aa", "aaa"]);
const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export const isFiller = (w: string) => FILLERS.has(bare(w));

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The transcript as short timed lines, for the model to read (a few KB even for long talks).
 * Fillers are shown as {um}; pauses of a second or more get their own line.
 */
export function packTranscript(t: Transcript, video: number, maxChars = 12_000): string {
  const head = `Video ${video} · ${r1(t.duration)}s · language ${t.language}`;
  if (!t.words.length) return `${head}\n(no speech found)`;
  const lines: string[] = [head];
  let phrase: TranscriptWord[] = [];
  const flush = () => {
    if (!phrase.length) return;
    const text = phrase.map((x) => (isFiller(x.w) ? `{${bare(x.w)}}` : x.w)).join(" ");
    lines.push(`[${r1(phrase[0]!.s)}–${r1(phrase.at(-1)!.e)}] ${text}`);
    phrase = [];
  };
  const pauses = (t.silences ?? []).filter((p) => p.e - p.s >= 0.5);
  t.words.forEach((x, i) => {
    const prev = t.words[i - 1];
    // a measured silence between the two words, else the gap in the word times
    // (whisper often stretches a word over the pause after it, so look from the previous word's start)
    const quiet = prev ? pauses.find((p) => p.s >= prev.s && (p.s + p.e) / 2 <= x.s) : undefined;
    const gap = quiet ? quiet.e - quiet.s : prev ? x.s - prev.e : 0;
    if (prev && (gap >= 0.5 || /[.?!]$/.test(prev.w) || phrase.length >= 14)) flush();
    if (gap >= 1) lines.push(`(pause ${r1(gap)}s)`);
    phrase.push(x);
  });
  flush();
  let out = lines.join("\n");
  if (out.length > maxChars) out = `${out.slice(0, maxChars)}\n… (transcript cut here; ${t.words.length} words in all)`;
  return out;
}

export interface TightOptions {
  /** A silence at least this long (seconds) is cut out. */
  min_pause?: number;
  /** Seconds of air kept before and after speech. */
  pad?: number;
  drop_fillers?: boolean;
  /** Only this part of the video. */
  from?: number;
  to?: number;
}

/**
 * Clips that keep the speech and drop long pauses and fillers: a "tight cut". Pauses come from the
 * measured silences (and gaps in the word times); fillers are always cut, however short. At most 80 clips.
 */
export function tightCuts(t: Transcript, video: number, opts: TightOptions = {}): Clip[] {
  const { min_pause = 0.6, pad = 0.12, drop_fillers = true, from = 0, to = t.duration } = opts;
  const words = t.words.filter((x) => x.e > from && x.s < to && x.e > x.s);
  const speech = drop_fillers ? words.filter((x) => !isFiller(x.w)) : words;
  if (!speech.length) return [{ video, start: r2(from), end: r2(to), speed: 1, zoom: "none" }];
  const cuts: [number, number][] = [];
  const quiet = (s: number, e: number) => e - s >= min_pause && cuts.push([s + pad, e - pad]);
  for (const p of t.silences ?? []) quiet(Math.max(from, p.s), Math.min(to, p.e));
  for (let i = 1; i < speech.length; i++) quiet(speech[i - 1]!.e, speech[i]!.s);
  quiet(from - pad, speech[0]!.s);
  quiet(speech.at(-1)!.e, to + pad);
  if (drop_fillers) for (const x of words) if (isFiller(x.w)) cuts.push([x.s, x.e]);
  // merge the cuts, then keep what is between them
  const merged: [number, number][] = [];
  for (const c of cuts.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && c[0] <= last[1] + 0.05) last[1] = Math.max(last[1], c[1]);
    else merged.push([c[0], c[1]]);
  }
  let keep: [number, number][] = [];
  let at = from;
  for (const [s, e] of merged) {
    if (s > at) keep.push([at, Math.min(s, to)]);
    at = Math.max(at, e);
  }
  if (at < to) keep.push([at, to]);
  keep = keep.filter(([s, e]) => e - s >= 0.15);
  // too many pieces: put back the shortest cuts first
  while (keep.length > 80) {
    let k = 0;
    for (let i = 1; i < keep.length - 1; i++) if (keep[i + 1]![0] - keep[i]![1] < keep[k + 1]![0] - keep[k]![1]) k = i;
    keep[k]![1] = keep[k + 1]![1];
    keep.splice(k + 1, 1);
  }
  return keep.map(([s, e]) => ({ video, start: r2(s), end: r2(e), speed: 1, zoom: "none" as const }));
}

export interface SubtitleCue {
  text: string;
  start: number;
  end: number;
}

/**
 * Subtitles in the FINISHED video's time: the words that fall inside each clip, shifted by where
 * the clip lands and its speed. `transcripts[n]` is the transcript of file n (1-based), when known.
 */
export function subtitleCues(
  plan: Pick<EditPlan, "clips" | "subtitles"> & Partial<Pick<EditPlan, "transition">>,
  transcripts: Record<number, Transcript | undefined>,
  durations: Record<number, number> = {},
): SubtitleCue[] {
  const sub = plan.subtitles;
  if (!sub) return [];
  const per = sub.style === "pop" ? 2 : 6;
  const cues: SubtitleCue[] = [];
  // with transitions every cut overlaps the clips, so later clips start earlier
  const lengths = plan.clips.map((c) => Math.max(0, (c.end ?? durations[c.video] ?? transcripts[c.video]?.duration ?? c.start) - c.start) / c.speed);
  const cuts = plan.transition ? transitionsForCuts({ transition: plan.transition }, lengths) : [];
  let offset = 0;
  for (let idx = 0; idx < plan.clips.length; idx++) {
    const c = plan.clips[idx]!;
    const t = transcripts[c.video];
    const end = c.end ?? durations[c.video] ?? t?.duration ?? c.start;
    let cue: TranscriptWord[] = [];
    const push = () => {
      if (!cue.length) return;
      const text = cue.map((x) => x.w).join(" ").replace(/\s+([,.?!])/g, "$1");
      const at = (s: number) => r2(offset + (s - c.start) / c.speed);
      cues.push({ text: sub.uppercase ? text.toUpperCase() : text, start: at(cue[0]!.s), end: Math.max(at(cue.at(-1)!.e), at(cue[0]!.s) + 0.3) });
      cue = [];
    };
    for (const x of t?.words ?? []) {
      const mid = (x.s + x.e) / 2;
      if (mid < c.start || mid > end || isFiller(x.w) || !x.w.trim()) continue;
      const prev = cue.at(-1);
      if (prev && (cue.length >= per || x.s - prev.e > 0.4 || /[.?!]$/.test(prev.w))) push();
      cue.push({ ...x, s: Math.max(x.s, c.start), e: Math.min(x.e, end) });
    }
    push();
    offset += Math.max(0, end - c.start) / c.speed - (cuts[idx]?.seconds ?? 0);
  }
  return cues;
}

// ---------------------------------------------------------------- Editor's suggestions (tool suggest_edits)

export const EditSuggestion = z.object({
  key: z.string().regex(/^[A-D]$/).describe("A, B, C or D"),
  title: z.string().trim().min(1).max(80).describe("e.g. 'Tight cut + subtitles (52 s)'"),
  why: z.string().trim().min(1).max(400).describe("One or two sentences: what it keeps and who it suits"),
  plan: EditPlan,
});
export type EditSuggestion = z.infer<typeof EditSuggestion>;

export const EditSuggestionsInput = z.object({
  intro: z.string().trim().min(1).max(600).describe("What you saw in the video, in one or two sentences"),
  options: z.array(EditSuggestion).min(1).max(4),
});
export type EditSuggestionsInput = z.infer<typeof EditSuggestionsInput>;

/** Stored suggestions, as the chat and the Video Studio receive them. */
export interface EditSuggestions extends EditSuggestionsInput {
  id: string;
  run_id: string;
  /** The job's files in order: plan.clips[].video points into this list (1-based). */
  attachments: { id: string; name: string; content_type: string }[];
  created_at: string;
}
