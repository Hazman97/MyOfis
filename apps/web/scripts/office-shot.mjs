// Office view check: open the office in 3D or pixel mode, print page errors with stacks, zoom in, screenshot the canvas.
// MSYS_NO_PATHCONV=1 node scripts/office-shot.mjs <base url> <out.png> [3d|pixel] [zoom steps]  (run from apps/web; logs in with LOCAL_AUTH_TOKEN from .env)
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [base, out, mode = "3d", zoomSteps = "2"] = process.argv.slice(2);
const token = readFileSync(join(process.cwd(), "../../.env"), "utf8").match(/^LOCAL_AUTH_TOKEN=(.*)$/m)?.[1]?.trim();
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.request.post(`${base}/api/auth/login`, { data: { token }, headers: { origin: base } });
await ctx.addInitScript((m) => localStorage.setItem("office.view", m), mode);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message, "\n", (e.stack || "").split("\n").slice(0, 6).join("\n")));
page.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text()));
await page.goto(base + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(6000);
for (let i = 0; i < Number(zoomSteps); i++) {
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(300);
}
await page.waitForTimeout(800);
const canvas = page.locator('[aria-label="Office view: agents at work"]');
await canvas.screenshot({ path: out });
console.log("saved", out);
await browser.close();
