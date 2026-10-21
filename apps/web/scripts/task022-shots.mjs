import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const envText = readFileSync(join(repoRoot, ".env"), "utf8");
const token = envText.match(/^LOCAL_AUTH_TOKEN=(.*)$/m)?.[1]?.trim();
if (!token) throw new Error("LOCAL_AUTH_TOKEN missing in .env");

const base = "http://127.0.0.1:8811";
const outDir = "C:\\Users\\Hazman\\.gemini\\antigravity-ide\\brain\\17b9b51f-4bbe-4a19-a7d6-b28d8423b9bb\\task022_shots";
mkdirSync(outDir, { recursive: true });

const VARIANTS = {
  "desktop-light": { viewport: { width: 1440, height: 900 }, colorScheme: "light" },
  "desktop-dark": { viewport: { width: 1440, height: 900 }, colorScheme: "dark" },
  "phone-light": { viewport: { width: 390, height: 844 }, colorScheme: "light", deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  "phone-dark": { viewport: { width: 390, height: 844 }, colorScheme: "dark", deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

const browser = await chromium.launch();
try {
  for (const [vName, vConfig] of Object.entries(VARIANTS)) {
    console.log(`\n=== Running variant: ${vName} ===`);
    const isPhone = vName.startsWith("phone");
    const isDark = vName.endsWith("dark");

    const ctx = await browser.newContext(vConfig);
    const login = await ctx.request.post(`${base}/api/auth/login`, { data: { token }, headers: { origin: base } });
    if (!login.ok()) throw new Error(`login failed: ${login.status()}`);

    const page = await ctx.newPage();

    // 1. Chat (with earlier threads)
    console.log("Capturing Chat...");
    await page.goto(`${base}/chat?agent=english-coach`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    // On phone, click the Conversations button to open drawer so the reviewer can see earlier threads!
    if (isPhone) {
      const convBtn = page.getByTitle("Conversations");
      if (await convBtn.isVisible()) {
        await convBtn.click();
        await page.waitForTimeout(500);
      }
    }
    await page.screenshot({ path: join(outDir, `chat_${vName}.png`), fullPage: false });

    // 2. Dashboard inside a room
    console.log("Capturing Dashboard inside room (Sewa Baju)...");
    await ctx.addCookies([{ name: "ao_room", value: "room_sewa_baju", domain: "127.0.0.1", path: "/" }]);
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(outDir, `dashboard_room_${vName}.png`), fullPage: false });

    // 3. Settings -> Social accounts
    console.log("Capturing Settings -> Social accounts...");
    await page.goto(`${base}/settings/social`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: join(outDir, `social_accounts_${vName}.png`), fullPage: false });

    // 4. Drafts with TikTok draft
    console.log("Capturing Drafts with TikTok draft...");
    // Return to owner room so drafts are visible
    await ctx.addCookies([{ name: "ao_room", value: "owner", domain: "127.0.0.1", path: "/" }]);
    await page.goto(`${base}/drafts`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: join(outDir, `drafts_tiktok_${vName}.png`), fullPage: false });

    // 5. Video Studio
    console.log("Capturing Video Studio...");
    await page.goto(`${base}/studio/upl_01m5c44kmca4zv20apshzr9svq`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(outDir, `video_studio_${vName}.png`), fullPage: false });

    await ctx.close();
  }
} finally {
  await browser.close();
  console.log(`\nAll screenshots saved to: ${outDir}`);
}
