import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOL_REGISTRY, runTool } from "../src/index.ts";
import { makeCtx } from "./helpers.ts";

let root: string;
let site: ReturnType<typeof Bun.serve>;
let color = "#ffffff";
let base: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ao-web-"));
  site = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      const html = (body: string, status = 200) => new Response(`<!doctype html><title>Sewa Kamera</title>${body}`, { status, headers: { "content-type": "text/html" } });
      if (path === "/") return html(`<body style="background:${color}"><h1>Sewa Kamera ZV-E10</h1><a href="/booking">Book</a></body>`);
      if (path === "/broken-js") return html(`<h1>Booking</h1><script>throw new Error("booking widget crashed")</script>`);
      if (path === "/booking") return html("<h1>Internal Server Error</h1>", 500);
      return new Response("not found", { status: 404 });
    },
  });
  base = `http://127.0.0.1:${site.port}`;
});
afterAll(() => {
  site.stop(true);
  rmSync(root, { recursive: true, force: true });
});

const t = (n: string) => TOOL_REGISTRY[n]!;

describe("http_check", () => {
  test("reports status and text", async () => {
    const { ctx } = makeCtx(mkdtempSync(join(root, "ws-")));
    const ok = await runTool(t("http_check"), { url: `${base}/`, expect_text: "ZV-E10" }, ctx);
    expect(ok.ok).toBe(true);
    expect((ok.output as { status: number }).status).toBe(200);
    const bad = await runTool(t("http_check"), { url: `${base}/booking` }, ctx);
    expect(bad.ok).toBe(false);
    expect(bad.summary).toContain("500");
  });

  test("host allowlist and scheme are enforced", async () => {
    const { ctx } = makeCtx(mkdtempSync(join(root, "ws-")), { httpAllow: ["example.com"] });
    expect((await runTool(t("http_check"), { url: `${base}/` }, ctx)).summary).toContain("allowlist");
    const open = makeCtx(mkdtempSync(join(root, "ws-")));
    expect((await runTool(t("http_check"), { url: "file:///C:/Windows/win.ini" }, open.ctx)).summary).toContain("http(s)");
    expect((await runTool(t("http_check"), { url: "http://user:pw@127.0.0.1/" }, open.ctx)).summary).toContain("credentials");
  });
});

describe("browser_check (real Chromium via the Node worker)", () => {
  test("healthy page: OK, screenshot uploaded, artifact event", async () => {
    const ws = mkdtempSync(join(root, "ws-"));
    const { ctx, events, uploads } = makeCtx(ws, { baselineDir: join(root, "baselines") });
    const r = await runTool(t("browser_check"), { url: `${base}/`, name: "home", expect_text: "ZV-E10" }, ctx);
    expect(r.ok).toBe(true);
    const out = r.output as { status: number; title: string; console_errors: string[]; diff: { baseline_existed: boolean } };
    expect(out.status).toBe(200);
    expect(out.title).toBe("Sewa Kamera");
    expect(out.console_errors).toEqual([]);
    expect(out.diff.baseline_existed).toBe(false);
    expect(existsSync(join(ws, "screenshots", "home.png"))).toBe(true);
    expect(uploads).toEqual(["home.png"]);
    expect(events.some((e) => e.type === "artifact.created" && e.payload.kind === "screenshot")).toBe(true);
    const call = events.find((e) => e.type === "agent.tool_call");
    expect(call?.type === "agent.tool_call" && call.payload.category).toBe("browser");
  }, 60_000);

  test("visual diff: same page unchanged, changed background detected", async () => {
    const baselines = join(root, "baselines-diff");
    const run = async () => {
      const { ctx } = makeCtx(mkdtempSync(join(root, "ws-")), { baselineDir: baselines });
      return (await runTool(t("browser_check"), { url: `${base}/`, name: "home" }, ctx)).output as { diff: { ratio: number; changed: boolean; baseline_existed: boolean } };
    };
    color = "#ffffff";
    await run();
    const same = await run();
    expect(same.diff.baseline_existed).toBe(true);
    expect(same.diff.changed).toBe(false);
    color = "#ff0000";
    const changed = await run();
    expect(changed.diff.changed).toBe(true);
    expect(changed.diff.ratio).toBeGreaterThan(0.5);
    color = "#ffffff";
  }, 90_000);

  test("broken pages: HTTP 500 and uncaught JS errors are reported", async () => {
    const { ctx } = makeCtx(mkdtempSync(join(root, "ws-")));
    const r500 = await runTool(t("browser_check"), { url: `${base}/booking` }, ctx);
    expect(r500.ok).toBe(false);
    expect(r500.summary).toContain("HTTP 500");
    const js = await runTool(t("browser_check"), { url: `${base}/broken-js` }, ctx);
    expect(js.summary).toContain("console errors");
    expect(JSON.stringify(js.output)).toContain("booking widget crashed");
  }, 60_000);
});

describe("system_metrics and write_report", () => {
  test("metrics and report", async () => {
    const ws = mkdtempSync(join(root, "ws-"));
    const { ctx, events, uploads } = makeCtx(ws);
    const m = await runTool(t("system_metrics"), {}, ctx);
    expect(m.ok).toBe(true);
    expect((m.output as { cpus: number }).cpus).toBeGreaterThan(0);
    const r = await runTool(t("write_report"), { title: "Morning report", markdown: "All systems OK." }, ctx);
    expect(r.ok).toBe(true);
    expect(uploads).toEqual(["morning-report.md"]);
    expect(events.some((e) => e.type === "artifact.created" && e.payload.kind === "report")).toBe(true);
    expect(existsSync(join(ws, "reports", "morning-report.md"))).toBe(true);
  });
});
