# TikTok agent: your clips → a video with a Malay caption → posted every day

The **TikTok** agent makes faceless TikTok videos from your own clips (scenery, walking, static shots):
1. it picks clips that fit a theme;
2. cuts a 7–15 s vertical video;
3. puts a hook text in the middle (with music if you have some);
4. writes the post caption in Bahasa Malaysia;
5. posts it through **Zernio** (zernio.com, formerly getlate.dev).

It runs when you ask (Chat or Telegram) and, if you switch it on, every day at 20:00.

## Set it up (once)
1. **Clip folder.** Make a folder on the runner PC, for example `C:\MyOfis\tiktok-clips`.
   - Drop your videos in (MP4, MOV, WebM, MKV). Shoot them on your phone; vertical clips work best.
   - Optional: a `music` folder inside with royalty-free songs (MP3, M4A, WAV). TikTok mutes copyrighted songs.
   - Tip: **Syncthing** (free) on the phone and the PC sends new phone videos into this folder by itself.
2. **Zernio.** In Zernio, connect your TikTok account, then make an API key (Settings → API keys).
3. **Project.** In Agent Office → Projects, make a project for the account (for example "Healing MY"). Then go to Brief → **TikTok (via Zernio)**:
   1. paste the key and save;
   2. choose your TikTok account;
   3. press **Test**.
4. **Agent.** Agents → **TikTok**:
   1. set **Clip folder**;
   2. turn on **Post without approval** if you want it to post by itself (max posts a day: 1–15; Zernio allows 15 videos a day per account);
   3. turn the agent on.
5. **Daily schedule.** Schedules → "Video TikTok harian" (20:00): turn it on or change the time.
6. **Restart** the runner after updating.

## Use it
- **Chat / Telegram** (`/agent tiktok`): "buat video pasal rindu kampung", "3 video motivasi kerja", "guna klip pantai".
- **Every day at 20:00** it picks its own theme and never repeats a recent hook or caption.
- **With Post without approval on:** the video is posted straight away. Telegram says "📤 TikTok posted …", and the TikTok link appears in Drafts a few minutes later.
  - Over the daily limit, the video waits in Drafts for you.
  - If the post fails, the error stays on the draft: press **Publish again**.
- **With it off:** the video waits in Drafts and on Telegram as usual; approve it to post.

## How it chooses clips
- `clip_library` keeps `.myofis-clips.json` in the folder. It records each clip's length, shape and a one-line description of what it shows; the agent's own model (canopy-ai) looks at three frames, once per clip.
- It also records when each clip was last used.
- **Picking order:**
  1. clips not used in the last 7 days;
  2. clips whose description matches the theme;
  3. the least used.
- A clip is uploaded to the hub once and reused later.

## Captions
The built-in skill **tiktok-captions-bm** (Skills page) holds the rules:
- a hook in the first words;
- the same idea on the video and in line 1 of the caption;
- 1–2 lines, then a question or "tag kawan";
- 3–5 relevant hashtags (`#fypmalaysia` plus the niche and topic);
- no fake facts, no copied lines.

You can edit the skill on the Skills page.

## Notes
- Videos post as **public**. TikTok asks creators to confirm what they post; turning on "Post without approval" is that confirmation for this agent.
- Only post clips and music you own or may use.
- The Zernio key is kept encrypted on the hub. It never reaches the browser or the runner.
