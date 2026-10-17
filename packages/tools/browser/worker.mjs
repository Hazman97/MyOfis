// Browser worker. Runs under NODE (not Bun): Playwright hangs on launch under Bun on Windows.
// Usage: node worker.mjs '<json request>'  ->  prints one JSON line with the result.
//
// Request: { url, screenshot_path, baseline_path?, timeout_ms?, expect_text?, viewport?: {width,height}, full_page? }
// Result:  { ok, status, final_url, title, load_ms, console_errors, failed_requests, text_found, screenshot_path,
//            diff: { ratio, changed, baseline_existed } | null, error? }
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const MAX_ITEMS = 20;
const DIFF_THRESHOLD = 0.01; // >1% of pixels changed = "changed"

function compare(currentPath, baselinePath) {
  if (!baselinePath) return null;
  const existed = existsSync(baselinePath);
  let diff = { ratio: 0, changed: false, baseline_existed: existed };
  if (existed) {
    const a = PNG.sync.read(readFileSync(baselinePath));
    const b = PNG.sync.read(readFileSync(currentPath));
    if (a.width !== b.width || a.height !== b.height) {
      diff = { ratio: 1, changed: true, baseline_existed: true, note: `size changed ${a.width}x${a.height} -> ${b.width}x${b.height}` };
    } else {
      const pixels = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 });
      const ratio = pixels / (a.width * a.height);
      diff = { ratio: Math.round(ratio * 10000) / 10000, changed: ratio > DIFF_THRESHOLD, baseline_existed: true };
    }
  }
  // "Previous run" baseline: the current screenshot becomes the baseline for next time.
  mkdirSync(dirname(baselinePath), { recursive: true });
  copyFileSync(currentPath, baselinePath);
  return diff;
}

async function main() {
  const req = JSON.parse(process.argv[2] ?? "{}");
  const consoleErrors = [];
  const failed = [];
  const started = Date.now();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: req.viewport ?? { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.on("console", (m) => m.type() === "error" && consoleErrors.length < MAX_ITEMS && consoleErrors.push(m.text().slice(0, 300)));
    page.on("pageerror", (e) => consoleErrors.length < MAX_ITEMS && consoleErrors.push(`uncaught: ${String(e.message).slice(0, 300)}`));
    page.on("requestfailed", (r) => failed.length < MAX_ITEMS && failed.push(`${r.method()} ${r.url().slice(0, 200)}: ${r.failure()?.errorText ?? "failed"}`));
    page.on("response", (r) => r.status() >= 400 && failed.length < MAX_ITEMS && failed.push(`${r.status()} ${r.url().slice(0, 200)}`));

    let response = null;
    let navError = null;
    try {
      response = await page.goto(req.url, { waitUntil: "load", timeout: req.timeout_ms ?? 30000 });
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    } catch (e) {
      navError = String(e.message ?? e).split("\n")[0];
    }
    const status = response?.status() ?? null;
    let textFound = null;
    if (req.expect_text && !navError) {
      textFound = (await page.locator("body").innerText().catch(() => "")).includes(req.expect_text);
    }
    mkdirSync(dirname(req.screenshot_path), { recursive: true });
    writeFileSync(req.screenshot_path, await page.screenshot({ fullPage: !!req.full_page }));
    const diff = compare(req.screenshot_path, req.baseline_path);
    const ok = !navError && status !== null && status < 400 && textFound !== false;
    return {
      ok,
      status,
      final_url: page.url(),
      title: await page.title().catch(() => ""),
      load_ms: Date.now() - started,
      console_errors: consoleErrors,
      failed_requests: failed,
      text_found: textFound,
      screenshot_path: req.screenshot_path,
      diff,
      ...(navError ? { error: navError } : {}),
    };
  } finally {
    await browser.close();
  }
}

main().then(
  (r) => process.stdout.write(JSON.stringify(r) + "\n"),
  (e) => {
    process.stdout.write(JSON.stringify({ ok: false, error: String(e?.message ?? e).split("\n")[0] }) + "\n");
    process.exitCode = 1;
  },
);
