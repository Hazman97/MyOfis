// Visual check: log in and screenshot pages at desktop and phone sizes, light and dark.
// Runs under Node (Playwright does not launch under Bun on Windows).
//   node apps/web/scripts/shots.mjs --out <dir> [--base http://127.0.0.1:5180] [--routes /,/approvals] [--variants desktop-light,phone-dark] [--wait 800]
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith("--") ? [...acc, [v.slice(2), all[i + 1]]] : acc), []),
);
const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const envText = readFileSync(join(repoRoot, ".env"), "utf8");
const token = envText.match(/^LOCAL_AUTH_TOKEN=(.*)$/m)?.[1]?.trim();
if (!token) throw new Error("LOCAL_AUTH_TOKEN missing in .env");

const base = (args.base ?? "http://127.0.0.1:5180").replace(/\/$/, "");
const out = resolve(args.out ?? "shots");
const routes = (args.routes ?? "/").split(",");
const waitMs = Number(args.wait ?? 800);
const VARIANTS = {
  "desktop-light": { viewport: { width: 1440, height: 900 }, colorScheme: "light" },
  "desktop-dark": { viewport: { width: 1440, height: 900 }, colorScheme: "dark" },
  "phone-light": { viewport: { width: 390, height: 844 }, colorScheme: "light", deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  "phone-dark": { viewport: { width: 390, height: 844 }, colorScheme: "dark", deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const variants = (args.variants ?? "desktop-light,phone-light").split(",");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
try {
  for (const v of variants) {
    const ctx = await browser.newContext(VARIANTS[v]);
    const login = await ctx.request.post(`${base}/api/auth/login`, { data: { token }, headers: { origin: base } });
    if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    for (const route of routes) {
      await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(waitMs);
      const name = `${v}${route.replace(/[^a-z0-9]+/gi, "_") || "_home"}.png`;
      await page.screenshot({ path: join(out, name), fullPage: args.full !== "false" });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      console.log(`${name}${overflow ? "  ! horizontal overflow" : ""}`);
    }
    if (errors.length) console.log(`  console errors (${v}):`, [...new Set(errors)].slice(0, 5).join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close();
}
