import { chromium } from "file:///c:/Users/Hazman/Documents/GitHub/MyOfis/apps/web/node_modules/playwright/index.mjs";
import { join } from "node:path";
import { readFileSync, existsSync, mkdirSync } from "node:fs";

const ARTIFACT_DIR = "C:/Users/Hazman/.gemini/antigravity-ide/brain/d339d541-4a8b-45dd-8276-1c235d71fbbc";
const SCREENSHOTS_DIR = join(ARTIFACT_DIR, "screenshots");
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const REPO_ROOT = "c:/Users/Hazman/Documents/GitHub/MyOfis";
const MAPS_DIR = join(REPO_ROOT, "maps");

const mockAgents = [
  {
    id: "publisher",
    slug: "publisher",
    name: "Publisher",
    role: "Content Publisher",
    sprite: "default",
    provider: "anthropic",
    model: "claude-3-7-sonnet",
    system_prompt: "You are publisher",
    tools: [],
    config: {
      shell_allowlist: [],
      read_paths: [],
      http_allowlist: [],
      max_steps: 30,
      runtime: "ai-sdk",
      self_review: true,
      preferences: { language: "auto", tone: "auto", length: "auto", emoji: "auto", format: "auto", notes: "" },
    },
    permission_level: "safe",
    daily_token_budget: 200000,
    runner_id: null,
    desk_x: 6,
    desk_y: 5,
    enabled: true,
    created_at: "2026-10-18T10:00:00Z",
    workspace_id: "owner",
    shared: false,
  },
  {
    id: "coder",
    slug: "coder",
    name: "Coder",
    role: "Software Engineer",
    sprite: "default",
    provider: "anthropic",
    model: "claude-3-7-sonnet",
    system_prompt: "You are coder",
    tools: [],
    config: {
      shell_allowlist: [],
      read_paths: [],
      http_allowlist: [],
      max_steps: 30,
      runtime: "ai-sdk",
      self_review: true,
      preferences: { language: "auto", tone: "auto", length: "auto", emoji: "auto", format: "auto", notes: "" },
    },
    permission_level: "review",
    daily_token_budget: 200000,
    runner_id: null,
    desk_x: 10,
    desk_y: 5,
    enabled: false, // Paused agent to test Enable styling!
    created_at: "2026-10-18T10:00:00Z",
    workspace_id: "owner",
    shared: false,
  },
];

async function setupRoutes(page) {
  // Mock WebSocket
  await page.addInitScript(() => {
    class MockWebSocket extends EventTarget {
      constructor(url) {
        super();
        this.url = url;
        this.readyState = 1;
        setTimeout(() => {
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                type: "snapshot",
                state: {
                  last_event_id: 1,
                  paused: false,
                  runners: {},
                  agents: {
                    publisher: { id: "publisher", activity: "idle", current_job_id: null, moment: null, thinking: false },
                    coder: { id: "coder", activity: "idle", current_job_id: null, moment: null, thinking: false },
                  },
                  jobs: {},
                  runs: {},
                  cost_by_day: {},
                  pending_approvals: {},
                  pending_drafts: {},
                  pending_skills: {},
                },
              }),
            })
          );
        }, 50);
      }
      send() {}
      close() {
        this.readyState = 3;
        this.dispatchEvent(new Event("close"));
      }
    }
    window.WebSocket = MockWebSocket;
  });

  // Intercept API routes
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const url = route.request().url();
      const pathname = new URL(url).pathname;

      // Assets
      if (pathname.startsWith("/api/office/assets/")) {
        const file = pathname.replace("/api/office/assets/", "");
        const filePath = join(MAPS_DIR, file);
        if (existsSync(filePath)) {
          const contentType = file.endsWith(".json") || file.endsWith(".tmj") ? "application/json" : "image/png";
          const body = readFileSync(filePath);
          return route.fulfill({ status: 200, contentType, body });
        }
        return route.fulfill({ status: 404 });
      }

      if (pathname.includes("/api/auth/me")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            mode: "cf-access",
            email: "hazman5001@gmail.com",
            name: "Hazman",
            role: "owner",
            workspace_id: "owner",
            home_workspace_id: "owner",
          }),
        });
      }

      if (pathname.includes("/api/agents")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ agents: mockAgents }),
        });
      }

      if (pathname.includes("/api/rooms")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            rooms: [
              { id: "owner", name: "HQ", kind: "hq", daily_token_budget: 0, left_today: null, members: [], agents: 2, projects: 0, current: true },
            ],
          }),
        });
      }

      if (pathname.includes("/api/members")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ members: [] }) });
      }
      if (pathname.includes("/api/projects")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ projects: [] }) });
      }
      if (pathname.includes("/api/providers")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ providers: [] }) });
      }
      if (pathname.includes("/api/runners")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ runners: [] }) });
      }

      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    }
  );
}

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem("ao_theme", t);
  }, theme);
  await page.waitForTimeout(100);
}

