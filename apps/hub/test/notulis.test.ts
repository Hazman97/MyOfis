import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freshFetch } from "@agent-office/shared";
import { meetingWhisperArgs } from "@agent-office/tools";
import { TOKEN, createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

let env: TestEnv;
afterEach(async () => {
  await env?.close();
});

/** Send a recording in parts like the web client; `type` "" = a browser that gives none (the hub goes by the name). */
async function sendRecording(bytes: Uint8Array, name: string, type = ""): Promise<{ id: string; content_type: string }> {
  const key = crypto.randomUUID().replace(/-/g, "");
  const q = new URLSearchParams({ name, total: String(bytes.length), offset: "0" });
  const res = await freshFetch(`${env.hub.url}/api/uploads/parts/${key}?${q}`, { method: "PUT", headers: { authorization: `Bearer ${TOKEN}`, "content-type": type || "application/octet-stream" }, body: bytes });
  expect(res.status).toBe(201);
  return ((await res.json()) as { upload: { id: string; content_type: string } }).upload;
}

describe("meeting whisper settings", () => {
  test("VAD when the model is there, no carried context, segments as JSON", () => {
    const args = meetingWhisperArgs({ bin: "w", model: "m.bin", vad: "v.bin", wav: "a.wav", out: "o", language: "ms" });
    expect(args.join(" ")).toBe("w -m m.bin --vad -vm v.bin -vt 0.4 -vsd 400 -vp 200 -l ms -mc 0 -sns -et 2.2 -np -f a.wav -oj -of o");
    expect(meetingWhisperArgs({ bin: "w", model: "m.bin", vad: null, wav: "a.wav", out: "o", language: "en" })).not.toContain("--vad");
  });
});

const ffmpeg = Bun.which("ffmpeg");
describe.skipIf(!ffmpeg || !Bun.which("ffprobe"))("Notulis: recording → transcript → notes", () => {
  let dir: string;
  let audio: Uint8Array;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "ao-hub-notulis-"));
    const code = await Bun.spawn([ffmpeg!, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=duration=3", "-c:a", "aac", "meeting.m4a"], { cwd: dir }).exited;
    expect(code).toBe(0);
    audio = new Uint8Array(readFileSync(join(dir, "meeting.m4a")));
    // a fake whisper-cli (the real one needs a 500 MB model) and dummy model files
    const fake = join(dir, process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli");
    expect(Bun.spawnSync(["bun", "build", "--compile", join(import.meta.dir, "fakeWhisper.ts"), "--outfile", fake]).exitCode).toBe(0);
    await Bun.write(join(dir, "ggml-test.bin"), "x");
    await Bun.write(join(dir, "ggml-silero-test.bin"), "x");
    process.env.WHISPER_CPP = fake;
    process.env.WHISPER_MODEL = join(dir, "ggml-test.bin");
    process.env.WHISPER_VAD_MODEL = join(dir, "ggml-silero-test.bin");
  }, 120_000);
  afterAll(() => {
    delete process.env.WHISPER_CPP;
    delete process.env.WHISPER_MODEL;
    delete process.env.WHISPER_VAD_MODEL;
    rmSync(dir, { recursive: true, force: true });
  });

  test("a recording sent in chat is transcribed once, cleaned, saved as a document; notes + log follow", async () => {
    env = await createTestEnv();
    await env.pairRunner();
    const hub = env.hub.hub;
    const project = (await env.api("/api/projects", { body: { slug: "cowbarn", name: "CowBarn MARDI Muadzam Shah" } })).body.project;
    const rec = await sendRecording(audio, "Software part.m4a");
    expect(rec.content_type).toBe("audio/mp4");

    const notulis = ((await env.api("/api/agents")).body.agents as { id: string; slug: string; tools: string[] }[]).find((a) => a.slug === "notulis")!;
    expect(notulis.tools).toEqual(expect.arrayContaining(["meeting_transcribe", "doc_save", "project_log_add"]));
    await env.api(`/api/agents/${notulis.id}`, { method: "PATCH", body: { provider: "mock", model: "mock-script", config: { self_review: false } } });

    const notes = "# CowBarn - Nota Mesyuarat (2026-10-22)\n\n## Ringkasan\n- Misting jadi 4 line.\n- Role: Admin dan User.";
    const script = [
      { tool: "meeting_transcribe", input: { file: 1 } },
      { tool: "meeting_transcribe", input: { file: 1, part: 2 } },
      { tool: "doc_save", input: { title: "Nota mesyuarat 2026-10-22 — CowBarn", text: notes } },
      { tool: "project_log_add", input: { entries: [{ kind: "decision", text: "Misting 4 line, 2 setiap zon" }] } },
      { text: notes },
    ];
    const attachments = [{ id: rec.id, name: "Software part.m4a", content_type: rec.content_type }];
    const job = (await env.api("/api/jobs", { body: { agent_id: notulis.id, project_id: project.id, title: "nota", input: { script, attachments } } })).body.job;
    await waitFor(() => ["done", "failed"].includes(hub.store.state.jobs[job.id]?.status ?? ""), 120_000, "notulis run");
    expect(hub.store.state.jobs[job.id]?.status).toBe("done");
    const runId = hub.store.state.jobs[job.id]!.run_ids[0]!;
    const results = (await env.api(`/api/runs/${runId}`)).body.events.filter((e: { type: string }) => e.type === "agent.tool_result").map((e: { payload: { ok: boolean; summary: string } }) => e.payload);
    // part 2 does not exist (a short meeting is one part): refused, the rest works
    expect(results.map((r: { ok: boolean }) => r.ok)).toEqual([true, false, true, true]);
    expect(results[0].summary).toBe("transcript of Software part.m4a: part 1/1");

    // the transcript is a project document: times, the outro and the repeated line gone
    const docs = hub.docs.list("owner", project.id);
    const transcript = docs.find((d) => d.title.startsWith("Transkrip - Software part.m4a"))!;
    expect(transcript).toMatchObject({ content_type: "text/plain", project_id: project.id });
    const text = hub.docs.findByTitle(`Transkrip - Software part.m4a - ${rec.id}`, "owner")!.text;
    expect(text).toContain("[00:00] Okay, kita mula dengan kipas zon A. Misting jadi empat line, dua setiap zon.");
    expect(text).toContain("[01:01] Role tinggal dua, admin dengan user.");
    expect(text).not.toContain("menonton");
    expect(text.match(/Misting jadi empat line/g)).toHaveLength(1);
    // the notes are a document too (the dash in the title is kept readable), and searchable
    expect(docs.find((d) => d.title === "Nota mesyuarat 2026-10-22 - CowBarn.md")).toMatchObject({ content_type: "text/markdown" });
    expect(hub.docs.search("misting", "owner", project.id).length).toBeGreaterThanOrEqual(2);
    expect(hub.docs.log("owner", { project_id: project.id })).toMatchObject([{ kind: "decision", text: "Misting 4 line, 2 setiap zon" }]);

    // a follow-up reads the saved transcript instead of running whisper again
    const again = (await env.api("/api/jobs", { body: { agent_id: notulis.id, project_id: project.id, title: "soalan", input: { script: [{ tool: "meeting_transcribe", input: { file: 1 } }, { text: "ok" }], attachments } } })).body.job;
    await waitFor(() => ["done", "failed"].includes(hub.store.state.jobs[again.id]?.status ?? ""), 60_000, "follow-up");
    const calls = (await env.api(`/api/runs/${hub.store.state.jobs[again.id]!.run_ids[0]!}`)).body.events.filter((e: { type: string }) => e.type === "agent.tool_result");
    expect(calls[0].payload).toMatchObject({ ok: true });
    expect(hub.docs.list("owner", project.id).filter((d) => d.title.startsWith("Transkrip -"))).toHaveLength(1);
  }, 300_000);
});
