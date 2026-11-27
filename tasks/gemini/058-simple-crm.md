# 058: Simple CRM — one customer list built automatically, with follow-up suggestions

Owner (2026-11-27): one list of customers gathered automatically from social DMs/comments, WhatsApp, email and
bookings: who, where from, what they bought/asked, last contact. An agent suggests who to follow up.

Read first: `tasks/gemini/SUPERVISOR.md`, `046-comments-dm-replies.md` (`inbox_items`), `055-gmail-agent.md`,
`057-whatsapp-collection-bot.md`, Kerani (`read_bookings`, `Publisher.siteData`), CLAUDE.md "Members and
workspaces" (room scoping). Sources that are not built yet are simply skipped; build the CRM so each source is a
small adapter.

## Data (migration, all room-scoped)
- `contacts {id, workspace_id, display_name, phones[], emails[], handles: [{platform, handle}], tags[], notes,
  first_seen_at, last_contact_at, last_inbound_at, total_spent_sen, consent: {marketing: boolean, source, at},
  merged_into?, created_at}`.
- `contact_events {id, contact_id, workspace_id, at, source: dm|comment|whatsapp|email|booking|payment|manual,
  project_id?, summary (≤ 200 chars), ref: {kind, id}, amount_sen?}` (append-only).
- Indices on phones/emails/handles for matching.

## Matching (pure, tested: `packages/shared/src/crm.ts`)
- Normalise Malaysian phones (`+60…`, `01x…`, spaces/dashes) and emails (lowercase, Gmail dots kept — do not guess).
- `matchContact(signal, contacts)`: exact phone/email/handle → same contact; same name only → **never** auto-merge
  (suggest). `mergeContacts(a, b)` keeps both histories; an undo is possible (`merged_into`).

## Adapters (each writes contact_events; idempotent by `ref`)
Inbox items (046), Gmail messages (055: sender only, not newsletters/no-reply), WhatsApp collection members and
payments (057), bookings (Kerani's site data: name/phone of each booking), BijokPay payments (059), manual add.
Summaries come from the item itself (first line, trimmed) — no LLM per event.

## Follow-up suggestions
- Pure `followUps(contacts, events, now, rules)`: e.g. booked ≥ 2 times but none in 30 days; asked a price and never
  booked within 7 days; unpaid collection; new contact with an unanswered inbound message > 24 h. Tested.
- Weekly job for the Ketua or Setiausaha agent: turns the top 10 into a short Telegram list with a suggested
  message per person (draft only; sending goes through the normal approve-first paths of 046/055/057). Marketing
  messages only to contacts with `consent.marketing = true`.
- Agent tool `crm_lookup {query}` (read-only: contact card + last 10 events) for reply agents, so answers know the
  history. Results are room-scoped; text from customers stays UNTRUSTED.

## UI
`/pelanggan` (room): searchable list (name/phone/handle/tag), filters (source, project, last contact), contact page
(timeline, tags, notes, merge suggestions, consent switch), "Follow-up minggu ni" panel, CSV export. Phone-width OK.

## Privacy (PDPA Malaysia)
Only the room sees its contacts; a "Padam pelanggan" action deletes the contact and its events (and its uploads that
belong to no other record); export is owner/room manager only. Docs line on PDPA basics (purpose, consent for
marketing, deletion on request).

## Tests
Phone/email normalisation, matching (no auto-merge on name), merge + undo, each adapter idempotent, `followUps`
rules, consent gate on marketing suggestions, cross-room contact id → 404, delete removes events.

## Proof
Raw new tests, `bun run typecheck`, full `bun test`, web build final lines; screenshots (360 px + desktop) of the
list and a contact page. Anything not run is NOT RUN. Do not commit.
