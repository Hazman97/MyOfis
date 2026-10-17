# LEARNINGS.md

> Log silap & fix yang pernah jadi dalam project ni. AI kena baca fail ni di awal setiap session (rule #18 dalam AGENTS.md). Entry baru ditambah hanya lepas user confirm (rule #17).
> Bila file ni > ~30 entries, entries berstatus `enforced`/`obsolete`/tak relevan dipindah ke `LEARNINGS_ARCHIVE.md` (rule #19).

---

## Archive index

<!--
Section ni kosong sehingga archive pertama dibuat. Jangan duplicate entries aktif kat sini — hanya list entries yang dah dipindah ke archive.
Format: - [YYYY-MM-DD] [area] [severity] — Ringkasan (→ LEARNINGS_ARCHIVE.md)
-->

---

## Panduan entry

<!--
FIELD DEFINITIONS
- Tarikh: ambil dari `date` command. Jangan teka tarikh.
- Area: nama modul/lapisan project (contoh: db, api, frontend, auth, infra, payment, notification). Guna nama yang dah dipakai dalam entries lain kalau ada.
- Severity = impak kalau silap yang sama BERULANG:
    high   = data loss, security hole, downtime, atau user tak boleh complete task utama
    medium = bug nampak ke user / perlu rework ketara, tapi ada workaround
    low    = friction dev, style, atau silap kecil yang cepat dikesan
- Status:
    active   = masih perlu diingat manual
    enforced = dah dicatch automatik (lint/test/type) — calon archive
    obsolete = code/area berkaitan dah dibuang — calon archive

TEMPLATE (copy block bawah, tanpa ```):

```
## [YYYY-MM-DD] [area] [high|medium|low] — Ringkasan singkat isu
❌ **Silap:** apa yang jadi / assumption yang salah
🔍 **Root cause:** kenapa ia jadi (bukan setakat symptom)
✅ **Fix:** penyelesaian betul
📌 **Elak lagi:** rule/pattern spesifik — kalau boleh, nyatakan check automatik yang patut ditambah
🔗 **Ref:** file / commit / PR berkaitan
🏷️ **Status:** active
```

SEBELUM TAMBAH: search entries bawah untuk root cause yang sama. Kalau ada, update entry tu (tambah Ref, kemas kini Fix) instead of buat entry baru. Kalau pelajaran sama berulang kali kedua, cadangkan tukar jadi lint rule/test (rule #19).
-->

---

## Entries

<!-- Entry baru ditambah kat bawah ni, terbaru paling bawah. -->

## [2026-10-16] [infra] [low] — `bun --cwd X run script` print help, tak run script
❌ **Silap:** tulis `bun --cwd apps/web run build` dalam root package.json scripts
🔍 **Root cause:** flag `--cwd` kena letak lepas `run`: `bun run --cwd apps/web build`
✅ **Fix:** tukar semua root scripts ke `bun run --cwd <dir> <script>`
📌 **Elak lagi:** run setiap root script sekali lepas tambah/ubah
🔗 **Ref:** package.json
🏷️ **Status:** active

## [2026-10-16] [hub] [medium] — Bun 1.3.x `server.stop(true)` hang lepas server sendiri close WebSocket
❌ **Silap:** assume `await server.stop(true)` sentiasa resolve
🔍 **Root cause:** bug Bun: kalau server pernah panggil ws.close()/terminate() (revoke, heartbeat timeout), stop(true) tak resolve. Close dari client tak kena.
✅ **Fix:** `Promise.race([server.stop(true), Bun.sleep(500)])` dalam apps/hub/src/server.ts
📌 **Elak lagi:** bila upgrade Bun, test semula revoke test; buang workaround kalau dah fixed
🔗 **Ref:** apps/hub/src/server.ts, apps/hub/test/api.test.ts ("revoked runner…")
🏷️ **Status:** enforced

## [2026-10-16] [infra] [low] — Port 8787 hub clash dengan `wrangler dev` (workerd)
❌ **Silap:** start hub kat 8787 masa wrangler dev running → EADDRINUSE / request kena workerd (404)
🔍 **Root cause:** 8787 default kedua-dua spec hub dan wrangler
✅ **Fix:** HUB_PORT=8788 (+ PUBLIC_BASE_URL, HUB_DEV_URL) bila wrangler jalan
📌 **Elak lagi:** check `Get-NetTCPConnection -LocalPort 8787` sebelum start hub; jangan kill workerd
🔗 **Ref:** README.md (Port clash)
🏷️ **Status:** active

## [2026-10-17] [runner] [high] — Bun fetch guna semula socket keep-alive yang dah mati → tergantung selamanya
❌ **Silap:** assume fetch biasa selamat untuk panggilan yang ada jurang masa panjang (approval owner, upload, LLM)
🔍 **Root cause:** Bun reuse socket pooled yang server dah tutup (idle timeout) dan tunggu tanpa error; curl/`localhost` berjaya, `127.0.0.1` (pool sama) stall
✅ **Fix:** `freshFetch` (packages/shared/src/net.ts): `keepalive:false` + timeout, untuk runner→hub, runner→OpenCode, LLM, Gitea
📌 **Elak lagi:** panggilan dalaman wajib guna freshFetch; acceptance test cover (decide lepas ~10s idle)
🔗 **Ref:** packages/shared/src/net.ts, apps/hub/test/acceptance.test.ts
🏷️ **Status:** enforced

## [2026-10-17] [runner] [medium] — Windows: process anak tak mati bila parent dibunuh; folder EBUSY
❌ **Silap:** proc.kill() pada `opencode` (launcher npm) — opencode.exe terus hidup, pegang pipe & folder
🔍 **Root cause:** launcher spawn child; Windows tak bunuh tree; fail handle dilepaskan lambat
✅ **Fix:** resolveOpenCode() cari opencode.exe sebenar; killTree (taskkill /T /F) + tunggu exit; rmSync maxRetries dalam test
📌 **Elak lagi:** setiap child process: killTree + await exit sebelum padam folder
🔗 **Ref:** apps/runner/src/opencode/binary.ts, server.ts
🏷️ **Status:** enforced
## [2026-10-17] [infra] [low] — Git Bash tukar argumen yang mula dengan `/` jadi path Windows
❌ **Silap:** `node apps/web/scripts/shots.mjs --routes "/,/agents"` dari Git Bash → Playwright buka `http://127.0.0.1:5180C:/Program Files/Git/`
🔍 **Root cause:** MSYS path conversion tukar apa-apa argumen yang nampak macam path POSIX (`/...`) sebelum sampai ke program Windows
✅ **Fix:** letak `MSYS_NO_PATHCONV=1` depan command (atau jalankan dari PowerShell)
📌 **Elak lagi:** argumen route/URL path dari Git Bash → sentiasa `MSYS_NO_PATHCONV=1`
🔗 **Ref:** apps/web/scripts/shots.mjs, CLAUDE.md (Phase 3)
🏷️ **Status:** active

## [2026-10-17] [frontend] [low] — Phaser `fps.limit: 60` skip frame kat skrin 60Hz
❌ **Silap:** nak cap 30 fps bila window blur, ingat boleh set `fps.limit` dan tukar nilai masa runtime
🔍 **Root cause:** `stepLimitFPS` cuma render bila delta terkumpul ≥ `_limitRate`; kat 60Hz delta ~16.6ms kadang-kadang bawah 16.67ms → frame skip, jadi tersentak. Fungsi step dipilih masa start, jadi tukar `fpsLimit` je tak cukup
✅ **Fix:** start dengan `fps: { limit: 60 }` (supaya stepLimitFPS dipakai), terus set `game.loop._limitRate = 0` masa focus (tiada had), `1000/30` masa BLUR
📌 **Elak lagi:** jangan set had fps sama dengan refresh rate skrin; guna had cuma untuk turunkan fps
🔗 **Ref:** apps/web/src/office/scene/game.ts (createOfficeGame)
🏷️ **Status:** active
