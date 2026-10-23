import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const envText = readFileSync(join(repoRoot, ".env"), "utf8");
const token = envText.match(/^LOCAL_AUTH_TOKEN=(.*)$/m)?.[1]?.trim();
if (!token) throw new Error("LOCAL_AUTH_TOKEN missing in .env");

const secretsKey = envText.match(/^SECRETS_KEY=(.*)$/m)?.[1]?.trim() || "0".repeat(32);

const base = "http://127.0.0.1:8811";
const outDir = "C:\\Users\\Hazman\\.gemini\\antigravity-ide\\brain\\c829435f-741e-427d-b2bf-ff1a73e8c1cc\\screenshots";
mkdirSync(outDir, { recursive: true });

console.log("Starting preview hub on port 8811...");
const hubProc = spawn("bun", ["apps/hub/src/index.ts"], {
  cwd: repoRoot,
  env: {
    ...process.env,
    HUB_PORT: "8811",
    HUB_HOST: "127.0.0.1",
    PUBLIC_BASE_URL: "http://127.0.0.1:8811",
    AUTH_MODE: "local",
    LOCAL_AUTH_TOKEN: token,
    SECRETS_KEY: secretsKey,
    DATABASE_PATH: "./data/preview-8811.db",
    FILES_DIR: "./data/preview-files",
    WEB_DIST_DIR: "./apps/web/dist",
  },
  shell: true,
  stdio: ["ignore", "pipe", "pipe"],
});

hubProc.stdout?.on("data", (d) => process.stdout.write(`[hub] ${d}`));
hubProc.stderr?.on("data", (d) => process.stderr.write(`[hub err] ${d}`));

async function waitForHub(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/api/auth/mode`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("Preview hub did not start in time");
}

const VARIANTS = {
  "desktop-light": { viewport: { width: 1440, height: 900 }, colorScheme: "light" },
  "desktop-dark": { viewport: { width: 1440, height: 900 }, colorScheme: "dark" },
  "phone-light": { viewport: { width: 390, height: 844 }, colorScheme: "light", deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  "phone-dark": { viewport: { width: 390, height: 844 }, colorScheme: "dark", deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

try {
  await waitForHub();
  console.log("Preview hub is ready on http://127.0.0.1:8811");

  const browser = await chromium.launch();
  try {
    for (const [vName, vConfig] of Object.entries(VARIANTS)) {
      console.log(`\n=== Running variant: ${vName} ===`);
      const ctx = await browser.newContext(vConfig);

      // Login
      const login = await ctx.request.post(`${base}/api/auth/login`, {
        data: { token },
        headers: { origin: base },
      });
      if (!login.ok()) throw new Error(`login failed: ${login.status()}`);

      const page = await ctx.newPage();
      page.on("console", (msg) => console.log(`[page console] ${msg.type()}: ${msg.text()}`));
      page.on("pageerror", (err) => console.log(`[page error] ${err.message}`));

      // Mock audio capture for headless browser
      await page.addInitScript(() => {
        if (!navigator.mediaDevices) {
          navigator.mediaDevices = {};
        }
        navigator.mediaDevices.getUserMedia = async () => {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          const audioCtx = new AudioContextClass();
          const osc = audioCtx.createOscillator();
          const dst = audioCtx.createMediaStreamDestination();
          osc.connect(dst);
          osc.start();
          return dst.stream;
        };
      });

      // 1. Chat -> Notulis while recording
      console.log("Capturing Chat -> Notulis while recording...");
      await page.goto(`${base}/chat?agent=notulis`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1000);

      const rakamBtn = page.locator('button:has-text("Rakam")');
      await rakamBtn.waitFor({ state: "visible", timeout: 5000 });
      await rakamBtn.click();

      // Wait for recording red bar to appear and timer to tick
      await page.waitForSelector('text=Biarkan skrin terbuka semasa merakam', { timeout: 5000 });
      await page.waitForTimeout(1500);

      const chatShotPath = join(outDir, `chat_notulis_recording_${vName.replace("-", "_")}.png`);
      await page.screenshot({ path: chatShotPath, fullPage: false });
      console.log(`Saved: ${chatShotPath}`);

      // 2. Projects -> Docs -> Buka modal with .md note
      console.log("Capturing Projects -> Docs with Buka modal...");
      await page.goto(`${base}/projects`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1000);

      // Click on SmashPoint project card's Brief button to open BriefPanel
      const smashCard = page.locator('article:has-text("SmashPoint")').first();
      await smashCard.locator('button:has-text("Brief")').click();
      await page.waitForTimeout(1000);

      // Click on Docs tab
      const docsTab = page.locator('button[role="tab"]:has-text("Docs")');
      await docsTab.waitFor({ state: "visible", timeout: 5000 });
      await docsTab.click();
      await page.waitForTimeout(1000);

      // Click "Buka" button specifically for the .md document
      const mdDocCard = page.locator('article:has-text(".md")').first();
      await mdDocCard.waitFor({ state: "visible", timeout: 5000 });
      const bukaBtn = mdDocCard.locator('button:has-text("Buka")');
      await bukaBtn.waitFor({ state: "visible", timeout: 5000 });
      await bukaBtn.click();

      // Wait for modal and rendered markdown
      await page.waitForSelector('.markdown-doc', { timeout: 8000 });
      await page.waitForTimeout(800);

      const docShotPath = join(outDir, `project_docs_buka_md_${vName.replace("-", "_")}.png`);
      await page.screenshot({ path: docShotPath, fullPage: false });
      console.log(`Saved: ${docShotPath}`);

      await ctx.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  console.log("Stopping preview hub...");
  if (hubProc.pid) {
    spawn("taskkill", ["/pid", String(hubProc.pid), "/T", "/F"], { shell: true });
  }
}
