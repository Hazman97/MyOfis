import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { events, jobs, uploads } from "../src/db/schema.ts";
import { startHub, type HubServer } from "../src/server.ts";
import { PublicHd, sniffContainer } from "../src/publicHd.ts";
import { publicHdSettings } from "../src/integrations.ts";
import { TOKEN, testConfig } from "./helpers.ts";
import { sql } from "drizzle-orm";

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()!;
    await fn();
  }
});

async function makeTestVideo(outPath: string, size: string, durationSec: number): Promise<Uint8Array> {
  const proc = Bun.spawn({
    cmd: [
      "ffmpeg", "-y",
      "-f", "lavfi", "-i", `testsrc2=size=${size}:rate=30:duration=${durationSec}`,
      "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=44100:duration=${durationSec}`,
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      outPath,
    ],
    stdout: "ignore",
    stderr: "ignore",
  });
  expect(await proc.exited).toBe(0);
  return new Uint8Array(await Bun.file(outPath).arrayBuffer());
}

async function ffprobeFile(path: string) {
  const proc = Bun.spawn({
    cmd: ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", path],
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await proc.exited).toBe(0);
  const parsed = JSON.parse(await new Response(proc.stdout).text()) as {
    streams: Array<{ codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string }>;
    format: { duration?: string; size?: string };
  };
  const v = parsed.streams.find((s) => s.codec_type === "video");
  const a = parsed.streams.find((s) => s.codec_type === "audio");
  return {
    video_codec: v?.codec_name,
    width: v?.width,
    height: v?.height,
    r_frame_rate: v?.r_frame_rate,
    audio_codec: a?.codec_name,
    duration: Number(parsed.format.duration ?? 0),
    size_bytes: Number(parsed.format.size ?? 0),
  };
}

function startIsolatedHub(extra: Partial<ReturnType<typeof testConfig>> = {}): { dir: string; srv: HubServer } {
  const dir = mkdtempSync(join(tmpdir(), "pubhd-hub-"));
  const cfg = { ...testConfig(dir), ...extra };
  const srv = startHub(cfg, { sweepMs: 60_000, backupCheckMs: 600_000, tokenCheckMs: 0 });
  cleanups.push(async () => {
    await srv.stop();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows SQLite WAL handle may linger briefly
    }
  });
  return { dir, srv };
}

async function uploadPublic(
  baseUrl: string,
  key: string,
  name: string,
  bytes: Uint8Array,
  opts: { targets?: string; mode?: string; ip?: string; turnstile?: string; split?: boolean } = {},
) {
  const targets = opts.targets ?? "tiktok";
  const mode = opts.mode ?? "auto";
  const ip = opts.ip ?? "203.0.113.10";
  const chunks: Uint8Array[] = [];
  const maxChunk = 16 * 1024 * 1024;
  if (bytes.byteLength > maxChunk) {
    for (let o = 0; o < bytes.byteLength; o += maxChunk) {
      chunks.push(bytes.subarray(o, Math.min(bytes.byteLength, o + maxChunk)));
    }
  } else if (opts.split && bytes.byteLength > 2048) {
    chunks.push(bytes.subarray(0, 1024), bytes.subarray(1024));
  } else {
    chunks.push(bytes);
  }
  let offset = 0;
  let lastRes!: Response;
  let lastJson: any = null;
  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx]!;
    const qs = new URLSearchParams({
      name,
      total: String(bytes.byteLength),
      offset: String(offset),
      targets,
      mode,
    });
    const headers: Record<string, string> = {
      "content-type": "application/octet-stream",
      "cf-connecting-ip": ip,
    };
    if (idx === 0 && opts.turnstile) headers["x-turnstile-token"] = opts.turnstile;
    lastRes = await fetch(`${baseUrl}/api/public/hd/parts/${key}?${qs.toString()}`, {
      method: "PUT",
      headers,
      body: chunk,
    });
    lastJson = await lastRes.json().catch(() => ({}));
    if (!lastRes.ok) return { res: lastRes, json: lastJson };
    offset += chunk.byteLength;
  }
  return { res: lastRes, json: lastJson };
}

