# Editor: video editing on your own PC

Editor is a built-in agent that cuts, reframes and exports your videos with **ffmpeg on the runner PC**. Nothing goes to a cloud editor, and nothing is posted until you approve the draft.

## What you need
- **ffmpeg** on the runner PC (on this PC it is in `C:\ffmpeg\bin`). The Runners page lists `ffmpeg` under the runner's programs when it is found.
- An NVIDIA GPU is optional. If there is one, Editor encodes with **h264_nvenc** (fast); otherwise it uses **libx264** on the CPU. It switches by itself.

## Use it
1. Open **Chat** and pick **Editor** (in Telegram: `/agent editor`).
2. Attach one or more videos (📎, up to 10 files). Big files are sent in 32 MB parts, and the composer shows the percentage.
   - Web chat takes videos up to 2 GB.
   - Telegram takes videos up to 20 MB (a Telegram limit for bots).
3. Say what you want, for example:
   - "Compress ni untuk TikTok" → one clip, the whole video, TikTok FHD.
   - "Buat highlight 30 saat, ambil smash dari minit 1:20 sampai 1:35, slow motion, tulis 'Tournament Sabtu ni'".
4. Editor runs `video_probe` (length, size, sound, scene changes), then `video_edit`, then saves a **video draft** for each platform with a caption.
5. In **Drafts** you can play the video, **Download video**, edit the caption, and then approve or reject. In Telegram, a video draft arrives with the video if it is up to 50 MB.

Until TikTok or YouTube posting is connected, approving only records the draft. You download the video and post it yourself.

## Presets
| Preset | Size | Longest |
|---|---|---|
| `tiktok_fhd` | 1080×1920 (9:16) | 10 min |
| `reels` | 1080×1920 | 3 min |
| `youtube_shorts` | 1080×1920 | 3 min |
| `youtube_1080p` | 1920×1080 (16:9) | 4 h |
| `square` | 1080×1080 | 10 min |

All presets produce H.264 High + AAC 48 kHz in an MP4 with faststart, with these settings:
- frame rate 30 by default (24/25/30/50/60 allowed);
- peak bitrate 12–16 Mbit/s (NVENC CQ 21 / x264 CRF 20);
- loudness evened to about −14 LUFS.

The quality is high so that TikTok's own re-encode starts from a clean picture.

**Fit** (a wide video in a vertical preset):
- `crop` fills the screen and cuts the sides;
- `blur` puts the whole picture on a blurred copy of itself;
- `pad` puts the whole picture on black.

**Captions** are burned in: big white bold text with a black outline, placed above TikTok's buttons. Editor writes only your words or facts from the brief.

## Limits (for now)
- Editor cannot see the picture. It cuts at the times you give, or at the scene changes ffprobe finds. If you want a specific moment, say the time.
- There is no background music or voice-over yet.
- Posting to TikTok and YouTube is not connected yet: download and post them yourself.

## Where files live
- Uploads and renders: `FILES_DIR/uploads/` on the hub. Renders are tied to their run (`uploads.run_id`).
- While a run works: `<workspace>/media/` on the runner (`in-1.mp4`, `<name>-<preset>.mp4`, `<name>.ass`).
- Nightly backups mirror `data/files` (uploads and renders) once into `data/backups/files/` (new files only, never pruned). Keep the backups folder on a disk with room for your videos.
