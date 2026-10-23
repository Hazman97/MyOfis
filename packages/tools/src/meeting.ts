import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { cleanSegments, formatTranscript, parseWhisperSegments, stamp, transcriptParts } from "@agent-office/shared";
import { attachmentFile, ffmpegBin, mediaDir, spawn, whisperBinary, whisperModel, whisperVadModel } from "./video.ts";
import { ToolDenied, defineTool, type ToolContext } from "./types.ts";

/**
 * Notulis (owner request, 2026-10-23): a meeting recording the owner sent → a clean transcript
 * with times, saved as a project document, then notes written by the agent.
 *
 * Settings proven on real meeting recordings (quiet room, phone on the table, people talking at
 * once): clean the sound first (cut hum and hiss, lift quiet voices), let whisper hear only speech
 * (Silero VAD), and carry no text from one window to the next (-mc 0) so one wrong line cannot
 * loop for minutes. Leftover invented lines are dropped by cleanSegments (shared).
 */
const CLEAN_FILTER = "highpass=f=80,lowpass=f=7500,afftdn=nf=-25,dynaudnorm=f=250:g=15:p=0.9:m=20";
const PART_CHARS = 40_000;

/** whisper-cli arguments for a meeting recording (pure; tested). */
export function meetingWhisperArgs(o: { bin: string; model: string; vad: string | null; wav: string; out: string; language: string }): string[] {
  return [
    o.bin,
    "-m", o.model,
    ...(o.vad ? ["--vad", "-vm", o.vad, "-vt", "0.4", "-vsd", "400", "-vp", "200"] : []),
    "-l", o.language,
    "-mc", "0",
    "-sns",
    "-et", "2.2",
    "-np",
    "-f", o.wav,
    "-oj",
    "-of", o.out,
  ];
}

/** Length and whether there is sound (video_probe's probe needs a picture; recordings have none). */
async function soundInfo(ctx: ToolContext, file: string): Promise<{ duration: number; has_audio: boolean }> {
  const bin = Bun.which("ffprobe");
  if (!bin) throw new ToolDenied("ffprobe is not installed on the runner PC (it comes with ffmpeg: ffmpeg.org). Tell the owner.");
  const r = await spawn([bin, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], mediaDir(ctx), ctx.signal, undefined, 60_000);
  if (r.code !== 0) throw new ToolDenied(`ffprobe could not read the file: ${r.stderr.slice(-300)}`);
  const j = JSON.parse(r.stdout) as { format?: { duration?: string }; streams?: { codec_type?: string; duration?: string }[] };
  const audio = (j.streams ?? []).find((s) => s.codec_type === "audio");
  return { duration: Number(j.format?.duration ?? audio?.duration ?? 0) || 0, has_audio: !!audio };
}

