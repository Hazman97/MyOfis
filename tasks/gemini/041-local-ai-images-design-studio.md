# Task 041: AI pictures on the owner's own GPU (ComfyUI + Z-Image Turbo, on demand) and the Design Studio page

Read `tasks/gemini/SUPERVISOR.md` and `tasks/gemini/028-review.md` (honesty rules) first. Write
`tasks/gemini/041-report.md` (a note after each step). Do not commit. Do it after 040 (it uses its templates).

## Why
The owner wants pictures made on **his own PC**, not a paid API: RTX 3060 12 GB, 16 GB RAM, often only ~3–5 GB of
RAM free. **He plays games on the same PC**, so the image engine must never stay running and must never fight a
game for the GPU. The model draws pictures only. All text on a post comes from the 040 templates.

## Facts
- **Install** (Claude does it; check that it is there, never download it again):
  - ComfyUI portable v0.44.0 (nvidia) in `C:\ComfyUI\ComfyUI_windows_portable\`;
  - models `z_image_turbo_int8_convrot.safetensors` (diffusion), `qwen_3_4b_fp8_mixed.safetensors` (text encoder)
    and `ae.safetensors` (VAE) in its `ComfyUI\models\...` folders.
  If the folder is missing on the PC where you test, say so in the report and use a fake ComfyUI server in the tests.
- **ComfyUI HTTP API** (default `127.0.0.1:8188`):
  - `POST /prompt {prompt: <API-format workflow>, client_id}` → `{prompt_id}`;
  - `GET /history/<id>`;
  - `GET /view?filename&subfolder&type`;
  - `GET /system_stats` (VRAM);
  - `POST /free {unload_models: true, free_memory: true}`.
  - Start it with `python_embeded\python.exe -s ComfyUI\main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch`.
  Check these against the installed version and say in the report what you verified.
- Runner patterns to follow:
  - `packages/tools/src/openchatcut.ts` (a local app bridged by the runner; the token never leaves the PC);
  - `killTree` + wait for exit (Windows);
  - `spawn()` with a scrubbed env;
  - program detection (`capabilities.programs`, `requiredPrograms()` in `packages/shared/src/programs.ts`);
  - direct jobs (`DIRECT_JOBS`, `runtimes/direct.ts`: no LLM, 0 tokens);
  - the parts upload route (widened in 040 for `design_render`).

## Build
1. **ComfyUI manager** (`packages/tools/src/comfy.ts`, runner side):
   - **On demand only.** Start ComfyUI on the first image request, wait for `/system_stats` (timeout 120 s), and reuse
     it for later requests. After **5 idle minutes**, call `/free` and then stop it with `killTree`. Also stop it when
     the runner exits.
   - **Game guard.** Before each request, read `nvidia-smi --query-gpu=memory.used,utilization.gpu` and the compute
     apps. When another process uses more than `COMFY_MAX_FOREIGN_VRAM_MB` (default 2500), or GPU use is above
     60 % from someone else, **wait**: show `agent.thinking` "GPU sedang digunakan (game?), menunggu…", check
     every 30 s, and give up after 30 min with a clear error.
   - **One GPU job at a time on the runner.** Add a runner-wide GPU lock shared with `video_transcribe`,
     `meeting_transcribe` (whisper) and the nvenc encode in `video_edit` / `video_hd`. Keep the lock order simple,
     with no nesting.
   - Program `comfyui` is reported when `COMFYUI_DIR` (default `C:\ComfyUI\ComfyUI_windows_portable`) has the python
     and `main.py`. `requiredPrograms`: `image_generate` → `comfyui`.
2. **Workflow:**
   - **Already provided and verified by Claude** on 2026-11-24: `packages/tools/comfy/z-image-turbo.json` (API format,
     built from ComfyUI's bundled `image_z_image_turbo_int8.json` template: CLIP type `lumina2`, shift 3, 8 steps,
     cfg 1, `res_multistep` / `simple`, negative = `ConditioningZeroOut`).
     - Measured on the owner's PC: the first image takes 27.5 s (it loads the model), the next ones 15–17 s.
     - VRAM peaks at **~11.5 GB of 12 GB**. This is why the game guard is mandatory.
     - Free RAM drops by about 0.8 GB.
     - After `POST /free` and stopping the process, VRAM went back to ~1 GB and port 8188 was closed.
   - Do not change node ids. Fill it with a pure function `fillWorkflow(base, {prompt, width, height, seed, steps,
     prefix})` (tested). Width and height must be multiples of 16.
   - Size the latents near 1 MP (`post_4x5` 896×1120, `story` 720×1280, `square` 1024×1024), then resize to the exact
     040 size.
3. **Tool `image_generate`:**
   - Arguments: `{prompt, size: post_4x5|square|story|wide, count ≤ 4, seed?, style_hint?}`.
   - Sizes come from 040, generated near 1 MP and then resized/cropped exactly.
   - The prompt is English, with the Brand Kit's colours/style appended when the job has a project.
   - It uploads PNGs through the parts route (allow images for `image_generate`) and returns
     `{images: [{upload_id, seed}]}`.
   - `design_render`'s `photos` also accept upload ids that this run created.
   - Not in `MEMBER_TOOLS`: it runs on the owner's GPU.
4. **Pause switch:**
   - `settings.image_gen = {paused, max_per_day}`, with an owner card in Settings → Integrations: on/off, today's
     count, ComfyUI status (running / stopped / not installed on any runner).
   - When paused, the tool answers "Gambar AI dijeda oleh pemilik" and the agent carries on without pictures.
   - The hub enforces `max_per_day` (default 60).
5. **Design Studio page `/design`** (menu Work; owner/room scoped). This is the owner's "control" over posts:
   - pick a project (its Brand Kit), a template and a size, and fill in the fields;
   - **live preview**: render the template HTML in a sandboxed `iframe srcdoc` (no scripts, scaled to fit);
   - a photo slot: upload, pick an attachment, or **Generate with AI** (a prompt box → direct job
     `image_generate` → 1–4 choices → pick one);
   - **Render** → a PNG via a direct job (`design_render`, no LLM), then Download, or **Save as draft** (choose the
     platform and kind; a carousel keeps its order in `meta.images`).
6. **Docs:**
   - `docs/ai-images.md`: what runs when; the game guard; how to pause it from the phone; swapping in another
     model later (Qwen-Image GGUF for text, FLUX.2 klein).
   - A manual section (BM) and a CLAUDE.md bullet.

## Tests and proof
- Pure: `fillWorkflow` (sizes, seed, prompt escaping) and the VRAM guard decision (a table of nvidia-smi readings →
  run/wait).
- Runner: a fake ComfyUI HTTP server tests start → generate → idle stop. Check with the fake process that **nothing
  is left running** after the idle timeout and after the runner stops. Also test: a busy GPU waits and then times
  out with the BM message; the GPU lock serialises a whisper job and an image job.
- Hub: paused → tool error; `max_per_day`; members' rooms do not get the tool; the parts route accepts PNG only for
  `image_generate` / `design_render`.
- **Real run on this PC** (only if `C:\ComfyUI` exists):
  - generate one `post_4x5` and one `story` picture;
  - paste the time per image, the peak VRAM from nvidia-smi, the free RAM before and after;
  - confirm ComfyUI is **gone** 5 minutes later (`Get-Process python`, port 8188 closed).
  Put the PNGs outside the repo and list their paths.
- Screenshots of `/design` and the settings card (desktop 1440 + phone 390, light + dark). Follow the browser rule.
- `bun run typecheck`, the full `bun test`, `bun run --cwd apps/web build`: raw final lines.

---
**Prompt for Gemini:**
> Read `tasks/gemini/SUPERVISOR.md`, `tasks/gemini/028-review.md`, then do `tasks/gemini/041-local-ai-images-design-studio.md`
> step by step, tests after each, notes appended to `tasks/gemini/041-report.md`. ComfyUI must only run on demand,
> stop itself when idle, and wait while a game uses the GPU: prove each with tests. Do not download models. Use
> temp DBs and dirs, never the owner's. Paste raw output only; anything not run is NOT RUN. Do not commit.
