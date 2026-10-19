import { chromium } from "file:///c:/Users/Hazman/Documents/GitHub/MyOfis/apps/web/node_modules/playwright/index.mjs";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.route(url => url.pathname.startsWith("/api/"), route => {
    const p = route.request().url();
    if (p.includes("/api/auth/me")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, mode: "local", role: "owner", workspace_id: "owner" }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, agents: [{ id: "publisher", slug: "publisher", name: "Publisher", enabled: true, desk_x: 0, desk_y: 0 }] }) });
  });

  await page.goto("http://127.0.0.1:5180/");
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    const sec = document.querySelector('section[aria-label="Office"]');
    const comp = sec.__vueParentComponent;
    comp.setupState.menu = { id: "publisher", x: 200, y: 200 };
  });
  await page.waitForTimeout(200);

  const menuDiv = page.locator("div[role='menu']");
  const menuDivVisible = await menuDiv.isVisible();
  const menuDivBox = await menuDiv.boundingBox();

  const btn = page.locator("button[role='menuitem']").first();
  const btnVisible = await btn.isVisible();
  const btnBox = await btn.boundingBox();

  console.log("menuDiv visible:", menuDivVisible, "box:", menuDivBox);
  console.log("button visible:", btnVisible, "box:", btnBox);

  await browser.close();
}

run();
