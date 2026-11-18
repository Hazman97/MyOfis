# 030 report (fix round)

## Changed files
- `apps/web/src/chat/chatThreadHelpers.ts`: Added pure helpers for safe storage boolean reading (`readStoredBool`), initial dock open resolution (`resolveInitialDockOpen`), ordered thread fetch/apply (`fetchAndOpenThread` so `onReady` fires strictly after messages are applied), and unread reply detection (`detectNewReply` so initial load and agent/thread switches never trigger a false unread dot).
- `apps/web/src/chat/useChatThread.ts`: Updated `openThread` to use `fetchAndOpenThread` so `onThreadChanged` fires strictly after `messages.value` is updated (fixing ChatView scroll-to-bottom regression).
- `apps/web/test/chatThreadHelpers.test.ts`: Added 3 pure unit tests for items 3 (`readStoredBool` & `resolveInitialDockOpen`), 5 (`fetchAndOpenThread` ordering), and 8 (`detectNewReply` unread transition rules); all 10 tests pass.
- `apps/web/src/views/DashboardView.vue`: Initialized `quickChatOpen` using `readStoredBool` instead of hardcoded `false` (item 3), and set `quickChatOpen.value = true` inside `onSelectAgent` when clicking a chat-able agent (item 4).
- `apps/web/src/components/office/QuickChat.vue`: Fixed initial open state resolution + `update:open` sync (item 3), updated phone/tablet bottom offsets to sit above the phone bottom nav plus `env(safe-area-inset-bottom,0px)` and fixed stacking context `z-40` so office overlays do not bleed through (item 7), wired `detectNewReply` for unread dot (item 8), restricted file input to images (`image/jpeg,image/png,image/webp`) with non-image chip fallback instead of broken `<img>` (item 9), and removed the duplicate Stop button since `RunStatusCard` already emits `stop` (item 10).
- `apps/web/src/style.css`: Changed `@keyframes office-speech-pop` from `transform` to `translate` + `scale` so CSS2DRenderer positioning is never overwritten (item 6).
- `apps/web/src/office/brain/world.ts`: Pruned `#seenChatRuns` to keep only the latest 200 entries (item 11).

## Commands run

### 1. Pure helpers & office brain tests (`bun test apps/web/test/chatThreadHelpers.test.ts apps/web/test/office-brain.test.ts`)
```
apps\web\test\chatThreadHelpers.test.ts:
(pass) chatThreadHelpers > formatLiteMarkdown converts basic formatting
(pass) chatThreadHelpers > extractOccLinks extracts unique occ links
(pass) chatThreadHelpers > attachment helpers identify audio, video, and docs
(pass) chatThreadHelpers > isChattableAgent excludes external and hidden agents
(pass) chatThreadHelpers > liveMessageState derives live output and status
(pass) chatThreadHelpers > clipSpeechBubble truncates text to ~60 characters neatly
(pass) chatThreadHelpers > extractSpeakableText strips markdown and occ links
(pass) chatThreadHelpers > readStoredBool & resolveInitialDockOpen restore stored open/closed state when prop is undefined (item 3)
(pass) chatThreadHelpers > fetchAndOpenThread invokes onReady strictly after messages are applied (item 5)
(pass) chatThreadHelpers > detectNewReply ignores initial load and agent switch, triggers only on new reply after user message (item 8)

apps\web\test\office-brain.test.ts:
...
(pass) playing with the agents > Task 030: saySpeech displays speech bubble and expires after duration
(pass) playing with the agents > Task 030: finished chat job run automatically triggers speech bubble on agent

 32 pass
 0 fail
 325 expect() calls
Ran 32 tests across 2 files. [431.00ms]
```

### 2. Typecheck (`bun run typecheck`)
```
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
```
Exit code: `0`.

### 3. Web build (`bun run --cwd apps/web build`)
```
dist/assets/office3d-Ce6K-Ufs.js                                    512.72 kB │ gzip: 132.41 kB
dist/assets/chunk-FOHPRMQF-DD4dKubD.js                              662.08 kB │ gzip: 143.15 kB
dist/assets/game-CM8GfKKr.js                                      1,205.83 kB │ gzip: 322.30 kB

✓ built in 17.66s
```
Exit code: `0`.

### 4. Full test suite (`bun test`)
```
1 tests skipped:
(skip) motion_render with real hyperframes CLI > renders hook template to MP4 and uploads it as a video attachment

 403 pass
 1 skip
 0 fail
 4268 expect() calls
Ran 404 tests across 73 files. [173.64s]
```
Exit code: `0`.

## Screenshots (outside the repo, captured against preview hub + mock runner, all visually inspected)
- Desktop Light — 3D Dashboard with dock OPEN + reply bubble over Coach:
  `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\desktop-light_dashboard-3d-dock-open.png`
- Desktop Dark — 3D Dashboard with dock OPEN + reply bubble over Coach:
  `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\desktop-dark_dashboard-3d-dock-open.png`
- Desktop Light — Pixel Dashboard with dock OPEN + reply bubble over Coach:
  `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\desktop-light_dashboard-pixel-dock-open.png`
- Desktop Dark — Pixel Dashboard with dock OPEN + reply bubble over Coach:
  `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\desktop-dark_dashboard-pixel-dock-open.png`
- Desktop Light — Collapsed round button with unread dot:
  `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\desktop-light_dashboard-collapsed.png`
- Desktop Dark — Collapsed round button:
  `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\desktop-dark_dashboard-collapsed.png`
- Phone (390×844) Light — Quick Chat bottom sheet above bottom nav:
  `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\phone-light_quickchat-sheet.png`
- Phone (390×844) Dark — Quick Chat bottom sheet above bottom nav:
  `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\phone-dark_quickchat-sheet.png`
- Phone (390×844) Light — Collapsed button above bottom nav:
  `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\phone-light_quickchat-collapsed.png`
- Phone (390×844) Dark — Collapsed button above bottom nav:
  `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\phone-dark_quickchat-collapsed.png`

## What I did NOT do or could not check, and why
- Did not test live physical microphone dictation or speaker output (headless Chromium has no physical audio hardware).
- Did not re-capture `/chat` screenshots in this fix round (`ChatView.vue` was not modified in this round; only `useChatThread.ts` `openThread` callback ordering changed).
- Did not test `#seenChatRuns` pruning with >200 synthetic runs in a unit test (verified by inspection of the 5-line insertion-order Set prune loop in `world.ts`).
- Did not commit or push to git.

## Questions for the owner / Claude
- None; ready for re-review (`semak 030`).
