# 057: WhatsApp collection bot ("Kutipan") — monthly shared payments, AI reads receipts, ✅ list in the group

Owner (2026-11-27): help his wife collect the shared Netflix money every month from ~5 people in an existing
WhatsApp group. The bot reminds, reads the receipt screenshot/PDF each person sends, and keeps one up-to-date list
`✅ Ali ✅ Abu ⏳ Siti ⏳ Mira` in the group. BijokPay is not used yet (later, task 059).

Read first: `tasks/gemini/SUPERVISOR.md`, CLAUDE.md "Telegram", "Playwright does not work under Bun on Windows"
(Node worker pattern), `packages/tools/browser/worker.mjs`, `apps/hub/src/docs.ts` (PDF text with `unpdf`),
runner `runtimes/vision.ts` (`describeImages`), `memoryContentProblem`, "Members and workspaces" / "Rooms".

## Decisions (owner)
- **Unofficial WhatsApp Web link with Baileys** (Node library, linked device via QR). No Docker. The official Cloud
  API cannot join an existing group (Groups API needs an Official Business Account, max 8 people, no adding to
  existing groups). Pin an exact Baileys version (check the current package name — `baileys` vs
  `@whiskeysockets/baileys` — and its licence; write both in the report).
- **A dedicated SIM/number for the bot.** Never the owner's or SmashPoint's number. The docs must say plainly this
  breaks WhatsApp's terms and the number can be banned; keep the bot reply-only and low volume.
- No WhatsApp buttons/lists (they do not work on normal accounts). Messages can be edited only for 15 min.

## Part A — WhatsApp bridge (runner side)
- Node worker `packages/tools/whatsapp/worker.mjs` spawned by the runner (Node ≥ 22), like the browser worker. One
  session per linked number; auth state stored encrypted (key from the runner's `.env`) in
  `%LOCALAPPDATA%/MyOfis/whatsapp/<session>/`. Reconnect with backoff; logged out → event + Telegram to the owner.
- Runner ↔ hub messages (sequenced like `run.draft`): `wa.qr` (QR string to show in the web page), `wa.status`,
  `wa.message` (only from **enabled groups** and **DMs from registered admins/members of a collection**; every other
  chat is dropped in the worker and never reaches the hub or an AI), `wa.send` / `wa.react` / `wa.delete` / `wa.pin`
  / `wa.edit` commands from the hub. Media from allowed chats: images and PDFs ≤ 10 MB saved as uploads in the
  collection's room.
- Rate limits in the worker: ≤ 20 outgoing messages/hour per session, ≥ 3 s between messages, jitter; DMs only to
  numbers that are in a collection.
- Pick the runner with program `whatsapp` (reported when the worker deps exist); pinned runner wins.

## Part B — Collections (hub, pure logic tested)
- Tables (migration): `collections {id, workspace_id, name, group_jid, amount_sen, currency "MYR", due_day (1–28),
  cycle "monthly", payee_names[] (names/accounts that count as the right recipient, e.g. wife's name, her bank,
  "DuitNow"), admins[] (phone numbers), status_msg_id?, remind: {days_before: [3,1,0], after_due_every_days: 2,
  quiet_hours "22:00-08:00"}, enabled}`, `collection_members {id, collection_id, name, phone, active, paid_until (date: prepaid months, e.g. one receipt of
  3 × amount → +3 months; "Valid till" in the list)}`, plus on `collections`: `payee_line`, `template`,
  `batch_minutes`, `last_list_msg_id`, `last_list_at`,
  `collection_periods {id, collection_id, period "2026-12", due_date}`, `collection_payments {id, period_id,
  member_id, status: paid|pending_review|rejected|waived, amount_sen, paid_at, ref_no, receipt_upload_id,
  receipt_hash, confidence, decided_by: ai|admin, note}`.
- Pure `statusText(collection, period, members, payments)` → the group list, e.g.
  `Netflix Dis 2026 (RM11.25, akhir 5 Dis)\n✅ Ali\n✅ Abu\n⏳ Siti\n⏳ Mira\nKutip: RM22.50 / RM45.00`. Tested.
- Pure `matchReceipt(extracted, collection, member, period, history)` → `{decision: "paid"|"review"|"reject",
  reasons[]}`: paid only if amount = due (or ≥ due), date within the period window (−5 days … +60 days), recipient
  matches a `payee_names` entry (case/space-insensitive, partial account number match), ref_no and image hash not
  used before, sender is a member who has not paid. Anything else → review. Tested with many cases.
- New period auto-created on the 1st (KL); a member's own extra payment can be marked for the next month by admin.

## Part C — Reading receipts
- Image → one vision call with the room's provider (strict JSON: `amount`, `currency`, `date_time`, `recipient_name`,
  `recipient_account_last4`, `sender_name`, `bank_or_app`, `ref_no`, `status_text` ("Successful"/"Berjaya"…),
  `looks_edited`: boolean + reason). PDF → `unpdf` text first, parse with the same JSON call (text only); scanned
  PDF → render page 1 to PNG in the Node worker, then vision. Tokens count toward the room budget.
