import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const db = new Database("./data/preview-8811.db");

// 1. Ensure Notulis agent exists in preview DB
const notulisTools = JSON.stringify([
  "meeting_transcribe",
  "docs_search",
  "doc_read",
  "doc_summary",
  "doc_save",
  "project_log_add",
  "project_log_list",
  "read_brief",
  "consult_agent",
  "memory",
  "session_search",
  "skills_list",
  "skill_view",
]);

db.query(`INSERT OR REPLACE INTO agents (
  id, workspace_id, slug, name, role, provider, model, tools, system_prompt, enabled, config, created_at
) VALUES (
  'agn_notulis_preview', 'owner', 'notulis', 'Notulis',
  'Transcribes meeting recordings, writes notes and logs decisions',
  'mock', 'mock-echo', ?,
  'You are Notulis. You transcribe meetings and produce clean notes.',
  1, '{}', '2026-10-23T08:00:00.000Z'
)`).run(notulisTools);

// 2. Prepare sample files in data/preview-files/uploads
const uploadsDir = "./data/preview-files/uploads";
mkdirSync(uploadsDir, { recursive: true });

const mdContent = `# Nota Mesyuarat Pintu Pagar & Sensor
**Tarikh:** 23 Oktober 2026
**Masa:** 10:00 AM - 11:30 AM
**Tempat:** Bilik Mesyuarat SmashPoint

## Kehadiran
- Hazman (Ketua Projek)
- Ryan (Jurutera Hardware)
- Amir (Penyelia Tapak)

## Ringkasan Perbincangan
[02:15] Semakan spesifikasi sistem kawalan pintu pagar automatik MARDI.
[14:30] Isu kestabilan bekalan kuasa voltan rendah dibangkitkan oleh Amir.
[32:00] Persetujuan penggunaan modul RS485 dan geganti industri.

## Keputusan & Tindakan
| Perkara | PIC | Tarikh Akhir | Status |
| --- | --- | :---: | :---: |
| Pesan controller UC300 | Ryan | 25 Okt 2026 | **Dalam proses** |
| Ujian integrasi sensor pagar | Hazman | 27 Okt 2026 | Menunggu |
| Laporan keselamatan tapak | Amir | 28 Okt 2026 | Menunggu |

## Catatan Tambahan
Sila pastikan semua pendawaian mematuhi piawaian industri sebelum ujian tapak dijalankan.
`;

const txtContent = `Transkrip Mesyuarat Projek MARDI
Rakaman: rakaman-20261023-1000.weba
Panjang: 45 minit

[00:05] Hazman: Baik, kita mulakan mesyuarat berkenaan pintu pagar kambing MARDI.
[02:15] Ryan: Controller UC300 dah sampai, kita tengah buat bench test untuk I/O pin.
[05:40] Amir: Pastikan suis had (limit switch) kalis air sebab tempat tu terdedah kepada hujan.
[12:30] Hazman: Setuju. Ryan, tolong update lukisan skematik pendawaian petang ni.
[15:10] Ryan: Boleh, saya akan masukkan perlindungan voltan lampau sekali.
[32:00] Amir: Dari segi mekanikal, engsel pagar dah diperkukuh minggu lepas.
[44:15] Hazman: Cantik. Kita jumpa lagi hari Isnin untuk ujian lapangan.
`;

writeFileSync(join(uploadsDir, "upl_preview_note_md.md"), mdContent, "utf8");
writeFileSync(join(uploadsDir, "upl_preview_transcript_txt.txt"), txtContent, "utf8");

// 3. Insert uploads into database
const now = new Date().toISOString();
const nowPlus = new Date(Date.now() + 5000).toISOString();
db.query(`INSERT OR REPLACE INTO uploads (
  id, workspace_id, name, content_type, path, size, created_at
) VALUES 
  ('upl_preview_note_md', 'owner', 'Nota mesyuarat 2026-10-23 - SmashPoint.md', 'text/markdown', 'uploads/upl_preview_note_md.md', ?, ?),
  ('upl_preview_transcript_txt', 'owner', 'Transkrip - Mesyuarat Pagar - upl_preview_note_md.txt', 'text/plain', 'uploads/upl_preview_transcript_txt.txt', ?, ?)
`).run(Buffer.byteLength(mdContent), nowPlus, Buffer.byteLength(txtContent), now);

// 4. Insert project_docs into database under project SmashPoint (prj_01m548x9bhhgk47gcc63aysjx7)
const smashpointProj = db.query(`SELECT id FROM projects WHERE slug = 'smashpoint'`).get() as { id: string } | null;
const projectId = smashpointProj?.id ?? "prj_01m548x9bhhgk47gcc63aysjx7";

db.query(`INSERT OR REPLACE INTO project_docs (
  id, workspace_id, project_id, title, upload_id, pages, summary, content_type, created_at
) VALUES 
  ('doc_preview_note_md', 'owner', ?, 'Nota mesyuarat 2026-10-23 - SmashPoint.md', 'upl_preview_note_md', 1, 'Nota mesyuarat membincangkan spesifikasi pintu pagar, controller UC300 dan ujian sensor.', 'text/markdown', ?),
  ('doc_preview_transcript_txt', 'owner', ?, 'Transkrip - Mesyuarat Pagar - upl_preview_note_md.txt', 'upl_preview_transcript_txt', 1, 'Transkrip perbincangan hardware pintu pagar MARDI.', 'text/plain', ?)
`).run(projectId, nowPlus, projectId, now);

console.log("Seeding complete for Task 023 preview.");
