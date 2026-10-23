# Notulis: meeting recordings → transcript → notes

Record a meeting on your phone, send the file to **Notulis**, get back a clean transcript and proper notes
(summary, what changed against the project's documents, decisions, action items). Transcription runs with
whisper.cpp on the runner PC: offline and free, the recording never leaves the PC.

## Use it
- **Chat → Notulis**: pick the project, attach the recording (M4A, MP3, WAV, OGG/Opus, AAC, FLAC, AMR, or a
  video), up to 2 GB (sent in 32 MB parts). Write names and terms in the message ("Ryan, Amir; UC300, RS485")
  so the notes spell them right.
- **Telegram**: a voice note or an audio file up to 20 MB (Telegram's limit for bots). Longer meetings: use Chat.
- Results:
  - **Projects → Docs**: `Transkrip - <file> - <upload id>.txt` (times every minute) and
    `Nota mesyuarat <date> - <project>.md`;
  - **Projects → Log**: the meeting, decisions and action items (with owner / due date when said).
- Later questions ("apa keputusan pasal kipas?") are answered from the saved transcript, with the time in the
  recording. The recording is not transcribed twice.

## Without MyOfis: Send to → Transkrip
`scripts/transkrip.ps1` (installed copy: `C:\whisper\transkrip.ps1`) with a Send To entry
`%APPDATA%\Microsoft\Windows\SendTo\Transkrip (Whisper).cmd`:

```bat
@powershell -NoProfile -ExecutionPolicy Bypass -File "C:\whisper\transkrip.ps1" %*
```

Right-click any recording → Send to → Transkrip (Whisper): `<name>.txt` and `<name>.srt` appear next to it.
`TRANSKRIP_LANG=en` for English-only meetings (default `ms`, which also handles Manglish).

## Setup (runner PC)
- whisper.cpp (`C:\whisper\bin\Release\whisper-cli.exe`, or `WHISPER_CPP`) and a speech model
  (`ggml-large-v3-turbo-q5_0.bin`, or `WHISPER_MODEL`): see docs/video-editor.md → Transcripts.
- **The VAD model** (recommended, ~1 MB): `ggml-silero-v5.1.2.bin` from
  `https://huggingface.co/ggml-org/whisper-vad` in `C:\whisper\models` (or `WHISPER_VAD_MODEL`). Without it
  transcripts still work, with more invented lines in quiet stretches.
- ffmpeg + ffprobe on PATH. The runner reports `whisper`, so these jobs go to a runner that has it.

## Why these settings (tested 2026-10-23 on real meetings)
Phone recordings of meetings are quiet (about −35 dB mean) and several people talk at once. With whisper's
defaults the result was unusable: it invented YouTube outros ("Terima kasih kerana menonton!") in silences
and, once wrong, repeated one line hundreds of times. What fixed it:

| Step | Setting |
|---|---|
| Clean the sound | `highpass=f=80,lowpass=f=7500,afftdn=nf=-25,dynaudnorm=f=250:g=15:p=0.9:m=20`, 16 kHz mono |
| Only speech goes to whisper | `--vad -vm ggml-silero-v5.1.2.bin -vt 0.4 -vsd 400 -vp 200` |
| No carried context (stops loops) | `-mc 0`, plus `-sns -et 2.2` |
| Remove what is left | `cleanSegments` (packages/shared/src/meeting.ts): outros, repeats, loops |

On the RTX 3060: about 2 minutes per hour of audio.

Editor's `video_transcribe` does **not** use VAD yet: with VAD the word times moved by up to ~1.2 s in a test
clip, and Editor cuts and subtitles by those times. Check that on real edits before switching it.
