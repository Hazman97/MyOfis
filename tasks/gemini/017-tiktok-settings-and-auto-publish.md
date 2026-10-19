# Task 017: TikTok (Zernio) card and the agent's auto-post settings

The owner is building a **TikTok agent**:
1. he drops random clips (scenery, walking, static shots) into a folder on his PC;
2. the agent picks clips, cuts a short vertical video, adds a hook text and a Malay caption;
3. it posts straight to TikTok every day through **Zernio** (zernio.com, formerly getlate.dev), where the owner already connected his TikTok account.

Claude builds the back end at the same time. You build two UI pieces.

## The contract (already in the code; do not change it)
- `apps/web/src/api/http.ts`:
  - `TikTokSettings {has_key, key_hint, account_id, username, display_name, accounts: {id, username, display_name, followers, needs_reconnection}[]}`;
  - `api.tiktokSettings(projectId)`;
  - `api.saveTikTok(projectId, {api_key?, account_id?})`: `api_key` omitted = keep it, `""` = remove it;
  - `api.testTikTok(projectId)`: asks Zernio again for the accounts.
- `AgentConfig` (packages/shared) gained:
  - `clip_folder` (a path on the runner PC);
  - `auto_publish` (boolean, "post without approval");
  - `auto_publish_daily_max` (1–15, default 3).

  `AgentsView.vue` already has working, plain fields for them (Claude added them; owner only via `isOwner`).
- Until Claude's back end lands, the TikTok calls may return 404. Show the error text and never crash.

## Scope: edit ONLY
- New `apps/web/src/components/TikTokSettings.vue`, and add it to `apps/web/src/components/BriefPanel.vue` right after `<SocialSettings …/>` (one line plus the import).
- `apps/web/src/views/AgentsView.vue`: only restyle the block marked `<!-- clip folder + posting without approval -->`. Keep `v-model`s, the `isOwner` check and the save logic as they are.

Never delete, rename or move files. No new packages. Do not run `git commit`. Do not edit `api/http.ts`, `packages/` or `apps/hub/`.

## What to build
1. **TikTokSettings card** (same look as the Facebook / Instagram & Threads cards next to it):
   - **Title:** "TikTok (via Zernio)", with a short line: "Post approved TikTok videos through your Zernio account. Get the API key in Zernio → Settings → API keys."
   - **API key field** (password type):
     - when a key is saved, show `key_hint` with buttons "Replace" and "Remove";
     - Save calls `saveTikTok(projectId, {api_key})`.
   - **Accounts:** after a key is saved, list `accounts` as radio cards (avatar initial, @username, display name, followers).
     - Choosing one calls `saveTikTok(projectId, {account_id})`.
     - Mark `needs_reconnection` accounts in red with "Reconnect it in Zernio".
   - **Test button** (`testTikTok`): shows "Connected as @username" or the error.
   - **Status chip:** "Not set" / "Choose an account" / "Ready".
   - **Help text:**
     - TikTok allows 15 videos a day per account;
     - videos post publicly;
     - the owner should only post clips he owns or may use.
2. **AgentsView "Clip folder & auto-post" block:**
   - a clear sub-section with a folder icon and helper text: "Drop videos here; a `music` folder inside holds royalty-free songs";
   - a proper toggle switch (like "Learn after work") for **Post without approval**, with a clear warning box when on, and the daily max as a small number stepper (1–15).
3. **Phone (390 px):** no horizontal scroll; tap targets ≥ 40 px. Light and dark.

## Rules
- Use the design system in `apps/web/src/style.css` (tokens; `card`, `btn`, `chip`, `label`, `input`, `sign`). English UI text.
- Never show or log the API key after saving; the field clears after Save.

## Check before you hand back
- `bun run --cwd apps/web typecheck` and `bun run --cwd apps/web build` pass.
- Open a project (Projects → Brief panel) and an agent's edit form, at desktop width and 390 px, light and dark.
- Tell the owner you are done; Claude reviews the diff.