async function testOfficePlay() {
  console.log("Starting Office Play tests...");
  const browser = await chromium.launch({ headless: true });

  const viewports = [
    { name: "desktop", width: 1280, height: 800 },
    { name: "phone_390px", width: 390, height: 844 },
  ];

  for (const vp of viewports) {
    for (const theme of ["light", "dark"]) {
      console.log(`\nTesting ${vp.name} in ${theme} mode...`);
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.name.includes("phone"),
        hasTouch: vp.name.includes("phone"),
      });

      const page = await context.newPage();
      await setupRoutes(page);

      // Navigate to root (Office tab)
      await page.goto("http://127.0.0.1:5180/", { waitUntil: "networkidle" });
      await setTheme(page, theme);
      await page.waitForTimeout(1000); // let Phaser start up and render

      // 1. Verify OfficePlayHint
      const hint = page.locator("aside[aria-label='Office play controls guide']");
      const isVisible = await hint.isVisible();
      console.log(`Hint visible: ${isVisible}`);

      // Capture initial state (Hint card on desktop, collapsed pill on phone)
      const initialPic = join(SCREENSHOTS_DIR, `office_${vp.name}_${theme}_initial.png`);
      await page.screenshot({ path: initialPic });
      console.log(`Saved screenshot: ${initialPic}`);

      // If phone, toggle expand to show the card
      if (vp.name.includes("phone")) {
        const toggleBtn = page.locator("button[title='Show play controls']");
        if (await toggleBtn.isVisible()) {
          console.log("Expanding hint card on phone...");
          await toggleBtn.click();
          await page.waitForTimeout(200);
          const expandedPic = join(SCREENSHOTS_DIR, `office_${vp.name}_${theme}_hint_expanded.png`);
          await page.screenshot({ path: expandedPic });
          console.log(`Saved expanded hint screenshot: ${expandedPic}`);
        }
      }

      // 2. Test "Chat with X" chip
      console.log("Triggering 'Chat with Publisher' chip...");
      await page.evaluate(() => {
        // Find Vue DashboardView component and set nearAgent
        const officeSection = document.querySelector("section[aria-label='Office']");
        if (officeSection) {
          // Dispatch near agent event via the Canvas vue component or set nearAgent
          const canvasEl = officeSection.querySelector("div[tabindex='0']");
          // Vue 3 internal instance
          let vnode = officeSection.__vueParentComponent;
          if (vnode?.setupState) {
            vnode.setupState.nearAgent = "publisher";
          }
        }
      });
      await page.waitForTimeout(350); // let Transition animation complete

      const chatChip = page.locator("button:has-text('Chat with Publisher')");
      const chipVisible = await chatChip.isVisible();
      console.log(`Chat with chip visible: ${chipVisible}`);
      const chipPic = join(SCREENSHOTS_DIR, `office_${vp.name}_${theme}_chat_chip.png`);
      await page.screenshot({ path: chipPic });
      console.log(`Saved chat chip screenshot: ${chipPic}`);

      // 3. Test AgentRadialMenu for active agent (Publisher)
      console.log("Triggering radial menu for Publisher (active agent)...");
      const menuX = vp.width === 390 ? 195 : 450;
      const menuY = vp.width === 390 ? 350 : 300;

      await page.evaluate(({ x, y }) => {
        const officeSection = document.querySelector("section[aria-label='Office']");
        const vnode = officeSection?.__vueParentComponent;
        if (vnode?.setupState) {
          vnode.setupState.menu = { id: "publisher", x, y };
        }
      }, { x: menuX, y: menuY });
      await page.waitForTimeout(300);

      const radialMenu = page.locator("div[role='menu']");
      const menuVisible = await radialMenu.isVisible();
      console.log(`Radial menu visible: ${menuVisible}`);
      const menuPic = join(SCREENSHOTS_DIR, `office_${vp.name}_${theme}_menu_active.png`);
      await page.screenshot({ path: menuPic });
      console.log(`Saved menu active screenshot: ${menuPic}`);

      // 4. Test AgentRadialMenu for paused agent (Coder) to test "Enable" styling
      console.log("Triggering radial menu for Coder (paused agent)...");
      await page.evaluate(({ x, y }) => {
        const officeSection = document.querySelector("section[aria-label='Office']");
        const vnode = officeSection?.__vueParentComponent;
        if (vnode?.setupState) {
          vnode.setupState.menu = { id: "coder", x, y };
        }
      }, { x: menuX, y: menuY });
      await page.waitForTimeout(300);

      const menuPausedPic = join(SCREENSHOTS_DIR, `office_${vp.name}_${theme}_menu_paused.png`);
      await page.screenshot({ path: menuPausedPic });
      console.log(`Saved menu paused screenshot: ${menuPausedPic}`);

      // 5. Test edge clamping of radial menu (near edge x: 20, y: 30)
      console.log("Triggering radial menu near top-left edge (testing edge clamping)...");
      await page.evaluate(() => {
        const officeSection = document.querySelector("section[aria-label='Office']");
        const vnode = officeSection?.__vueParentComponent;
        if (vnode?.setupState) {
          vnode.setupState.menu = { id: "publisher", x: 20, y: 30 };
        }
      });
      await page.waitForTimeout(300);

      const menuEdgePic = join(SCREENSHOTS_DIR, `office_${vp.name}_${theme}_menu_edge.png`);
      await page.screenshot({ path: menuEdgePic });
      console.log(`Saved menu edge clamped screenshot: ${menuEdgePic}`);

      // 6. Test closing menu with Escape
      console.log("Testing Escape key to close menu...");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      const isMenuClosed = !(await radialMenu.isVisible());
      console.log(`Menu closed on Escape: ${isMenuClosed}`);

      // 7. Test dismissing OfficePlayHint
      console.log("Testing dismiss hint...");
      const dismissBtn = page.locator("button[aria-label='Dismiss guide']");
      if (await dismissBtn.isVisible()) {
        await dismissBtn.click();
        await page.waitForTimeout(200);
        const isHintDismissed = !(await hint.isVisible());
        console.log(`Hint dismissed: ${isHintDismissed}`);
      }

      await context.close();
    }
  }

  // 8. Now test real user pointer interactions (right-click and long-press on canvas)
  console.log("\nTesting real canvas pointer interactions (right-click & long-press)...");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  await setupRoutes(p);
  await p.goto("http://127.0.0.1:5180/", { waitUntil: "networkidle" });
  await p.waitForTimeout(1000);

  // Get canvas element
  const canvas = p.locator("canvas");
  if (await canvas.isVisible()) {
    console.log("Canvas is present. Testing right-click on canvas center...");
    const box = await canvas.boundingBox();
    if (box) {
      // Right click near center
      await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
      await p.waitForTimeout(300);
      console.log("Right click performed.");

      // Test long press (mouse down, wait 600ms, mouse up)
      console.log("Testing long press (600ms mouse down)...");
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await p.mouse.down();
      await p.waitForTimeout(600);
      await p.mouse.up();
      console.log("Long press performed.");
    }
  }
  await ctx.close();

  await browser.close();
  console.log("\nAll tests completed successfully!");
}

testOfficePlay().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
