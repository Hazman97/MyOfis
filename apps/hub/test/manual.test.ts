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

test("/api/system describes the running system from code: schema with foreign keys, counts, versions, no secrets", async () => {
  env = await createTestEnv();
  await env.api("/api/settings/integrations/telegram", { method: "PUT", body: { token: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ012345", chat_id: "777" } });
  const res = await env.api("/api/system");
  expect(res.status).toBe(200);
  const s = res.body as {
    counts: { tools: number; event_types: number; tables: number };
    schema: { name: string; foreign_keys: { columns: string[]; table: string }[] }[];
    versions: { package: string; deps: Record<string, string> }[];
    integrations: { telegram: boolean };
  };
  expect(s.counts.tools).toBe(52);
  expect(s.counts.tables).toBe(s.schema.length);
  const drafts = s.schema.find((t) => t.name === "content_drafts")!;
  expect(drafts.foreign_keys).toContainEqual(expect.objectContaining({ columns: ["project_id"], table: "projects" }));
  expect(s.schema.map((t) => t.name)).toContain("search_index");
  expect(s.versions.find((v) => v.package === "apps/hub")!.deps.hono).toBeTruthy();
  expect(s.integrations.telegram).toBe(true);
  expect(JSON.stringify(s)).not.toContain("ABCDEFGHIJ");
  expect((await freshFetch(`${env.hub.url}/api/system`)).status).toBe(401);
});

test("/aitext serves the system overview as plain text, without login", async () => {
  env = await createTestEnv();
  const res = await freshFetch(`${env.hub.url}/aitext`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/plain");
  expect(await res.text()).toStartWith("# Agent Office (MyOfis): system overview");
});
