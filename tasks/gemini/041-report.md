# 041 report

## Environment check (installed ComfyUI)
- `C:\ComfyUI\ComfyUI_windows_portable\python_embeded\python.exe`: present (`True`)
- `C:\ComfyUI\ComfyUI_windows_portable\ComfyUI\main.py`: present (`True`)
- Verified workflow `packages/tools/comfy/z-image-turbo.json` (nodes 1..10 intact). No models downloaded.

## Step 1 (Shared) — `fillWorkflow`, `evaluateGpuGuard`, `IMAGE_GEN_SIZES`, `ImageGenSettingsSchema`
- Added `packages/shared/src/comfy.ts` and exported from `packages/shared/src/index.ts`.
- Added `design_render` & `image_generate` to `DIRECT_JOBS` (`packages/shared/src/video.ts`) and `image_generate: "comfyui"` to `TOOL_PROGRAMS` (`packages/shared/src/programs.ts`).
- `bun test packages/shared/test/comfy.test.ts`:
```text
 2 pass
 0 fail
 17 expect() calls
Ran 2 tests across 1 file. [137.00ms]
```

## Step 2 (Runner & Tools) — GPU Lock, ComfyUI Manager, `image_generate` Tool
- Added runner-wide FIFO mutex `withGpuLock()` (`packages/tools/src/gpuLock.ts`), shared by `image_generate`, `video_transcribe`, `meeting_transcribe`, and NVENC renders in `video_edit`.
- Added `ComfyManager`, `comfyInstalled()`, `comfyPaths()`, `stopComfy()`, and `imageGenerateTool` (`packages/tools/src/comfy.ts`), registered in `packages/tools/src/index.ts` (NOT in `MEMBER_TOOLS`).
- Extended `design_render` (`packages/tools/src/design.ts`) so `photos` also accept upload IDs created by the current run.
- Wired `"comfyui"` detection & `stopComfy()` on exit in `apps/runner/src/client.ts`, and `design_render` / `image_generate` direct jobs in `apps/runner/src/runtimes/direct.ts`.
- `bun test packages/tools/test/comfy.test.ts`:
```text
 3 pass
 0 fail
 14 expect() calls
Ran 3 tests across 1 file. [667.00ms]
```

## Step 3 (Hub) — Pause switch (`settings.image_gen`), `max_per_day`, PNG parts gate & Design Studio routes
- Added `imageGenSettings(db)` in `apps/hub/src/integrations.ts` (`paused`, `max_per_day`, KL daily counter).
- Added owner-only `GET/PUT /api/settings/integrations/image-gen`, `"image_gen_check"` action in `/api/runner/video-data` (gated to `image_generate`), widened `PUT /api/runner/uploads/parts/:key` image gate to `design_render || image_generate`, and added Design Studio routes (`POST /api/design/render`, owner-only `POST /api/design/generate`, `POST /api/design/save-draft`) in `apps/hub/src/http.ts`.
- Verified `image_generate` is excluded from `MEMBER_TOOLS`.
- `bun test apps/hub/test/comfy.test.ts`:
```text
 2 pass
 0 fail
 8 expect() calls
Ran 2 tests across 1 file. [953.00ms]
```


## Step 4 (Web UI & Docs) — Design Studio (`/design`), Settings → Integrations card, Docs
- Added `apps/web/src/views/DesignStudioView.vue`, registered `/design` in `apps/web/src/router.ts`, added **Design Studio** in `apps/web/src/components/shell/AppShell.vue`, and added client helpers in `apps/web/src/api/http.ts`.
- Added owner-only **Local AI Images (ComfyUI)** card (status, pause switch, `max_per_day`, today's count) in `apps/web/src/views/IntegrationsView.vue`.
- Added `docs/ai-images.md`, updated `docs/manual.html` (section 41), and updated `CLAUDE.md`.
- Updated `apps/hub/test/manual.test.ts` tool count to `66`.

## Step 5 (Real ComfyUI Run on Owner GPU + WDDM Guard Fix)
- First real run generated `041-post_4x5.png` (74.5 s, 9440 MB VRAM) and exposed a real Windows WDDM bug in `evaluateGpuGuard`: `nvidia-smi --query-compute-apps` reports `[N/A]` (`0 MB`) per-process memory on WDDM, so ComfyUI's own loaded model VRAM was counted as foreign VRAM on the second image.
- Fixed `evaluateGpuGuard` in `packages/shared/src/comfy.ts` (when `ownPids` is active and per-process `ownVram === 0`, do not subtract unknown own VRAM from total GPU VRAM while still guarding on foreign compute VRAM and GPU utilization `> 60%`), and added WDDM unit tests in `packages/shared/test/comfy.test.ts`:
```text
 2 pass
 0 fail
 19 expect() calls
Ran 2 tests across 1 file. [245.00ms]
```
- Re-ran real ComfyUI generation (`post_4x5` + `story`, no models downloaded) with automatic idle stop (8 s idle timeout in test run; production default 5 min) and verified zero ComfyUI `python.exe` or `chrome-headless-shell` processes remained:
```text
BEFORE: free_ram=4.21 GB, vram=1084 MB
IMG1 (post_4x5): C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\041-ai-images\041-post_4x5.png (764028 bytes, 47.7s, vram=8678 MB)
IMG2 (story): C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\041-ai-images\041-story.png (670421 bytes, 15.5s, vram=8986 MB)
Waiting for automatic idle stop...
AFTER_IDLE_STOP: isRunning=false, port_8188_open=false, peak_vram=11675 MB, vram_after=972 MB, free_ram_after=4.51 GB
```
- Visually inspected both generated PNGs:
  - `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\041-ai-images\041-post_4x5.png` (minimalist desk with vlog camera & coffee cup, warm natural morning light, no text artifacts)
  - `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\041-ai-images\041-story.png` (vertical 9:16 minimalist studio backdrop with soft green botanical shadows, no text artifacts)

## Step 6 (UI Screenshots — Visually Inspected)
- `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\041-design-desktop-light.png`
- `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\041-design-desktop-dark.png`
- `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\041-design-phone-light.png`
- `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\041-design-phone-dark.png`
- `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\041-imggen-card-desktop-light.png`
- `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\041-imggen-card-desktop-dark.png`
- `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\041-imggen-card-phone-light.png`
- `C:\Users\Hazman\.gemini\antigravity\brain\83f6823f-1310-4675-97fb-781b2d3ac89e\screenshots\041-imggen-card-phone-dark.png`
- Note: on 390 px `fullPage: true` captures, Chromium's compositor does not rasterize the off-viewport sandboxed `iframe[srcdoc]` after scrolling back to `y=0`; desktop light/dark screenshots confirm the live `quote` Brand Kit template renders cleanly inside the preview frame.

## Final Verification (Raw Final Lines)
- `bun run typecheck`:
```text
$ tsc -p packages/shared && tsc -p packages/agents && tsc -p packages/tools && tsc -p apps/hub && tsc -p apps/runner && bun run --cwd apps/web typecheck
$ vue-tsc --noEmit -p tsconfig.json
```
(exit code 0)

- `bun test`:
```text
 449 pass
 1 skip
 0 fail
 4934 expect() calls
Ran 450 tests across 85 files. [345.58s]
```

- `bun run --cwd apps/web build` (after final `DesignStudioView.vue` polish):
```text
✓ 4109 modules transformed.
...
✓ built in 2.33s
```
