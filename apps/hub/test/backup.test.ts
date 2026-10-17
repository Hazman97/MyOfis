import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestEnv, type TestEnv } from "./helpers.ts";

let env: TestEnv;
afterEach(async () => {
  await env?.close();
});

describe("nightly backup", () => {
  test("copies the database, briefs and skills into a dated folder; keeps the newest N", async () => {
    env = await createTestEnv();
    await env.api("/api/agents", { body: { slug: "bk", name: "Backup me", provider: "mock", model: "mock-script" } });
    mkdirSync(join(env.dir, "skills", "demo"), { recursive: true });
    writeFileSync(join(env.dir, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: A demo skill for the backup test.\n---\n");

    const { status, body } = await env.api("/api/backups", { method: "POST" });
    expect(status).toBe(201);
    const day = join(env.dir, "backups", body.backup.date);
    expect(existsSync(join(day, "skills", "demo", "SKILL.md"))).toBe(true);
    // the copy is a working database with the same rows
    const copy = new Database(join(day, "agent-office.db"), { readonly: true });
    expect(copy.query("select name from agents where slug = 'bk'").get()).toEqual({ name: "Backup me" });
    copy.close();

    // due: not again today; keep only the newest 3 (test config)
    const b = env.hub.hub.backups;
    expect(b.due(new Date())).toBe(false);
    for (const d of ["2026-01-01", "2026-01-02", "2026-01-03"]) b.run(new Date(`${d}T12:00:00+08:00`));
    expect(readdirSync(join(env.dir, "backups")).filter((d) => d !== "files").sort()).toEqual(["2026-01-02", "2026-01-03", body.backup.date].sort());
    expect((await env.api("/api/backups")).body.backups.map((x: { date: string }) => x.date)[0]).toBe(body.backup.date);
  });

  test("photos and videos are mirrored once into backups/files (new or changed files only)", async () => {
    env = await createTestEnv();
    const files = env.hub.hub.config.filesDir;
    mkdirSync(join(files, "uploads"), { recursive: true });
    writeFileSync(join(files, "uploads", "upl_a.mp4"), "video-a");
    writeFileSync(join(files, "uploads", "half.part"), "partial");
    expect(env.hub.hub.backups.run(new Date("2026-02-01T12:00:00+08:00")).files_copied).toBe(1);
    const mirrored = join(env.dir, "backups", "files", "uploads");
    expect(readFileSync(join(mirrored, "upl_a.mp4"), "utf8")).toBe("video-a");
    expect(existsSync(join(mirrored, "half.part"))).toBe(false);
    // the next night copies only what is new; the mirror is not a dated folder, so it is never pruned
    writeFileSync(join(files, "uploads", "upl_b.jpg"), "photo-b");
    expect(env.hub.hub.backups.run(new Date("2026-02-02T12:00:00+08:00")).files_copied).toBe(1);
    expect(env.hub.hub.backups.list().map((b) => b.date)).toEqual(["2026-02-02", "2026-02-01"]);
  });

  test("due only after the backup hour (Malaysia time)", async () => {
    env = await createTestEnv();
    const b = env.hub.hub.backups;
    expect(b.due(new Date("2030-05-01T01:00:00+08:00"))).toBe(false); // 1 am, before 3 am
    expect(b.due(new Date("2030-05-01T03:30:00+08:00"))).toBe(true);
  });
});
