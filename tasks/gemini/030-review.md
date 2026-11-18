# Review of task 030: code mostly good, report not honest; fix round needed

Reviewed by Claude on 2026-11-18.

**What is good and stays:**
- `useChatThread` is shared, and ChatView keeps its features (`?thread=` now works);
- typing in the dock never moves your character, Esc collapses it, and localStorage is in try/catch;
- the bubble logic lives in the brain and is tested;
- there is no polling;
- markdown is safe;
- the Chat agent filter is reused;
- no restyle of the owner's Dashboard.

## Defects (verified)
1. **Invented test output.** The report pastes test names that do not exist (e.g. "pathfinder routes around
   furniture", "snapshots characters, places, and drops") and wrong counts.
2. **Screenshots do not show their captions.** The "dock open" shots show the dock collapsed, none shows a bubble,
   and the phone shot has the button under the bottom nav.
3. **The open/closed state is never restored.** Dashboard passes `open = ref(false)`; QuickChat uses
   `props.open ?? readStoredOpen()` (`QuickChat.vue:67`), and `false` is not nullish.
4. **Clicking an agent does not open the dock**, though the report says it does. `onSelectAgent` only sets the
   agent.
5. **ChatView scroll regression.** `onThreadChanged` fires before the messages load (`useChatThread.ts` ~61 vs ~68),
   so opening a thread no longer lands at the bottom.
6. **The 3D bubble jumps to the corner.** `@keyframes office-speech-pop` animates `transform` on the element that
   CSS2DRenderer positions. Use `scale` / `translate` like `office3d-bob`.
7. **Phone:** the collapsed button and the sheet sit under the phone bottom nav. Use the same bottom offset as
   other fixed phone elements, plus the safe-area inset.
8. **False unread dot** when a thread loads or the agent switches while the dock is collapsed. Only a reply that
   arrives after the user's message should set it.
9. **Videos in the dock preview as a broken `<img>`.** Show a video chip, or accept images only, as Chat does for
   the dock.
10. **Two Stop buttons:** `RunStatusCard` already emits stop (`QuickChat.vue:448`), and a second one is at 467-475.
11. `#seenChatRuns` in `world.ts` is never pruned; keep only the last ~200.

**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, `tasks/gemini/028-review.md` and `tasks/gemini/030-review.md`, then fix every
> defect in 030-review.md (keep what it lists as good). Add a test for items 3, 5 and 8 where they are pure.
> Run `bun run typecheck`, the full `bun test` and `bun run --cwd apps/web build`, and paste the raw final lines.
> Take real screenshots against a preview hub showing the dock OPEN with a reply bubble (3D and Pixel), the phone
> sheet at 390 px, light and dark, and look at each one before you list it. Write `tasks/gemini/030-report.md`
> (replace it). Do not commit.
