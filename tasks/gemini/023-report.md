# 023 report

## Changed files
- `apps/web/src/recorder.ts`: Pure recording helper functions (`canRecord`, `startRecording` with MediaRecorder & wake lock, `recordingName`, `fmtDuration`).
- `apps/web/test/recorder.test.ts`: Pure unit tests covering `recordingName` format, `fmtDuration` formatting, and browser capability fallback handling.
- `apps/web/src/views/ChatView.vue`: Added Notulis `meeting_transcribe` detection, `🎙️ Rakam` button, recording timer & pulsing red bar, "Stop & lampir" upload via `api.uploadVideo`, navigation guards with Malay confirmation, and Malay error messages.
- `apps/web/src/markdown.ts`: Pure lightweight zero-dependency Markdown parser escaping raw HTML entities first, formatting headings, lists, bold text, tables, and paragraphs.
- `apps/web/test/markdown.test.ts`: Pure unit tests verifying XSS prevention, table rendering, headings, bullet lists, inline bold, and paragraph separation.
- `apps/web/src/components/ProjectDocs.vue`: Added "Buka" button for `.txt` and `.md` documents, responsive modal dialog (fullscreen on phones, Esc/backdrop dismiss) rendering `.markdown-doc` or monospace preformatted text, "Salin" button with feedback, and download link.
- `apps/hub/test/fakeTelegram.ts`: Extended mock Telegram server to handle `voice/` file paths and serve with `audio/ogg` MIME type.
- `apps/hub/test/telegram-chat.test.ts`: Added tests verifying voice notes are ingested as `voice-note.ogg` uploads attached to chat jobs and audio >20MB is rejected with size notice.
- `apps/web/scripts/seed-task023.ts`: Seed script for preview database populating Notulis agent, `.md` meeting notes, and `.txt` transcripts.
- `apps/web/scripts/task023-shots.mjs`: Automated Playwright screenshot script with preview hub on port 8811 and Web Audio API destination stream mock for recording UI.

## Commands run (paste the last lines of each output)
- `bun run typecheck`
```
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
```
(Exit code 0)

- `bun test apps/web packages/shared apps/hub/test/telegram-chat.test.ts`
```
 120 pass
 0 fail
 2426 expect() calls
Ran 120 tests across 19 files. [8.09s]
```
(Exit code 0)

- `bun test`
```
 331 pass
 0 fail
 3558 expect() calls
Ran 331 tests across 62 files. [163.05s]
```
(Exit code 0)

- `bun run --cwd apps/web build`
```
dist/assets/game-BU3GG7VK.js                                      1,205.42 kB │ gzip: 322.17 kB

✓ built in 10.45s
```
(Exit code 0)

## Screenshots (UI tasks): paths outside the repo, desktop 1440 + phone 390, light + dark
All screenshots saved outside repository at:
`C:\Users\Hazman\.gemini\antigravity-ide\brain\c829435f-741e-427d-b2bf-ff1a73e8c1cc\screenshots\`

1. **Chat → Notulis while recording (Desktop Light, 1440px):**
   `C:\Users\Hazman\.gemini\antigravity-ide\brain\c829435f-741e-427d-b2bf-ff1a73e8c1cc\screenshots\chat_notulis_recording_desktop_light.png`
2. **Chat → Notulis while recording (Desktop Dark, 1440px):**
   `C:\Users\Hazman\.gemini\antigravity-ide\brain\c829435f-741e-427d-b2bf-ff1a73e8c1cc\screenshots\chat_notulis_recording_desktop_dark.png`
3. **Chat → Notulis while recording (Phone Light, 390px):**
   `C:\Users\Hazman\.gemini\antigravity-ide\brain\c829435f-741e-427d-b2bf-ff1a73e8c1cc\screenshots\chat_notulis_recording_phone_light.png`
4. **Chat → Notulis while recording (Phone Dark, 390px):**
   `C:\Users\Hazman\.gemini\antigravity-ide\brain\c829435f-741e-427d-b2bf-ff1a73e8c1cc\screenshots\chat_notulis_recording_phone_dark.png`
5. **Projects → Docs Buka modal with .md note (Desktop Light, 1440px):**
   `C:\Users\Hazman\.gemini\antigravity-ide\brain\c829435f-741e-427d-b2bf-ff1a73e8c1cc\screenshots\project_docs_buka_md_desktop_light.png`
6. **Projects → Docs Buka modal with .md note (Desktop Dark, 1440px):**
   `C:\Users\Hazman\.gemini\antigravity-ide\brain\c829435f-741e-427d-b2bf-ff1a73e8c1cc\screenshots\project_docs_buka_md_desktop_dark.png`
7. **Projects → Docs Buka modal with .md note (Phone Light, 390px):**
   `C:\Users\Hazman\.gemini\antigravity-ide\brain\c829435f-741e-427d-b2bf-ff1a73e8c1cc\screenshots\project_docs_buka_md_phone_light.png`
8. **Projects → Docs Buka modal with .md note (Phone Dark, 390px):**
   `C:\Users\Hazman\.gemini\antigravity-ide\brain\c829435f-741e-427d-b2bf-ff1a73e8c1cc\screenshots\project_docs_buka_md_phone_dark.png`

## What I did NOT do or could not check, and why
- **Physical mobile microphone and OS wake lock testing:** In the headless Playwright environment, microphone input was mocked using a Web Audio API oscillator destination stream to verify the MediaRecorder recording loop and visual timer/red bar. Physical microphone behavior and hardware OS screen wake lock under mobile background sleep cannot be exercised in a headless desktop browser; the owner will test this on a real phone.
- **Live Telegram Bot voice note dispatch:** Tested via `fakeTelegram.ts` and unit tests in `telegram-chat.test.ts` to avoid hitting live Telegram API servers or using real bot credentials.

## Questions for the owner / Claude
- None. Parts A, B, and C are fully implemented according to specifications and all tests pass with zero regressions. Ready for review ("semak 023").
