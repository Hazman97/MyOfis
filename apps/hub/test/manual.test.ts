import { afterEach, expect, test } from "bun:test";
import { freshFetch } from "@agent-office/shared";
import { TOKEN, createTestEnv, type TestEnv } from "./helpers.ts";

let env: TestEnv;
afterEach(async () => {
  await env?.close();
});

test("the manual is served to the owner only, with its office picture from the hub", async () => {
  env = await createTestEnv();
  const res = await freshFetch(`${env.hub.url}/api/manual`, { headers: { authorization: `Bearer ${TOKEN}` } });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  const html = await res.text();
  expect(html).toContain("<section");
  expect(html).toContain('src="/api/office/assets/preview.png"');
  expect(html).not.toContain("../maps/");
  expect((await freshFetch(`${env.hub.url}/api/manual`)).status).toBe(401);
});

test("/aitext serves the system overview as plain text, without login", async () => {
  env = await createTestEnv();
  const res = await freshFetch(`${env.hub.url}/aitext`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/plain");
  expect(await res.text()).toStartWith("# Agent Office (MyOfis): system overview");
});