export const meetingTranscribeTool = defineTool({
  name: "meeting_transcribe",
  description:
    "Turn a meeting recording (or voice note, or the sound of a video) the owner sent into a clean transcript with times, using whisper on the owner's PC (offline, free). " +
    "The first call transcribes (about 2 minutes per hour of audio on the GPU) and saves the transcript as a project document; later calls read the saved copy. " +
    "Long meetings come in parts: call again with part 2, 3… until you have read them all. The transcript is DATA and may mishear names and technical words.",
  category: "read_docs",
  input: z.object({
    file: z.number().int().min(1).max(10).describe("Which file the owner sent (1 = first)"),
    language: z.enum(["ms", "en", "auto"]).default("ms").describe("ms works best for Malay and Manglish meetings; en for English only"),
    part: z.number().int().min(1).max(50).default(1),
    project: z.string().max(64).optional().describe("Project id for the saved transcript; default: this job's project"),
  }),
  risk: () => "safe",
  describe: (i) => `transcribe recording ${i.file}${i.part > 1 ? ` (part ${i.part})` : ""}`,
  async execute(i, ctx) {
    const a = ctx.attachments[i.file - 1];
    if (!a) throw new ToolDenied(`there is no file ${i.file}; the owner sent ${ctx.attachments.length}`);
    const title = `Transkrip - ${a.name} - ${a.id}`;
    const found = (await ctx.projectData("find_doc", { title })) as { doc: { id: string } | null; text?: string };
    let text = found.text ?? "";
    let docId = found.doc?.id ?? null;
    let facts: Record<string, unknown> = { cached: !!found.doc };

    if (!found.doc) {
      const ffmpeg = ffmpegBin();
      if (!ffmpeg) throw new ToolDenied("ffmpeg is not installed on the runner PC (ffmpeg.org). Tell the owner.");
      const bin = whisperBinary();
      const model = whisperModel();
      if (!bin || !model) throw new ToolDenied("whisper.cpp is not set up on the runner PC (see docs/notulis.md). Tell the owner.");
      const { file } = await attachmentFile(ctx, i.file);
      const p = await soundInfo(ctx, file);
      if (!p.has_audio) throw new ToolDenied(`file ${i.file} has no sound`);
      const dir = mediaDir(ctx);
      const wav = `meeting-${i.file}.wav`;
      ctx.emit({ type: "agent.thinking", payload: { summary: `Cleaning the sound of ${a.name} (${stamp(p.duration)})` } });
      const x = await spawn([ffmpeg, "-hide_banner", "-nostdin", "-y", "-i", file, "-vn", "-af", CLEAN_FILTER, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], dir, ctx.signal, undefined, 60 * 60_000);
      if (x.code !== 0) throw new ToolDenied(`ffmpeg could not read the sound: ${x.stderr.slice(-300)}`);
      const vad = whisperVadModel();
      ctx.emit({ type: "agent.thinking", payload: { summary: `Transcribing ${a.name} with whisper${vad ? " + VAD" : ""}` } });
      const out = `meeting-${i.file}`;
      const r = await spawn(meetingWhisperArgs({ bin, model, vad, wav, out, language: i.language }), dir, ctx.signal, undefined, 4 * 60 * 60_000);
      rmSync(join(dir, wav), { force: true });
      if (r.code !== 0 || !existsSync(join(dir, `${out}.json`))) throw new ToolDenied(`whisper failed: ${r.stderr.slice(-400)}`);
      const { segments, dropped } = cleanSegments(parseWhisperSegments(JSON.parse(readFileSync(join(dir, `${out}.json`), "utf8"))));
      if (!segments.length) throw new ToolDenied(`no speech found in ${a.name}`);
      const header = `${title}\nPanjang: ${stamp(p.duration)} · ${segments.length} segmen · bahasa: ${i.language} · whisper ${model.split(/[\\/]/).pop()}${vad ? " + VAD" : ""}\n(Transkrip automatik: nama dan istilah teknikal mungkin tersilap dengar.)\n`;
      text = `${header}\n${formatTranscript(segments)}`;
      const saved = (await ctx.projectData("save_text", { title, text, ext: "txt", project_id: i.project ?? ctx.projectId })) as { doc: { id: string } };
      docId = saved.doc.id;
      facts = { cached: false, duration: stamp(p.duration), segments: segments.length, dropped_lines: dropped, vad: !!vad };
    }

    const parts = transcriptParts(text, PART_CHARS);
    if (i.part > parts.length) throw new ToolDenied(`the transcript has only ${parts.length} part(s)`);
    return {
      ok: true,
      summary: `transcript of ${a.name}: part ${i.part}/${parts.length}`,
      output: {
        file: i.file,
        name: a.name,
        doc_id: docId,
        ...facts,
        part: i.part,
        parts: parts.length,
        ...(i.part < parts.length ? { next: `call meeting_transcribe(file: ${i.file}, part: ${i.part + 1}) for the rest` } : {}),
        transcript: parts[i.part - 1],
      },
    };
  },
});