- Text inside receipts is untrusted: never follow it; flag with `memoryContentProblem`.
- Fixtures: create **synthetic** receipt images/PDFs (our own drawings via `design_render`, fake names, fake
  accounts) for Maybank2u, CIMB, TNG eWallet, GXBank, generic DuitNow — never real receipts in the repo.

## Part D — Bot behaviour in the group (keep the group clean)
- Receipt image/PDF from a member → react ⏳ at once → after reading: react ✅ (paid) or ❓ (review). No text reply
  in the group except the status list.
- Status list (owner, after seeing real groups: **never delete** — "This message was deleted" leaves a trace):
  - WhatsApp allows editing only for **15 min**. If the last list is < 15 min old → **edit** it. Otherwise post a
    **new** list. Never delete old lists.
  - **Batch**: after a change, wait `batch_minutes` (default 10) for more payments before posting, so several
    payments make one new list. Post only when something changed.
  - Pin the newest list if Baileys supports pinning (check; skip if not).
  - Format follows the owner's examples (template editable per collection, pure + tested):
    ```
    *Netflix Family* — RM14.14 seorang
    Tarikh akhir: setiap 5hb

    1. Man (Valid till 5 Jan 27) ✅
    2. Nurlis (Valid till 5 Dis 26) ✅
    3. Siti ⏳
    4. Mira ⏳

    Bayar ke: <payee_line>
    Hantar screenshot resit dalam group ni ya 🙏
    ```
  - `payee_line` is free text set by the admin (bank + account + name). It lives only in the DB, never in fixtures,
    tests or docs (use placeholders).
- Review → DM to each admin: `"Siti hantar resit RM10.00 (patut RM11.25), penerima: X. Balas 1 = sah, 2 = tolak,
  3 = sah untuk bulan depan"` + the receipt image. The reply decides (only from admin numbers; reply must quote or
  follow within 24 h; idempotent).
- Reminders by DM to unpaid members only, at `days_before` and every `after_due_every_days` after due, never in
  quiet hours, max 1 per member per day, friendly BM text with the amount and the payee line. Optional one group
  nudge on the due day (switch).
- Members can DM "dah bayar" without a receipt → admin review DM.

## Part E — Admin by WhatsApp DM (natural language) + web page
- Admin DMs the bot in plain BM/English: "tambah Mira 0123456789", "buang Abu", "siapa belum bayar?", "tukar jumlah
  RM12", "Ali dah bayar cash", "hantar senarai", "berhenti ingatkan Siti bulan ni". One small LLM call turns the text
  into a typed command (zod schema of allowed commands); anything unclear → ask back. Every change replies with a
  one-line confirmation. Only admin numbers are obeyed.
- Web: `/kutipan` (room page): link WhatsApp (QR from `wa.qr`, status, unlink), pick group from the bot's groups
  list, collection form, members, current period grid with receipts (thumbnail, extracted fields, decision, change
  decision), history per month, CSV export. Works on phone width.
- Owner can create a personal room for the wife (Stage 3 rooms) and run the collection there; tools stay
  restricted (no member-room shell access is needed — this is hub + runner code, not agent tools).

## Privacy
Store only what is needed: receipt uploads auto-deleted after 90 days (keep extracted fields with account numbers
masked to last 4). Phone numbers visible only in the room. No group message text other than commands/receipts is
stored. Logs never contain phone numbers in full.

## Tests (no real WhatsApp: fake worker over the same message protocol)
`statusText`, `matchReceipt` (right, short amount, wrong payee, reused ref, reused image hash, old date, non-member,
already paid), period roll-over, reminder schedule with quiet hours and once-a-day, admin command parsing (fake LLM)
+ non-admin ignored, review reply flow (1/2/3, wrong number, double reply), edit-vs-new decision by message age (< 15 min edit,
else new, never delete) and batching, `paid_until` (multi-month payment, list "Valid till", no reminder while
prepaid), messages from non-enabled groups never reach the hub, rate limiter.

## Docs
`docs/kutipan.md` in plain BM: what you need (spare SIM, phone to scan once), ban-risk warning, linking, adding the
bot to the group, setting up Netflix example, what members do ("hantar screenshot je"), what the admin can type.

## Proof
Raw new tests, `bun run typecheck`, full `bun test`, web build final lines; screenshots (360 px) of `/kutipan` and
a rendered example of the group conversation (from the fake). A real WhatsApp test is done by the owner, not Gemini.
Anything not run is NOT RUN. Do not commit.
