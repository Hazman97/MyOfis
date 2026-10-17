# Website publishing (Publisher agent)

You chat with **Publisher** in Agent Office: send photos and a few points. It writes a post for one of your websites (news, tournament, vlog…) plus a social caption. Both land in **Drafts**. When you press **Approve**, Agent Office sends the post to the website, and it goes live.

Every website needs one small endpoint. SmashPoint already has it (`worker/src/agentOffice.ts`). Any other project can add the same one.

## 1. Set up SmashPoint (once)

All of this is done on the smashpoint repo, in `worker/`:

1. **Service account.** In the Firebase console, open project **badminton-court-c4c0f** → ⚙ Project settings → **Service accounts** → **Generate new private key**. This downloads a JSON file.
   - Keep the file secret: it can write anything in Firestore.
   - Delete the downloaded file after step 3.
2. **Shared secret.** Make one long random value, e.g. `openssl rand -hex 32` or in PowerShell `[guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")`.
3. **Put both into the Worker and deploy:**
   ```sh
   cd worker
   npx wrangler secret put AGENT_OFFICE_SECRET        # paste the shared secret
   npx wrangler secret put FIREBASE_SERVICE_ACCOUNT   # paste the whole JSON (one line is fine)
   npx wrangler deploy
   ```
   `deploy` prints the Worker URL, e.g. `https://smashpoint-api.<you>.workers.dev`.
4. **Connect it in Agent Office.** Open Projects → **SmashPoint** (create it if it is not there) → **Brief** → **Website** tab:
   - Publish endpoint: `https://smashpoint-api.<you>.workers.dev/agent-office/publish`
   - Shared secret: the same value as step 2

   Then **Save** → **Test**. It should say *Connected to SmashPoint · post types: news, match, tournament, event, vlog*.

## 2. Use it

1. Open **Chat** → **Publisher**, pick project SmashPoint, press 📷, add photos, and write the points. For example: *"Tournament doubles Sabtu 24 Okt pukul 9 pagi, hadiah RM500, yuran RM20 seorang, daftar kat kaunter"*.
2. Publisher looks at the photo, asks if something is missing, then drafts the post and a Facebook/Instagram caption.
3. In **Drafts**, check or edit the post, then press **Approve**. It is published, and the card shows **View it on the website →**.
4. If the site was down, the card shows the error and a **Publish again** button.

The post is created as `posts/ao-<draft id>` with `published: true`. Publishing the same draft twice never creates two posts.

## 3. The contract (for any other website)

Agent Office calls the URL you set, signing every request with the shared secret:

| Header | Value |
|---|---|
| `X-AO-Timestamp` | unix seconds; **reject if more than 5 minutes off** |
| `X-AO-Signature` | `v1=` + hex HMAC-SHA256(secret, `"<timestamp>.<raw body>"`); the body is empty for GET |

**`GET <url>`** must answer:
```json
{ "site_name": "My Site", "post_types": ["news", "event"] }
```

**`POST <url>`** sends this body:
```json
{
  "version": 1,
  "draft_id": "drf_…",
  "post": {
    "type": "news", "title": "…", "excerpt": "…", "body": "Markdown…",
    "tags": ["…"], "event_date": "2026-10-24", "event_time": "09:00",
    "location": "…", "video_url": ""
  },
  "cover": { "name": "court.jpg", "content_type": "image/jpeg", "data_base64": "…" }
}
```
`cover` may be `null`.

Answer `{ "id": "…", "url": "https://…" }` with status 2xx, or `{ "error": "…" }` with 4xx/5xx; the error is shown on the draft. Use `draft_id` to make retries safe.

A reference implementation is `smashpoint/worker/src/agentOffice.ts`: Cloudflare Worker, Web Crypto HMAC, Firestore REST with a service account.

## 4. Adding another website

Ask Claude in one line, with the repo path and where its posts live, e.g.:

> **"Sambung website `<nama>` ke Publisher. Repo: `C:\Users\Hazman\Documents\GitHub\<repo>`."**

Claude then:
1. reads the repo to find how posts are stored (Firestore, Supabase, D1, Markdown files, a CMS…) and which post types exist;
2. adds the `/agent-office/publish` endpoint following the contract above, in that site's own backend or Worker;
3. deploys it (with your OK);
4. creates the project in Agent Office, sets the secret and runs **Test**.

Things to have ready: the site's live URL, and the admin credentials its backend needs (e.g. a Firebase service account), given as a file path, never pasted in chat.
