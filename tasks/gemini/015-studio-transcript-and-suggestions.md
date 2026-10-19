# Task 015: Video Studio, transcript, Ask Editor and edit suggestions (UI)

Claude is building the back end at the same time. The pieces are:
- **whisper.cpp** on the runner PC turns a video's speech into words with times;
- Editor reads the transcript and **suggests 2–4 edit options** (tool `suggest_edits`);
- the studio builds **tight cuts** (drop pauses and "um") and **subtitles** from the transcript, with no AI.

The owner wants **two ways in**:
1. chat with Editor (Chat page);
2. open **Video Studio** from the menu, add a video there, see the transcript and Editor's suggestions, ask Editor about this video, and edit.

You build the UI. **The data contract is fixed and already in the code; use it, do not change it.**

## Scope: edit ONLY these files
- `apps/web/src/views/VideoStudioHomeView.vue`: Claude made a plain working version; restyle it and keep its logic.
- `apps/web/src/views/VideoStudioView.vue`: add the panels below. Keep all existing logic (plan, clips, captions, render again, use own edit, OpenCut).
- New `apps/web/src/components/studio/TranscriptPanel.vue`
- New `apps/web/src/components/studio/AskEditorPanel.vue`
- New `apps/web/src/components/EditSuggestionCards.vue`
- `apps/web/src/views/ChatView.vue`: only add the suggestion cards under an agent reply. Keep everything else.

Never delete, rename or move files. No new packages. Do not run `git commit`.

Do **not** edit:
- `apps/web/src/api/http.ts`, `router.ts`, `AppShell.vue`;
- anything in `packages/` or `apps/hub/` / `apps/runner/`.

If you need something there, write it in your hand-back note.

## The contract (read these first)
- `packages/shared/src/transcript.ts`:
  - `Transcript {language, duration, model, words: {w, s, e}[]}` (seconds in the source video);
  - `isFiller(w)`;
  - `tightCuts(transcript, videoNumber, opts)` → `Clip[]`;
  - `subtitleCues(plan, transcriptsByFileNumber, durations)` → `{text, start, end}[]` in finished-video time;
  - `EditSuggestions {id, run_id, intro, options: {key, title, why, plan}[], attachments, created_at}`.
- `packages/shared/src/video.ts`:
  - `EditPlan` gained `subtitles: {style: "pop" | "line", uppercase, position: "bottom" | "middle"} | null`;
  - clips are now up to 80.
- `apps/web/src/api/http.ts`:
  - `VideoInfo` gained:
    - `transcripts: Record<uploadId, Transcript | null>` (keyed by `render.attachments[].id`);
    - `transcribe_job: {id, status} | null`;
    - `suggestions: EditSuggestions | null`.
  - `ChatMessage.suggestions?: EditSuggestions | null`.
  - Helpers: `api.videos()`, `api.transcribeVideo(id)` → `{job}`, `api.chat(...)`, `api.chatThread(threadId)`.
  - Job progress: `useOffice().state.jobs[jobId].status` (`queued` / `running` / `done` / `failed`). Reload `api.video(id)` when it ends.
- Until Claude's back end lands, `transcripts` / `suggestions` may be missing. Guard with `?? {}` / `?? null` so the page never crashes.

## What to build
1. **VideoStudioHomeView:**
   - a clear header with two actions: "Add video" (upload with % progress) and "Chat with Editor";
   - video cards (name, date, size, "made by Editor" / "your video", a transcript badge);
   - an empty state that explains the two ways in.
2. **TranscriptPanel** (in the studio, beside or under the preview):
   - **Props:** `transcript: Transcript | null`, `fileNumber`, `currentTime`, `busy`. **Emits:** `seek(seconds)`, `transcribe`.
   - **Content:** the words as running text. Fillers (`isFiller`) are dimmed and struck through; the word at `currentTime` is highlighted and kept in view; clicking a word emits `seek`; pauses ≥ 1 s show as a small "⏸ 1.4s" chip.
   - **No transcript yet:** a "Transcribe (free, on your PC)" button that emits `transcribe`, plus a spinner while `busy`.
3. **Studio wiring** (VideoStudioView):
   - **Transcribe:** `api.transcribeVideo(props.id)`; follow the job in `office.state.jobs`; reload when done; show an error if it fails.
   - **"Tight cut" button:**
     - shown when the first video source has a transcript;
     - confirm first, because it replaces the clips;
     - then set `plan.clips = tightCuts(transcript, n)` and show "removed X s of pauses and N fillers".
   - **Subtitles switch:**
     - off = `plan.subtitles = null`; on = `{style: "pop", uppercase: true, position: "bottom"}`, with controls for style / uppercase / position;
     - preview the cues as text over the player using `subtitleCues(plan, byNumber, durations)` at the player's time. A list is fine if an overlay is hard; the overlay is nicer.
   - **Suggestions:** when `info.suggestions` exists, show `EditSuggestionCards` above the timeline. **"Use in timeline"** copies the option's plan into `plan`:
     - map `clip.video` through `suggestions.attachments[n-1].id` → the index of that id in `render.attachments`;
     - skip clips whose file is not in this video.
4. **AskEditorPanel** (collapsible in the studio; a bottom sheet on phone):
   - a small chat with the agent whose slug is `editor` (from `useOffice()` agents);
   - **Thread id:** kept in `localStorage` key `myofis-studio-thread-<uploadId>`, wrapped in try/catch.
   - **Messages:**
     - the first message sends `attachments: render.attachments.map(a => a.id)` (video sources only), and later messages send none;
     - poll `api.chatThread` every 3 s while a reply is pending;
     - show replies (keep line breaks) and, under each reply, its `suggestions` as `EditSuggestionCards` with "Use in timeline".
   - **Quick chips:** "Suggest edits", "Make it 30 s for TikTok", "Add subtitles", "Cut the ums".
5. **EditSuggestionCards:**
   - **Props:** `suggestions: EditSuggestions`, `mode: "chat" | "studio"`.
   - **Content:** the intro, then one card per option with:
     - a key badge (A/B/C/D), the title, `why`;
     - chips for preset, total seconds (computed from the clips: `(end - start) / speed`, or "full" when `end` is missing), clip count, subtitles on/off and captions count.
   - **Chat mode:** "Pick A" emits `pick("A")`. ChatView then sends the text `Go with option A` through its existing `send()`. Also an "Open in Studio" link: `/studio/<suggestions.attachments[0].id>`.
   - **Studio mode:** "Use in timeline" emits `use(option)`.
6. **Phone (390 px):** no horizontal page scroll; tap targets ≥ 40 px; panels stack.

## Rules
- Use the design system in `apps/web/src/style.css` (tokens; `card`, `btn`, `chip`, `label`, `input`, `sign`), light and dark. English UI text.
- Videos, transcripts and agent replies are data: render them as text, never `v-html`.

## Check before you hand back
- `bun run --cwd apps/web typecheck` and `bun run --cwd apps/web build` pass.
- Open `/studio` and `/studio/<id>` at desktop width and 390 px, light and dark. It must not crash when `transcripts` / `suggestions` are missing.
- Tell the owner you are done; Claude reviews the diff and wires it to the live back end.
