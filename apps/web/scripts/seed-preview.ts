import { Database } from "bun:sqlite";

const db = new Database("./data/preview-8811.db");

db.query("DELETE FROM events WHERE type = 'run.output' OR (type = 'agent.message' AND json_extract(payload, '$.message_id') IS NULL)").run();

// 1. Add rooms
db.query(`INSERT OR REPLACE INTO workspaces (id, name, kind, daily_token_budget, created_at)
VALUES 
  ('owner', 'HQ', 'hq', 200000, '2026-10-19T08:00:00.000Z'),
  ('room_sewa_baju', 'Sewa Baju', 'room', 150000, '2026-10-20T08:00:00.000Z'),
  ('room_empty', 'Marketing Studio', 'room', 100000, '2026-10-20T08:00:00.000Z')
`).run();

// 2. Put a couple agents into room_sewa_baju so it has agents on duty
db.query(`UPDATE agents SET workspace_id = 'room_sewa_baju' WHERE slug IN ('echo', 'marketing')`).run();

// 3. Add chat threads for english-coach
const coachAgent = db.query(`SELECT id FROM agents WHERE slug = 'english-coach'`).get() as { id: string } | null;
if (coachAgent) {
  const agentId = coachAgent.id;
  const now = new Date().toISOString();
  const jobsData = [
    { id: "job_cht_1", thread_id: "cht_interview", title: "Job Interview Prep: Ekadkahwin", text: "Let's do interview practice. Ask me questions.", reply: "Great! Let's start with your background. How did you start Ekadkahwin?" },
    { id: "job_cht_2", thread_id: "cht_casual", title: "Casual Daily English Drill", text: "Drill: 5 quick questions about my business.", reply: "Here is your first drill question: What is your primary product?" },
    { id: "job_cht_3", thread_id: "cht_pitch", title: "Pitch: Camera Rental 30s", text: "Pitch: I will explain my camera rental in 30 seconds.", reply: "Timer started! Go ahead with your 30 second pitch." },
  ];
  for (const j of jobsData) {
    db.query(`INSERT OR REPLACE INTO jobs (id, workspace_id, agent_id, type, title, input, trigger, status, created_at)
      VALUES (?, 'owner', ?, 'chat', ?, ?, 'manual', 'done', ?)`
    ).run(j.id, agentId, j.title, JSON.stringify({ thread_id: j.thread_id, text: j.text }), now);

    db.query(`INSERT OR REPLACE INTO runs (id, job_id, agent_id, runner_id, status, started_at, ended_at)
      VALUES (?, ?, ?, 'run_preview', 'done', ?, ?)`
    ).run("run_" + j.id, j.id, agentId, now, now);

    db.query(`INSERT INTO events (ts, run_id, agent_id, workspace_id, type, payload)
      VALUES (?, ?, ?, 'owner', 'agent.message', ?)`
    ).run(now, "run_" + j.id, agentId, JSON.stringify({ message_id: "msg_" + j.id, text: j.reply, final: true }));
  }
}

import { Secrets } from "../../hub/src/crypto.ts";

const secretsKey = process.env.SECRETS_KEY || "0".repeat(32);
const sec = new Secrets(secretsKey);
const fakeEncKey = sec.encrypt("sk_live_1234567890abcdef");

// 4. Add Zernio connections into settings
const zernioConns = [
  {
    id: "zrn_01preview",
    label: "Main Business Zernio",
    key_enc: fakeEncKey,
    key_hint: "sk_live_...481b",
    accounts: [
      {
        id: "acc_tt_1",
        platform: "tiktok",
        username: "myofis.official",
        display_name: "MyOfis Official",
        label: "MyOfis TikTok",
        followers: 18400,
        enabled: true,
        needs_reconnection: false,
      },
      {
        id: "acc_tt_2",
        platform: "tiktok",
        username: "sewabaju.my",
        display_name: "Sewa Baju Malaysia",
        label: "Sewa Baju Promo",
        followers: 4920,
        enabled: true,
        needs_reconnection: true,
      },
      {
        id: "acc_tt_3",
        platform: "tiktok",
        username: "hazman.vlogs",
        display_name: "Hazman Vlogs",
        label: "Personal Vlogs",
        followers: 1250,
        enabled: false,
        needs_reconnection: false,
      },
    ],
    checked_at: new Date().toISOString(),
  },
];

db.query(`INSERT OR REPLACE INTO settings (key, value) VALUES ('zernio.connections.owner', ?)`).run(JSON.stringify(zernioConns));
db.query(`INSERT OR REPLACE INTO settings (key, value) VALUES ('zernio.connections.room_sewa_baju', ?)`).run(JSON.stringify(zernioConns));

// 5. Ensure TikTok drafts have status = 'draft' so they appear in Waiting, and have social_account
db.query(`UPDATE content_drafts SET status = 'draft', meta = json_set(COALESCE(meta, '{}'), '$.social_account', 'acc_tt_1') WHERE platform = 'tiktok'`).run();

// 6. Make upl_01m5c44kmca4zv20apshzr9svq an unrendered owner clip (known = false)
db.query(`UPDATE uploads SET render = null, run_id = null WHERE id = 'upl_01m5c44kmca4zv20apshzr9svq'`).run();

console.log("Seeding preview DB complete!");
