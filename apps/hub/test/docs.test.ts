import { afterEach, describe, expect, test } from "bun:test";
import { freshFetch } from "@agent-office/shared";
import { getJob } from "../src/repo.ts";
import { TOKEN, createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

let env: TestEnv;
afterEach(async () => {
  await env?.close();
});

/** A tiny two-page PDF with real text (like a scanned-in minutes file would have, but with a text layer). */
function pdf(pages: string[]): Uint8Array {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objs.push("<</Type/Catalog/Pages 2 0 R>>");
  objs.push(`<</Type/Pages/Kids[${kids}]/Count ${pages.length}>>`);
  objs.push("<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>");
  pages.forEach((text, i) => {
    const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
    objs.push(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 144]/Contents ${5 + i * 2} 0 R/Resources<</Font<</F1 3 0 R>>>>>>`);
    objs.push(`<</Length ${stream.length}>>\nstream\n${stream}\nendstream`);
  });
  const body = objs.map((o, i) => `${i + 1} 0 obj${o}\nendobj\n`).join("");
  return new TextEncoder().encode(`%PDF-1.4\n${body}trailer<</Root 1 0 R>>\n%%EOF`);
}

const upload = async (bytes: Uint8Array, name: string, type: string) => {
  const res = await freshFetch(`${env.hub.url}/api/uploads?name=${encodeURIComponent(name)}`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": type }, body: bytes });
  return ((await res.json()) as { upload: { id: string } }).upload.id;
};

describe("Project Assistant: documents and the project log", () => {
  test("a PDF sent in chat is read and indexed; the assistant searches it, logs action items; reminders and weekly facts follow", async () => {
    env = await createTestEnv();
    await env.pairRunner();
    const hub = env.hub.hub;
    const project = (await env.api("/api/projects", { body: { slug: "mardi-gate", name: "MARDI Automatic Goat Shed Gate" } })).body.project;
    const minutes = await upload(pdf(["Kick-off meeting with MARDI. Gate must open at 7am.", "Action: Irfan to do site visit Kluang by 2026-10-28. Power from solar panel."]), "Minit Kick-off.pdf", "application/pdf");

    // the assistant (scripted model here) searches the minutes and logs what it found
    const pa = ((await env.api("/api/agents")).body.agents as { id: string; slug: string }[]).find((a) => a.slug === "project-assistant")!;
    await env.api(`/api/agents/${pa.id}`, { method: "PATCH", body: { provider: "mock", model: "mock-script", config: { self_review: false } } });
    const chat = (await env.api("/api/chat", { body: { agent_id: pa.id, text: "minit kickoff tadi", project_id: project.id, attachments: [minutes] } })).body;
    const input = getJob(hub.db, chat.job.id)!.input as { attachments: { doc_id?: string; pages?: number }[] };
    expect(input.attachments[0]).toMatchObject({ pages: 2 });
    const docId = input.attachments[0]!.doc_id!;
    expect(docId).toMatch(/^doc_/);

    const script = [
      { tool: "docs_search", input: { query: "site visit Kluang" } },
      { tool: "doc_read", input: { doc_id: docId, from_page: 1, to_page: 2 } },
      { tool: "doc_summary", input: { doc_id: docId, summary: "Kick-off minutes: gate opens 7am; site visit Kluang by 28 Oct; solar power." } },
      { tool: "project_log_add", input: { entries: [{ kind: "action", text: "Site visit Kluang", owner: "Irfan", due_date: "2026-10-28", source_doc_id: docId }, { kind: "decision", text: "Power from solar panel", source_doc_id: docId }] } },
      { tool: "project_log_list", input: {} },
      { text: "Done" },
    ];
    const job = (await env.api("/api/jobs", { body: { agent_id: pa.id, project_id: project.id, title: "read minutes", input: { script, attachments: input.attachments } } })).body.job;
    await waitFor(() => ["done", "failed"].includes(hub.store.state.jobs[job.id]?.status ?? ""), 10_000, "assistant run");
    expect(hub.store.state.jobs[job.id]?.status).toBe("done");

    // search finds the right page; the summary and log are saved
    const hits = (await env.api(`/api/docs/search?q=${encodeURIComponent("Kluang")}`)).body.hits;
    expect(hits[0]).toMatchObject({ doc_id: docId, page: 2 });
    expect((await env.api(`/api/docs?project_id=${project.id}`)).body.docs[0]).toMatchObject({ title: "Minit Kick-off.pdf", pages: 2, summary: expect.stringContaining("solar") });
    const log = (await env.api(`/api/log?project_id=${project.id}`)).body.entries as { id: string; kind: string; owner: string; due_date: string | null }[];
    expect(log.map((e) => e.kind).sort()).toEqual(["action", "decision"]);
    const action = log.find((e) => e.kind === "action")!;
    expect(action).toMatchObject({ owner: "Irfan", due_date: "2026-10-28" });

    // reminders: due within 2 days of 27 Oct, not once it is done
    expect(hub.docs.dueSoon("owner", 2, new Date("2026-10-27T09:00:00+08:00")).map((e) => e.text)).toEqual(["Site visit Kluang"]);
    expect(hub.docs.dueSoon("owner", 2, new Date("2026-10-20T09:00:00+08:00"))).toEqual([]);
    // weekly status facts
    expect(hub.docs.statusFacts("owner", project.id).open_actions).toMatchObject([{ text: "Site visit Kluang", owner: "Irfan" }]);
    await env.api(`/api/log/${action.id}`, { method: "PATCH", body: { status: "done" } });
    expect(hub.docs.dueSoon("owner", 2, new Date("2026-10-27T09:00:00+08:00"))).toEqual([]);
  }, 30_000);

  test("non-documents and PDFs without text are refused clearly; another room cannot see the documents", async () => {
    env = await createTestEnv();
    const notDoc = await upload(new Uint8Array([255, 216, 255, 0]), "p.jpg", "image/jpeg");
    expect((await env.api("/api/docs", { body: { upload_id: notDoc } })).status).toBe(400);
    const blank = await upload(pdf([""]), "scan.pdf", "application/pdf");
    const r = await env.api("/api/docs", { body: { upload_id: blank } });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("no text layer");
    const doc = await upload(pdf(["Secret price RM 9000"]), "quote.pdf", "application/pdf");
    expect((await env.api("/api/docs", { body: { upload_id: doc } })).status).toBe(201);
    // the index is per room
    expect(env.hub.hub.docs.search("Secret price", "owner")).toHaveLength(1);
    expect(env.hub.hub.docs.search("Secret price", "ws_someone_else")).toHaveLength(0);
  });
});
