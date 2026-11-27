# 060: SmashPoint WhatsApp agent (official Cloud API + Coexistence, owner's local AI)

Owner (2026-11-27): an AI agent answers SmashPoint customers on the existing SmashPoint WhatsApp number, books
slots and takes payment. It must run on the **owner's own local AI** (canopy-ai / 9Router on this PC), not a paid
outside model. The business number must never risk a ban → **official WhatsApp Cloud API**, connected with
**Coexistence** so the owner/staff keep using the WhatsApp Business app on the same number.

Read first: `tasks/gemini/SUPERVISOR.md`, `046-comments-dm-replies.md` (approve-first reply drafts, 24 h rule,
untrusted customer text), `058-simple-crm.md`, `059-bijokpay-link.md`, Kerani (`read_bookings`,
`Publisher.siteData`, SmashPoint Worker), CLAUDE.md "Switching models" (model "auto", local providers),
"Editor hears speech" (whisper), public route rules (separate Access Bypass app per path).
Depends: 059 for payments (Part D); Parts A–C and E–F can ship first.

## Verify first (developers.facebook.com, write URLs + date in the report)
Coexistence onboarding (Embedded Signup with the Business app number), webhook setup (`GET` verify with
`hub.verify_token`, `POST` with `X-Hub-Signature-256` = HMAC-SHA256 of the raw body with the **app secret**),
message types we use (text, interactive list/buttons, location, image, audio, document, reaction, template),
the 24-hour customer service window, current pricing (it changed in 2025 and again around 2026-10-01 — write what
is charged and what is free today), and the "app messages are not synced to the API" limit.

## Part A — Connection (hub)
- Settings → Integrations → **WhatsApp (rasmi)** per project: WABA id, phone number id, access token (system user,
  encrypted), app secret (encrypted), verify token (generated). "Test" = fetch the phone number's display name.
- Public webhook `GET/POST /wa-hooks/meta` (own Access Bypass app for path `wa-hooks`; registered before `/api`).
  Constant-time signature check on the **raw** body; idempotent by message id; reply 200 fast and process in the
  background. Status callbacks (sent/delivered/read/failed) update our records.
- `docs/whatsapp-smashpoint.md`: the owner's setup steps (Meta Business verification, Coexistence signup from the
  Business app, system user token, webhook URL + verify token, the Bypass app), with the pricing line.

## Part B — Conversations
- Tables: `wa_threads {id, workspace_id, project_id, customer_wa_id, contact_id (058), last_inbound_at,
  window_open_until, state: bot|human|closed, human_until?, lang}`, `wa_messages {id, thread_id, direction, kind,
  body, media_upload_id?, wa_message_id, status, created_at}`.
- Inbound text/image/audio/document/location → stored; audio → whisper (`video_transcribe` path, VAD on, ≤ 3 min)
  → text; images → the agent sees them only if the chosen local model has vision (check `modelCandidates`; else
  "gambar diterima" note).
- Customer text, transcripts and image text are **UNTRUSTED** (`memoryContentProblem`), never instructions.
- Owner/staff replying from the Business app are not visible to the API: the owner can press "Saya ambil alih"
  in MyOfis/Telegram (thread → `human` for 12 h), and `/bot` hands it back.

## Part C — The agent (built-in `smashpoint-wa`, seeded **disabled**)
- Runs on the owner's **local provider**: seeded with the provider + model "auto" of the owner's local provider
  (canopy-ai / 9Router; pick by `base_url` being loopback/LAN; if none exists, leave it unset and say so in the
  Agents page). Never falls back to a paid outside provider unless the owner picks one.
- Tools: `read_brief`, `read_bookings`, `crm_lookup`, `wa_reply {text | list | buttons | location}`,
  `wa_send_booking_options {date}` (interactive list of free slots), `booking_hold {date, slot, name, phone}`
  (needs a SmashPoint Worker action — write under "Needs from SmashPoint" if missing and stub it), `payment_request`
  (059), `handover {reason}`, `memory`.
- Prompt (BM-first, Manglish OK): facts only from the brief + bookings; never invent prices/slots; short messages;
  one question at a time; hand over on complaints, refunds, injuries, disputes, anything not in the brief.
- **Approve-first by default**: every `wa_reply` becomes a draft (`kind: whatsapp`), sent when the owner approves
  (web DraftCard / Telegram card with Hantar / Ubah / Abaikan, signed callbacks). Per-project switch **"Auto untuk
  soalan mudah"**: price/hours/location/slot-availability answers whose facts come only from tools are sent
  directly (the hub checks the reply type and that the run used only read tools); everything else stays
  approve-first. Daily max auto replies (default 100).
- Outside the 24 h window only approved **templates** may be sent (reminders, follow-ups); the tool refuses free text
  there.

## Part D — Booking + payment
Flow: customer asks → `wa_send_booking_options` → customer picks → `booking_hold` (15 min hold) → `payment_request`
→ QR image sent → BijokPay `payment.paid` → booking confirmed on the site → confirmation message + receipt. Hold
expires → slot released + polite message. Agent can never mark paid.

## Part E — When the local AI is down
If the provider fails (model check or first-step failure) or the runner is offline for > 2 min while a customer
waits: send once per thread per 6 h the holding reply "Terima kasih! Staf kami akan balas sekejap lagi 🙏" (owner
can edit the text; it is a free-text reply, so only inside the 24 h window), notify the owner on Telegram, queue
the thread; when the AI is back the agent answers the queue oldest first.

## Part F — Extras (each behind a per-project switch, default off)
- Booking reminder the day before (approved template), with "Tukar slot" / "Batal" buttons.
- After-session review request (template) with the project's Google review link (brief field `review_url`).
- Follow-up for "asked price, didn't book in 48 h" (from 058 `followUps`), approve-first.
- Business-hours auto reply (brief `opening_hours`), then the thread waits for the owner.
- Promotions only to contacts with marketing consent, via approved templates, max 1 per contact per week.

## Tests (fake Meta Graph + fake BijokPay + fake local provider)
Webhook verify handshake; bad/missing signature refused; duplicate message id processed once; voice note →
transcript → agent text; untrusted text flagged; approve-first creates a draft and sends nothing until approved;
auto mode sends only simple read-only answers; outside-window free text refused, template allowed; human takeover
blocks the bot; AI-down holding reply once + Telegram notice + queue drained later; booking hold → payment →
confirm (stub site); agent cannot mark paid; cross-room ids → 404.

## Proof
Raw new tests, `bun run typecheck`, full `bun test`, web build final lines; screenshots (360 px) of the WhatsApp
settings, a thread in MyOfis, the Telegram draft card text. A real test on the SmashPoint number is done by the
owner after Meta setup. Anything not run is NOT RUN. Do not commit.
