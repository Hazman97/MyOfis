# 041 review (Claude, 2026-11-25): PASS WITH FIXES — items 1 and 2 are must-fix (the owner games on this PC)

`fillWorkflow`, argv spawn + scrubbed env, 127.0.0.1 only, lock in `finally`, no nesting, idle timer, 30 min BM
give-up, hub-side `paused`/`max_per_day`, `MEMBER_TOOLS` without `image_generate`: all OK. Targeted tests pass.
Append notes to `tasks/gemini/041-report.md` under "## Fixes after review". Do not commit.

1. **ComfyUI is never killed when the runner exits** — `apps/runner/src/index.ts:66-72`, `apps/runner/src/client.ts:114`,
   `packages/tools/src/comfy.ts:250-266`. `shutdown()` → `client.stop()` starts `stopComfy()` without awaiting, then
   `process.exit(0)`; `stop()` awaits `/free` before killing, so the kill never runs. No `exit` hook, nothing on crash.
   Result: `python.exe` keeps ~9 GB VRAM after a runner restart, with no idle timer left — while the owner games.
   Fix: `await stopComfy()` (with a 5 s cap on `/free`) in `shutdown()` before exit; plus a sync `killComfyNow()`
   (`taskkill /T /F` via `spawnSync`) on `process.on("exit")`, SIGHUP and SIGBREAK. Also: on runner start, if a
   ComfyUI started by us is still listening on the port (pid file in the runner data dir), kill it.
   Test with a real child process (a tiny Bun script that sleeps): after `shutdown()` the pid is gone.
2. **The WDDM guard is blind to games while ComfyUI is loaded** — `packages/shared/src/comfy.ts:134-138`.
   With our pid present and per-process VRAM `[N/A]`, only compute-app VRAM + utilisation count; DirectX/Vulkan games
   are not compute apps. Total 11 800 MB at 45 % with our python listed at 0 MB → `run`. A 60-fps-capped game + a
   second image → VRAM over 12 GB → stutter / OOM.
   Fix: when own VRAM is unknown, record `baseline = total VRAM` right after each generation finishes (model loaded,
   idle); foreign = current total − baseline (and before our process exists, foreign = total − the normal desktop
   floor as today). Also call `POST /free` after each tool call so 9 GB is not kept resident for the 5 idle minutes
   (reloading costs ~10 s; that is fine). Table tests for: game started before, game started while loaded, no game.
3. **Cancel frees the GPU lock while ComfyUI keeps generating** — `packages/tools/src/comfy.ts:295-310`.
   Fix: on abort send `POST /interrupt` and remove the prompt from the queue (`POST /queue {delete:[id]}`) before
   rethrowing; keep the lock until `/history` shows it stopped or 15 s pass. Test with the fake server.
4. **Hung ComfyUI is orphaned** — `comfy.ts:220-226`. If `#proc` exists but `/system_stats` does not answer, a second
   one is spawned. Fix: `await this.stop()` first.
5. **NVENC outside the lock** — `packages/tools/src/explainer.ts:326-330`: wrap in `withGpuLock`. (Public HD in the
   hub is another process; note it in docs/ai-images.md — public HD jobs should use libx264 or be paused when the
   owner games; just document, do not change public HD now.)

Proof: raw output of new tests; repeat the real run from the report (only if `C:\ComfyUI` exists): generate, then stop
the runner with Ctrl+C within 1 minute → paste `Get-Process python` / port 8188 / nvidia-smi before and after.
`bun run typecheck`, full `bun test`, web build final lines.
