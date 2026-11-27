# 059: Connect BijokPay — agents send a payment QR, MyOfis sees it paid

Owner (2026-11-27): agents send a DuitNow QR from BijokPay in WhatsApp/Telegram and know when it is paid. Examples:
SmashPoint booking → QR → paid → booking confirmed; Kutipan (057) → each member gets their own QR → paid → ✅ with no
receipt reading.

Read first: `tasks/gemini/SUPERVISOR.md`; the BijokPay repo next to this one
(`../bijokpay/docs/API.md`, `docs/integration.md`, `client/` = the TS client: `createPayment`, `verifyWebhook`);
`057-whatsapp-collection-bot.md`; `058-simple-crm.md`; CLAUDE.md "Telegram". BijokPay is live
(`https://bijokpay.hazman5001.workers.dev`). Do not change the BijokPay repo in this task; if something is missing
there, write it under "Needs from BijokPay" in the report.

## Part A — Connection
- Settings → Integrations → **BijokPay** (owner, per room allowed by owner): base URL, app API key (encrypted),
  webhook secret (encrypted), "Test" = a status call. Show the webhook URL to paste into the BijokPay app:
  `<PUBLIC_BASE_URL>/pay-hooks/bijokpay` — a public route (own Cloudflare Access **Bypass** app for path
  `pay-hooks`, like 038/049/054). Verify the signature exactly as BijokPay's `verifyWebhook` does (copy the client
  code or import it as a workspace dependency — pick one, say why), 5-min window, idempotent by event id.
- Table `payments_link {id, workspace_id, bijokpay_payment_id, order_ref, purpose: booking|collection|other,
  ref: {kind, id}, amount_sen, pay_amount_sen, status, qr_upload_id, created_at, paid_at, confirmed_by}`.

## Part B — Making a payment
- Hub `createPayment({purpose, ref, amount_sen, customer})` → BijokPay `POST /v1/payments` (idempotent `order_ref`
  = `myofis:<purpose>:<ref id>[:<period>]`) → stores the QR card PNG as an upload → returns it.
- Agent tool **`payment_request {amount, purpose, ref, customer_name?}`** (risk **review**: the owner approves
  before a QR goes out, unless the agent has `auto_payment_request` switched on by the owner with a max amount).
  The tool result is the QR upload, which reply paths (046 DM reply, 057 WhatsApp, Telegram chat) can attach.
- Never let an agent or customer mark a payment paid: only the signed BijokPay webhook (`payment.paid`) or the
  owner's manual decision does.

## Part C — Uses
1. **Kutipan (057)**: per collection option "Bayar guna QR BijokPay". At the start of each period the bot DMs each
   active member their own QR (exact unique amount from BijokPay) + payee line. `payment.paid` → payment `paid`,
   `decided_by: bijokpay`, react/list update as in 057. Receipt reading stays as the fallback.
2. **SmashPoint booking**: when the site reports a new unpaid booking (Kerani site data, or a future site webhook —
   check what the SmashPoint Worker exposes; if nothing, poll `read_bookings` every 5 min for `unpaid`), create the
   payment and send the QR through the customer's channel; `payment.paid` → call the site's endpoint to confirm the
   booking (needs a new `action: confirm_booking` on the SmashPoint Worker — write it under "Needs from SmashPoint"
   and stop there if it does not exist).
3. **Telegram**: owner command `/qr 25.00 Sewa kamera Ali` → QR photo back to forward by hand.
4. CRM (058): every payment becomes a contact event with the amount.

## Part D — Status
`/payments` (room) list: purpose, customer, amount, status, time, link to the ref; filters; Telegram notice on each
paid payment (one line) and on `payment.rejected`/`expired`.

## Tests (fake BijokPay over HTTP)
Signature good/bad/old/replayed; idempotent create; `payment_request` needs approval; auto mode respects max
amount; webhook marks the right collection payment and booking; agent cannot mark paid; cross-room ids → 404.

## Proof
Raw new tests, `bun run typecheck`, full `bun test`, web build final lines; screenshots of settings and `/payments`.
A real RM 0.10 test is done by the owner. Anything not run is NOT RUN. Do not commit.
