# Task 023: Notulis — record a meeting in the app, view transcripts and notes

Read `tasks/gemini/SUPERVISOR.md` first (rules + the report you must write). Notulis is built and tested
(commit e4bf31c; guide `docs/notulis.md`; notes in `CLAUDE.md` → "Notulis: meeting recordings"). This task adds
three things the owner will use every week, plus a missing test.

## Part A — "Rakam mesyuarat" in Chat (logic + UI)
The owner wants to record a meeting **inside MyOfis on the phone** and send it to Notulis, without another app.
1. New `apps/web/src/recorder.ts` (pure where possible, with `apps/web/test/recorder.test.ts`):
   - `canRecord()`: `navigator.mediaDevices?.getUserMedia` and `MediaRecorder` exist.
   - `startRecording()` → `{ stop(): Promise<File>, cancel(), elapsed(): number }` using `MediaRecorder` on
     `getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } })`
     (meetings: do not cut far voices). Pick the first supported type of `audio/webm;codecs=opus`, `audio/mp4`,
     `audio/ogg;codecs=opus`. `start(10_000)` so chunks arrive every 10 s (a long meeting is not one huge buffer).
   - Ask for a **screen wake lock** (`navigator.wakeLock.request("screen")`) while recording, release it on stop
     or cancel; when the page becomes visible again, request it again. Stop all tracks on stop/cancel.
   - `recordingName(date, mime)` (pure, tested): `rakaman-YYYYMMDD-HHmm.<ext>` with ext `weba` for webm,
     `m4a` for mp4, `ogg` for ogg. (The hub reads the type from the name when the browser sends none:
     `mediaTypeFromName` in `packages/shared/src/video.ts`; `weba` → `audio/webm` is in `AUDIO_TYPES`.)
   - `fmtDuration(seconds)` (pure, tested): `0:05`, `12:30`, `1:02:05`.
2. `apps/web/src/views/ChatView.vue`, only when the current agent has the tool `meeting_transcribe`:
   - A **🎙️ Rakam** button next to 📎. While recording: a red bar above the composer with a pulsing dot, the
     time (`fmtDuration`, updated every second), **Stop & lampir** and **Batal**, and the line
     "Biarkan skrin terbuka semasa merakam".
   - Stop & lampir → the File goes through the **existing** upload path (`api.uploadVideo`, the same progress
     bar as videos) and appears as a 🎙️ chip in the composer. The owner then types names/terms and sends.
   - Leaving the page or switching agent while recording asks "Rekod sedang berjalan. Buang rakaman?" (confirm).
   - Errors (no permission, no mic, upload failed) show in the existing `error` line, in Malay.
   - Do not touch the speech-to-text (dictation) button: it is a different feature (`speech.ts`).

## Part B — view transcripts and notes in Projects → Docs
`apps/web/src/components/ProjectDocs.vue` only offers Download for each document. For `text/plain` and
`text/markdown` documents add **Buka**: a modal (full screen on phones) that loads the file
(`api.uploadUrl(d.upload_id)`, `fetch` as text) and shows it:
- `.txt`: preformatted, wrapping, monospace times `[12:30]` kept;
- `.md`: rendered without new packages and **without `v-html` on raw text**: a small pure renderer in
  `apps/web/src/markdown.ts` (tested) that escapes HTML first, then supports `#`/`##`/`###` headings, `-` lists,
  `**bold**`, tables (`| a | b |`), and paragraphs. Anything else stays as escaped text.
- A **Salin** button (copies the raw text, for NoteHub) and Download. Esc / backdrop closes it.

## Part C — Telegram voice note test
`apps/hub/test/telegram-chat.test.ts`: a voice note (`message.voice` with `mime_type: "audio/ogg"`, no file name)
becomes an upload with `content_type: "audio/ogg"`, name `voice-note.ogg`, attached to the chat job; and an
audio file over 20 MB is refused with the existing "over 20 MB" notice. Extend `apps/hub/test/fakeTelegram.ts`
only as much as needed (its `getFile` now answers `photos/<id>.jpg`; give voice files their own path).

## Check before you hand back
- `bun run typecheck`, `bun test apps/web packages/shared apps/hub/test/telegram-chat.test.ts`, then the full
  `bun test`, and `bun run --cwd apps/web build` pass.
- Screenshots (outside the repo) with a preview hub (see `CLAUDE.md` → "Screenshots now need a preview hub"):
  Chat → Notulis while recording (fake it if the headless browser has no mic: say how), and the Buka modal with a
  `.md` note, at 1440 and 390 px, light and dark.
- Real-device check you cannot do: say so in the report; the owner will try it on the phone.

## Do not
- Change hub routes, the upload code, `meeting.ts`, or Notulis's prompt.
- Add packages. Commit. Touch the owner's `data/`.

---
**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, then do `tasks/gemini/023-notulis-record-and-view.md` (Parts A, B, C).
> Write `tasks/gemini/023-report.md` when done. Do not commit.
