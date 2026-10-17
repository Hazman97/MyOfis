# Facebook Page posting

When a project has its Facebook Page connected, **approving a Facebook caption posts it to the Page**: a photo post if the caption has the owner's photo, otherwise a text post. The draft card then shows **View it on Facebook →**. Without a connected Page, approving only records the caption, and you copy it by hand.

You need two things from Meta: the **Page id** and a **Page access token** that does not expire. Do this once per Page. You must be an admin of the Page.

## 1. Create a Meta app (once)
1. Go to **developers.facebook.com** → **My Apps** → **Create App**.
2. Choose the use case for managing a Page / "Other" → app type **Business**. Name it e.g. `Agent Office`.
3. The app can stay in **Development** mode: it can post to Pages you admin without App Review.
4. Under **App settings → Basic**, copy the **App ID** and **App Secret**.

## 2. Get a short-lived user token
1. Open **developers.facebook.com/tools/explorer** (Graph API Explorer) and pick your app.
2. Under **Permissions**, add `pages_show_list`, `pages_read_engagement` and `pages_manage_posts`.
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

## Instagram
Not automatic yet: Instagram's API only accepts a photo at a public URL, while photos sent to Agent Office stay private in the hub. It can be added later by publishing the photo through the website's storage first (e.g. storage.bijokdev.com via the SmashPoint Worker), then calling the Instagram Graph API with that URL.
