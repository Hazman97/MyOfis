# Local AI Images (ComfyUI + Z-Image Turbo)

MyOfis generates photos and backgrounds locally on the owner's GPU (RTX 3060 12 GB) using **ComfyUI** and **Z-Image Turbo** — zero external image API costs. The AI model draws **pictures only**; all text, headlines, prices, and logos are rendered cleanly on top using the offline Brand Kit templates (`design_render`, Task 040).

## When ComfyUI runs (On-demand lifecycle)
- **Never stays running in the background:** ComfyUI starts only on the first `image_generate` request (`python_embeded\python.exe -s ComfyUI\main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch`).
- **Auto-stop after 5 idle minutes:** once no image jobs are active for 5 minutes, the runner calls `POST /free { unload_models: true, free_memory: true }` and stops the process tree (`killTree`), returning VRAM to ~1 GB and closing port 8188.
- **Runner exit:** stopping the runner also stops ComfyUI immediately.
- **One GPU job at a time:** a runner-wide FIFO GPU mutex (`withGpuLock`) serialises `image_generate`, Whisper (`video_transcribe`, `meeting_transcribe`), and NVENC encodes (`video_edit` / `video_hd`).

## Game Guard (VRAM & GPU utilization)
Z-Image Turbo uses ~11.5 GB of 12 GB VRAM. Before every generation, the runner queries `nvidia-smi`:
- If another process uses more than `COMFY_MAX_FOREIGN_VRAM_MB` (default **2500 MB**), or foreign GPU utilization exceeds **60 %**, the runner **waits** instead of fighting the game for VRAM.
- The run shows `"GPU sedang digunakan (game?), menunggu…"` and checks every 30 s, giving up after 30 minutes with a clear error.

## Pausing from your phone
Open **Settings → Integrations → Local AI Images (ComfyUI)** and switch **Pause AI image generation** on (or adjust `Max / day`, default 60). While paused:
- `image_generate` immediately returns `"Gambar AI dijeda oleh pemilik"` and agents continue without AI pictures.
- ComfyUI is never started while paused.

## Swapping models later
The workflow lives in `packages/tools/comfy/z-image-turbo.json` (API format, node IDs `"1"`..`"10"`). To swap to another local model later (e.g. **Qwen-Image GGUF** for text-in-image or **FLUX.2 klein**):
1. Place the new diffusion/CLIP/VAE weights in `C:\ComfyUI\ComfyUI_windows_portable\ComfyUI\models\...`.
2. Export the ComfyUI API-format JSON keeping prompt on node `"5"`, latent size on node `"7"`, sampler seed/steps on node `"8"`, and `SaveImage` on node `"10"`.
3. Test with a single `post_4x5` generation and verify VRAM stays within 12 GB and `/free` releases it cleanly.