describe("Task 038: Public Video HD (/video-hd/public)", () => {
  test("Isolation: no-cookie owner routes stay 401/404, public page has no /assets, owner DB counts stay unchanged", async () => {
    const { srv } = startIsolatedHub();

    // No cookie: owner routes must reject or 404
    for (const path of ["/api/state", "/api/uploads", "/api/video-hd", "/api/events", "/api/public/hd/../state"]) {
      const r = await fetch(`${srv.url}${path}`);
      expect([401, 404]).toContain(r.status);
    }

    // Public page is self-contained HTML without Vite /assets
    const page = await fetch(`${srv.url}/video-hd/public`);
    expect(page.status).toBe(200);
    expect(page.headers.get("x-robots-tag")).toBe("noindex");
    const html = await page.text();
    expect(html).toContain("Video HD");
    expect(html).toContain("Video dipadam selepas 24 jam");
    expect(html).not.toContain("/assets/");

    // Unknown job ID -> 404
    const missing = await fetch(`${srv.url}/api/public/hd/jobs/00000000000000000000000000000000`);
    expect(missing.status).toBe(404);

    // Owner Storage API includes public-hd row
    const st = await fetch(`${srv.url}/api/storage`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(st.status).toBe(200);
    const stJson = (await st.json()) as { items: { key: string; label: string }[] };
    expect(stJson.items.some((x) => x.key === "public-hd")).toBe(true);

    // Enable public HD as owner and submit a real clip; verify owner jobs/uploads/events count unchanged
    const countRows = () => ({
      jobs: srv.hub.db.select({ n: sql<number>`count(*)` }).from(jobs).get()?.n ?? 0,
      uploads: srv.hub.db.select({ n: sql<number>`count(*)` }).from(uploads).get()?.n ?? 0,
      events: srv.hub.db.select({ n: sql<number>`count(*)` }).from(events).get()?.n ?? 0,
    });
    const beforeCounts = countRows();

    await fetch(`${srv.url}/api/settings/integrations/public-hd`, {
      method: "PUT",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });

    const tmp = mkdtempSync(join(tmpdir(), "pubhd-clip-"));
    cleanups.push(() => rmSync(tmp, { recursive: true, force: true }));
    const clip = await makeTestVideo(join(tmp, "mini.mp4"), "720x1280", 2);

    const up = await uploadPublic(srv.url, "isokey12345", "mini.mp4", clip, { targets: "tiktok", split: true });
    expect(up.res.status).toBe(200);
    expect(typeof up.json.id).toBe("string");
    await srv.hub.publicHd.waitIdle();

    const afterCounts = countRows();
    expect(afterCounts).toEqual(beforeCounts);
  });

  test("Limits: disabled, max_mb, not-a-video, too-long, per-IP hour/day, daily total, queue full, storage cap + Telegram alert, Turnstile", async () => {
    // Fake Telegram + Fake Turnstile HTTP server
    const tgMessages: string[] = [];
    let turnstileShouldPass = false;
    const fakeExt = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.includes("/sendMessage")) {
          const b = (await req.json()) as { text?: string };
          if (b.text) tgMessages.push(b.text);
          return Response.json({ ok: true, result: { message_id: 1 } });
        }
        if (url.pathname === "/turnstile/v0/siteverify") {
          return Response.json({ success: turnstileShouldPass });
        }
        return new Response("Not Found", { status: 404 });
      },
    });
    cleanups.push(() => fakeExt.stop(true));

    const { srv } = startIsolatedHub({
      telegramApiBase: `http://127.0.0.1:${fakeExt.port}`,
      seed: {
        anthropicApiKey: "",
        openaiApiKey: "",
        ollamaBaseUrl: "",
        giteaUrl: "",
        giteaToken: "",
        telegramToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcde",
        telegramChatId: "12345",
      },
      publicHdTurnstile: {
        siteKey: "1x00000000000000000000AA",
        secret: "1x0000000000000000000000000000000AA",
        apiBase: `http://127.0.0.1:${fakeExt.port}`,
      },
    });

    // 1) Disabled -> "Ditutup sementara"
    const dummyBytes = new Uint8Array(Buffer.from("not a real video file"));
    const disabledRes = await uploadPublic(srv.url, "disabledkey1", "bad.txt", dummyBytes);
    expect(disabledRes.res.status).toBe(403);
    expect(disabledRes.json.error).toContain("Ditutup sementara");

    // Enable with tight limits + Turnstile required
    const putCfg = await fetch(`${srv.url}/api/settings/integrations/public-hd`, {
      method: "PUT",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        max_mb: 10,
        max_minutes: 1,
        per_ip_hour: 2,
        per_ip_day: 3,
        daily_total: 4,
        max_queue: 2,
        storage_cap_gb: 1,
      }),
    });
    expect(putCfg.status).toBe(200);

    // 2) Turnstile fail -> 403
    turnstileShouldPass = false;
    const tsFail = await uploadPublic(srv.url, "tsfailkey123", "test.mp4", dummyBytes, { turnstile: "bad-tok" });
    expect(tsFail.res.status).toBe(403);

    // Turnstile pass
    turnstileShouldPass = true;

    // 3) Max size (> 10 MB) -> 413
    const tooBigQs = new URLSearchParams({
      name: "huge.mp4",
      total: String(11 * 1024 * 1024),
      offset: "0",
      targets: "tiktok",
      mode: "auto",
    });
    const bigRes = await fetch(`${srv.url}/api/public/hd/parts/toobigkey123?${tooBigQs}`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", "cf-connecting-ip": "198.51.100.1", "x-turnstile-token": "ok" },
      body: new Uint8Array(10),
    });
    expect(bigRes.status).toBe(413);

    // 4) Not a video (renamed .txt) -> job fails and input is deleted
    const notVid = await uploadPublic(srv.url, "notvidkey123", "fake.mp4", dummyBytes, { ip: "198.51.100.2", turnstile: "ok" });
    expect(notVid.res.status).toBe(200);
    await srv.hub.publicHd.waitIdle();
    const notVidJob = srv.hub.publicHd.getJob(notVid.json.id);
    expect(notVidJob?.status).toBe("failed");
    expect(notVidJob?.error).toContain("Bukan fail video");
    expect(existsSync(join(srv.hub.publicHd.incomingDir, `${notVid.json.id}.input`))).toBe(false);

    // 5) Too long (> max_minutes = 1 min -> 65s clip) -> fails & input deleted
    const tmp = mkdtempSync(join(tmpdir(), "pubhd-lim-"));
    cleanups.push(() => rmSync(tmp, { recursive: true, force: true }));
    const longClip = await makeTestVideo(join(tmp, "long65.mp4"), "320x240", 65);
    const longRes = await uploadPublic(srv.url, "longkey12345", "long65.mp4", longClip, { ip: "198.51.100.2", turnstile: "ok" });
    expect(longRes.res.status).toBe(200);
    await srv.hub.publicHd.waitIdle();
    const longJob = srv.hub.publicHd.getJob(longRes.json.id);
    expect(longJob?.status).toBe("failed");
    expect(longJob?.error).toContain("terlalu panjang");
    expect(existsSync(join(srv.hub.publicHd.incomingDir, `${longRes.json.id}.input`))).toBe(false);

    // 6) Per-IP hourly limit (per_ip_hour = 2; IP 198.51.100.2 already has 2 jobs above) -> 3rd is 429
    const tinyClip = await makeTestVideo(join(tmp, "tiny.mp4"), "320x240", 2);
    const ipHr = await uploadPublic(srv.url, "iphrkey12345", "tiny.mp4", tinyClip, { ip: "198.51.100.2", turnstile: "ok" });
    expect(ipHr.res.status).toBe(429);

    // 7) Queue full ("Sibuk, cuba lagi nanti") when max_queue = 2
    // Submit 2 jobs quickly from a fresh IP; 3rd while active hits 429 "Sibuk, cuba lagi nanti"
    const q1 = await uploadPublic(srv.url, "qkey12345671", "tiny.mp4", tinyClip, { targets: "tiktok,whatsapp,whatsapp_status", mode: "reencode", ip: "198.51.100.3", turnstile: "ok" });
    const q2 = await uploadPublic(srv.url, "qkey12345672", "tiny.mp4", tinyClip, { targets: "tiktok,whatsapp,whatsapp_status", mode: "reencode", ip: "198.51.100.4", turnstile: "ok" });
    const q3 = await uploadPublic(srv.url, "qkey12345673", "tiny.mp4", tinyClip, { ip: "198.51.100.5", turnstile: "ok" });
    expect(q1.res.status).toBe(200);
    expect(q2.res.status).toBe(200);
    expect(q3.res.status).toBe(429);
    expect(q3.json.error).toContain("Sibuk");
    await srv.hub.publicHd.waitIdle();

    // 8) Daily total (daily_total = 4; we already inserted 4 jobs: notVid, longRes, q1, q2) -> 429
    const dayLim = await uploadPublic(srv.url, "daylimkey123", "tiny.mp4", tinyClip, { ip: "198.51.100.9", turnstile: "ok" });
    expect(dayLim.res.status).toBe(429);

    // 9) Storage cap reached -> 507 + Telegram alert sent once
    const capDir = mkdtempSync(join(tmpdir(), "pubhd-cap-"));
    cleanups.push(() => rmSync(capDir, { recursive: true, force: true }));
    const alerts: string[] = [];
    const capHd = new PublicHd({
      dir: capDir,
      secretsKey: "secret-key-0123456789abcdef0123456789",
      turnstile: { siteKey: "", secret: "", apiBase: "" },
      getSettings: () => ({
        enabled: true,
        max_mb: 500,
        max_minutes: 10,
        per_ip_hour: 10,
        per_ip_day: 20,
        daily_total: 50,
        max_queue: 5,
        max_files: 4,
        storage_cap_gb: 0.0001, // ~100 KB cap
        retention_hours: 24,
      }),
      onStorageFull: (u, c) => {
        alerts.push(`${u}/${c}`);
      },
    });
    cleanups.push(() => capHd.close());
    writeFileSync(join(capHd.outDir, "filler.bin"), new Uint8Array(200_000));
    await expect(
      capHd.putPart({
        key: "capkey123456",
        name: "a.mp4",
        total: 100,
        offset: 0,
        bytes: new Uint8Array(100),
        targets: ["tiktok"],
        mode: "auto",
        ip: "198.51.100.1",
      }),
    ).rejects.toThrow("Storan sementara penuh");
    await expect(
      capHd.putPart({
        key: "capkey123457",
        name: "b.mp4",
        total: 100,
        offset: 0,
        bytes: new Uint8Array(100),
        targets: ["tiktok"],
        mode: "auto",
        ip: "198.51.100.1",
      }),
    ).rejects.toThrow("Storan sementara penuh");
    expect(alerts.length).toBe(1); // told once!
  }, 60_000);

  test("Real 60s 1080p clip + phone clip across all 3 targets, Range download, input deleted, 24h sweep + 21:00 KL digest", async () => {
    let fakeNow = Date.parse("2026-11-20T10:00:00+08:00");
    const { dir, srv } = startIsolatedHub();
    // Replace publicHd with fake-clock PublicHd sharing the same publicHdDir so we can test 24h sweep & 21:00 digest deterministically
    srv.hub.publicHd.close();
    srv.hub.publicHd = new PublicHd({
      dir: join(dir, "public-hd"),
      secretsKey: "test-secrets-key-0123456789abcdef0123456789",
      turnstile: { siteKey: "", secret: "", apiBase: "" },
      getSettings: () => publicHdSettings(srv.hub.db).get(),
      now: () => fakeNow,
    });

    await fetch(`${srv.url}/api/settings/integrations/public-hd`, {
      method: "PUT",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, max_mb: 500, max_minutes: 10 }),
    });

    const tmp = mkdtempSync(join(tmpdir(), "pubhd-real-"));
    cleanups.push(() => rmSync(tmp, { recursive: true, force: true }));

    // 1) 60s 1080p landscape clip
    const clip1080 = await makeTestVideo(join(tmp, "sample-60s-1080p.mp4"), "1920x1080", 60);
    const up1 = await uploadPublic(srv.url, "real1080key1", "sample-60s-1080p.mp4", clip1080, {
      targets: "tiktok,whatsapp,whatsapp_status",
      mode: "auto",
      ip: "203.0.113.50",
    });
    expect(up1.res.status).toBe(200);
    await srv.hub.publicHd.waitIdle();

    const job1Res = await fetch(`${srv.url}/api/public/hd/jobs/${up1.json.id}`);
    expect(job1Res.status).toBe(200);
    const job1 = (await job1Res.json()) as any;
    expect(job1.status).toBe("done");
    expect(job1.results.length).toBe(3);
    expect(existsSync(join(srv.hub.publicHd.incomingDir, `${up1.json.id}.input`))).toBe(false);

    // Download & ffprobe each target + verify headers and Range support
    for (const target of ["tiktok", "whatsapp", "whatsapp_status"] as const) {
      const dl = await fetch(`${srv.url}/api/public/hd/jobs/${up1.json.id}/file/${target}`);
      expect(dl.status).toBe(200);
      expect(dl.headers.get("x-robots-tag")).toBe("noindex");
      expect(dl.headers.get("content-disposition")).toContain("inline;");
      const saved = await fetch(`${srv.url}/api/public/hd/jobs/${up1.json.id}/file/${target}?download=1`, { headers: { range: "bytes=0-0" } });
      await saved.arrayBuffer();
      expect(saved.headers.get("content-disposition")).toContain("attachment;");
      const outBuf = new Uint8Array(await dl.arrayBuffer());
      const outPath = join(tmp, `out1-${target}.mp4`);
      writeFileSync(outPath, outBuf);
      const probed = await ffprobeFile(outPath);
      expect(probed.video_codec).toBe("h264");
      expect(probed.duration).toBeGreaterThan(58);
      if (target === "tiktok") expect([probed.width, probed.height]).toEqual([1080, 1920]);
      if (target === "whatsapp") expect(probed.width).toBe(1280);
      if (target === "whatsapp_status") expect([probed.width, probed.height]).toEqual([720, 1280]);

      const rangeRes = await fetch(`${srv.url}/api/public/hd/jobs/${up1.json.id}/file/${target}`, {
        headers: { range: "bytes=0-1023" },
      });
      expect(rangeRes.status).toBe(206);
      expect((await rangeRes.arrayBuffer()).byteLength).toBe(1024);
    }

    // 2) Phone-sized clip (720x1280, 5s)
    const clipPhone = await makeTestVideo(join(tmp, "phone-720x1280.mp4"), "720x1280", 5);
    const up2 = await uploadPublic(srv.url, "realphonekey1", "phone-720x1280.mp4", clipPhone, {
      targets: "tiktok,whatsapp,whatsapp_status",
      mode: "auto",
      ip: "203.0.113.51",
    });
    expect(up2.res.status).toBe(200);
    await srv.hub.publicHd.waitIdle();

    const job2 = (await (await fetch(`${srv.url}/api/public/hd/jobs/${up2.json.id}`)).json()) as any;
    expect(job2.status).toBe("done");
    expect(job2.results.length).toBe(3);

    // Check 21:00 KL digest
    expect(srv.hub.publicHd.dailyDigestIfDue()).toBeNull(); // 10:00 KL -> not due
    fakeNow = Date.parse("2026-11-20T21:05:00+08:00");
    const digest = srv.hub.publicHd.dailyDigestIfDue();
    expect(digest).toContain("Public Video HD (2026-11-20): 2 siap");
    expect(srv.hub.publicHd.dailyDigestIfDue()).toBeNull(); // sent once per day

    // Check 24h sweep deletes outputs & job rows
    expect(readdirSync(srv.hub.publicHd.outDir).length).toBeGreaterThan(0);
    fakeNow += 25 * 3600_000;
    const swept = srv.hub.publicHd.sweep(fakeNow);
    expect(swept.deleted_jobs).toBe(2);
    expect(readdirSync(srv.hub.publicHd.outDir).length).toBe(0);
    expect(srv.hub.publicHd.getJob(up1.json.id)).toBeNull();
  }, 120_000);

  test("only real MP4/MOV/MKV/WebM reach ffmpeg: ffconcat lists and playlists are refused (review 2026-11-20)", async () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    // with a duration line ffprobe reports 320×240, 2 s, so only the container check stops it
    const concatList = "ffconcat version 1.0\nfile neighbour.input\nduration 2\n";
    expect(sniffContainer(enc(concatList))).toBeNull();
    expect(sniffContainer(enc("#EXTM3U\n#EXTINF:1,\nfile:C:/secret.txt\n"))).toBeNull();
    expect(sniffContainer(new Uint8Array([0, 0, 0, 0x20, ...enc("ftypisom"), 0, 0, 0, 0]))).toBe("mov");
    expect(sniffContainer(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2]))).toBe("matroska");

    const { srv } = startIsolatedHub();
    publicHdSettings(srv.hub.db).set({ enabled: true });
    // a neighbour's upload sits in incoming/; an ffconcat "video" naming it must not be read
    const tmp = mkdtempSync(join(tmpdir(), "pubhd-evil-"));
    cleanups.push(() => rmSync(tmp, { recursive: true, force: true }));
    writeFileSync(join(srv.hub.publicHd.incomingDir, "neighbour.input"), await makeTestVideo(join(tmp, "neighbour.mp4"), "320x240", 1));
    const evil = await uploadPublic(srv.url, "evilconcat01", "evil.mp4", enc(concatList), { ip: "192.0.2.50" });
    expect(evil.res.status).toBe(200);
    await srv.hub.publicHd.waitIdle();
    const job = srv.hub.publicHd.getJob(evil.json.id);
    expect(job?.status).toBe("failed");
    expect(job?.error).toContain("Bukan fail video");
    expect(job?.results).toEqual([]);
  });

  test("uploads: one at a time per visitor, parts in order, part size checked after reading", async () => {
    const { srv } = startIsolatedHub();
    publicHdSettings(srv.hub.db).set({ enabled: true });
    const put = (key: string, offset: number, total: number, body: Uint8Array, ip = "192.0.2.60") =>
      fetch(`${srv.url}/api/public/hd/parts/${key}?${new URLSearchParams({ name: "a.mp4", total: String(total), offset: String(offset), targets: "tiktok" })}`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream", "cf-connecting-ip": ip },
        body,
      });
    expect((await put("firstupload1", 0, 3000, new Uint8Array(1000))).status).toBe(200);
    // a second upload from the same visitor while the first is still arriving
    const second = await put("secondupld01", 0, 3000, new Uint8Array(1000));
    expect(second.status).toBe(429);
    expect(((await second.json()) as { error: string }).error).toContain("Satu muat naik");
    // another visitor is fine
    expect((await put("otherperson1", 0, 3000, new Uint8Array(1000), "192.0.2.61")).status).toBe(200);
    // a gap (skipping bytes 1000-1999) is refused; the next part in order is accepted
    expect((await put("firstupload1", 2000, 3000, new Uint8Array(1000))).status).toBe(400);
    expect((await put("firstupload1", 1000, 3000, new Uint8Array(1000))).status).toBe(200);
    // X-Forwarded-For is not trusted: without CF-Connecting-IP every request is "local"
    const r = await fetch(`${srv.url}/api/public/hd/parts/xffspoof001?${new URLSearchParams({ name: "a.mp4", total: "3000", offset: "0", targets: "tiktok" })}`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", "x-forwarded-for": "1.2.3.4" },
      body: new Uint8Array(1000),
    });
    expect(r.status).toBe(200);
    const r2 = await fetch(`${srv.url}/api/public/hd/parts/xffspoof002?${new URLSearchParams({ name: "a.mp4", total: "3000", offset: "0", targets: "tiktok" })}`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", "x-forwarded-for": "5.6.7.8" },
      body: new Uint8Array(1000),
    });
    expect(r2.status).toBe(429);
  });

  test("Task 039: placements merge, max_files limit, and 130s Story clip splits into 3 parts", async () => {
    const { srv } = startIsolatedHub();
    await fetch(`${srv.url}/api/settings/integrations/public-hd`, {
      method: "PUT",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, max_mb: 500, max_minutes: 10, max_files: 4 }),
    });

    // Config exposes placements & placement_target
    const cfg = (await (await fetch(`${srv.url}/api/public/hd/config`)).json()) as any;
    expect(Array.isArray(cfg.placements)).toBe(true);
    expect(cfg.placement_target.ig_reels).toBe("vertical");
    expect(cfg.limits.max_files).toBe(4);

    // 5 distinct files exceeds max_files (4) -> 400
    const tooMany = await fetch(
      `${srv.url}/api/public/hd/parts/toomanyfiles1?${new URLSearchParams({
        name: "a.mp4",
        total: "100",
        offset: "0",
        placements: "tiktok,ig_story,ig_feed,whatsapp,whatsapp_status",
      })}`,
      { method: "PUT", headers: { "content-type": "application/octet-stream", "cf-connecting-ip": "198.51.100.70" }, body: new Uint8Array(100) },
    );
    expect(tooMany.status).toBe(400);

    // 130s clip with ig_story + fb_story -> 1 target (story) -> 3 parts (story_1, story_2, story_3)
    const tmp = mkdtempSync(join(tmpdir(), "pubhd-story130-"));
    cleanups.push(() => rmSync(tmp, { recursive: true, force: true }));
    const bytes = await makeTestVideo(join(tmp, "long-130s.mp4"), "640x360", 130);
    const PART = 16 * 1024 * 1024;
    let upJson: { id?: string } = {};
    for (let offset = 0; offset < bytes.byteLength; offset += PART) {
      const slice = bytes.subarray(offset, Math.min(bytes.byteLength, offset + PART));
      const qs = new URLSearchParams({
        name: "long-130s.mp4",
        total: String(bytes.byteLength),
        offset: String(offset),
        placements: "ig_story,fb_story",
        mode: "auto",
      });
      const up = await fetch(`${srv.url}/api/public/hd/parts/story130key1?${qs}`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream", "cf-connecting-ip": "198.51.100.71" },
        body: slice,
      });
      expect(up.status).toBe(200);
      upJson = (await up.json()) as { id?: string };
    }
    expect(typeof upJson.id).toBe("string");
    await srv.hub.publicHd.waitIdle();

    const job = (await (await fetch(`${srv.url}/api/public/hd/jobs/${upJson.id}`)).json()) as any;
    expect(job.status).toBe("done");
    expect(job.results.length).toBe(3);
    expect(job.results.map((r: any) => r.key)).toEqual(["story_1", "story_2", "story_3"]);
    expect(job.results[0].covers).toEqual(["ig_story", "fb_story"]);
    expect(job.results[0].duration).toBeLessThanOrEqual(61);
    expect(job.results[1].duration).toBeLessThanOrEqual(61);
    expect(job.results[2].duration).toBeLessThanOrEqual(15);

    for (const key of ["story_1", "story_2", "story_3"]) {
      const dl = await fetch(`${srv.url}/api/public/hd/jobs/${upJson.id}/file/${key}`);
      expect(dl.status).toBe(200);
      expect((await dl.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    }
  }, 180_000);
});

