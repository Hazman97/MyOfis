# Facebook, Instagram & Threads posting

When a project has its Facebook Page connected, **approving a Facebook caption posts it to the Page**: a photo post if the caption has the owner's photo, otherwise a text post. The draft card then shows **View it on Facebook →**. Without a connected Page, approving only records the caption, and you copy it by hand.

You need two things from Meta: the **Page id** and a **Page access token** that does not expire. Do this once per Page. You must be an admin of the Page.

## 1. Create a Meta app (once)
1. Go to **developers.facebook.com** → **My Apps** → **Create App**.
2. Choose the use case for managing a Page / "Other" → app type **Business**. Name it e.g. `Agent Office`.
3. The app can stay in **Development** mode: it can post to Pages you admin without App Review.
4. Under **App settings → Basic**, copy the **App ID** and **App Secret**.

## 2. Get a short-lived user token
1. Open **developers.facebook.com/tools/explorer** (Graph API Explorer) and pick your app.
2. Under **Permissions**, add `pages_show_list`, `pages_read_engagement` and `pages_manage_posts`; for Instagram also `instagram_basic` and `instagram_content_publish`.
3. Press **Generate Access Token**, log in, and allow your Page.

## 3. Turn it into a Page token that never expires
In a browser or with curl (replace the CAPITALS):
```
https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=SHORT_USER_TOKEN
```
Copy the `access_token` from the answer (a long-lived user token), then open:
```
https://graph.facebook.com/v21.0/me/accounts?access_token=LONG_USER_TOKEN
```
Find your Page in the list, then copy its `id` (the **Page id**) and its `access_token` (the **Page access token**). A Page token from a long-lived user token does not expire.

Treat these like passwords: paste them only into Agent Office, never into chat.

## 4. Connect it in Agent Office
1. Open **Projects → (project) → Brief → Website** tab → **Facebook Page**.
2. Fill in the Page id and the Page access token, then **Save** → **Test**. It should say *Connected to <Page name>*.

## Use it
- Publisher writes a Facebook caption next to each website post, with the same photo.
- Approve it in **Drafts** or with **✅ Approve & post to Facebook** in Telegram, and it is posted.
- If posting fails (expired token, Page permissions), the card shows the error and **Publish again**.

## Instagram (Business or Creator account)
Instagram uses the **same Page token** as Facebook.
1. In the Instagram app, switch the account to **Professional** (Business or Creator) and link it to the Facebook Page: Settings → Account type and tools / Accounts Center.
2. Make sure the token had `instagram_basic` and `instagram_content_publish` when you generated it (step 2 above). If not, generate it again and paste the new Page token.
3. In Agent Office, open Projects → (project) → Brief → **Website** → **Instagram & Threads** → **Connect Instagram**. It should show `@your_account · posting on`.

Instagram only takes a photo from a public link. Agent Office first puts the photo on the website's storage (SmashPoint: storage.bijokdev.com), then posts it. So:
- the **website endpoint must be connected**;
- an Instagram caption **must have a photo**.

## Threads
Threads has its own token:
1. In the same Meta app on developers.facebook.com, add the **Threads API** use case with the permissions `threads_basic` and `threads_content_publish`.
2. Under **Roles → Threads testers**, add your Threads account, then accept the invite in Threads: Settings → Account → Website permissions → Invites.
3. In the app's Threads settings, use **Generate access token** (User Token Generator) for your account and copy the token.
4. In Agent Office, go to **Instagram & Threads** → paste it in **Threads access token** → **Save & check**. It should show `@your_account`.

Threads posts are text (up to 500 characters) or text + photo. Photos also go through the website's storage.

> ⚠️ Long-lived Threads tokens last about **60 days**. When posting starts failing with a token error, generate a new one and paste it again.

## TikTok and YouTube
Planned:
- **YouTube / Shorts**: through Google's API, with video upload.
- **TikTok**: through a browser agent that uses a logged-in Chrome and stops before **Post** until you approve.
