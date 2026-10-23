import { afterEach, describe, expect, test } from "bun:test";
import { startFakeTelegram, type FakeTelegram } from "./fakeTelegram.ts";
import { createTestEnv, waitFor, type TestEnv } from "./helpers.ts";
import { getJob } from "../src/repo.ts";

let env: TestEnv;
let tg: FakeTelegram | null = null;
afterEach(async () => {
  await env?.close();
  tg?.stop();
  tg = null;
});

const OWNER = 777001;
const said = (text: string) => tg!.sent.find((s) => s.method === "sendMessage" && String(s.body.text).includes(text));

async function setup() {
  tg = startFakeTelegram();
  env = await createTestEnv({}, { telegramApiBase: tg.url });
  await env.pairRunner();
  await env.api("/api/settings/integrations/telegram", { method: "PUT", body: { token: tg.token, chat_id: String(OWNER) } });
}

describe("Telegram: chat with an agent, approve drafts", () => {
  test("text and photos go to Publisher; its answer comes back; albums arrive as one message", async () => {
    await setup();
    // the built-in Publisher, with a model that simply echoes (real models read the photos)
    const pub = ((await env.api("/api/agents")).body.agents as { id: string; slug: string }[]).find((a) => a.slug === "publisher")!;
    await env.api(`/api/agents/${pub.id}`, { method: "PATCH", body: { provider: "mock", model: "mock-echo" } });

    tg!.push({ message: { message_id: 5, chat: { id: OWNER }, from: { id: OWNER }, caption: "tournament this saturday", photo: [{ file_id: "small", width: 90 }, { file_id: "big", width: 1280 }] } });
    const reply = await waitFor(() => said("Publisher:"), 8000, "agent reply");
    expect(String(reply.body.text)).toContain("tournament this saturday");
    const job = Object.values(env.hub.hub.store.state.jobs).find((j) => j.type === "chat")!;
    const row = getJob(env.hub.hub.db, job.id)!;
    expect(row.input).toMatchObject({ source: "telegram", attachments: [{ content_type: "image/jpeg" }] });
    // the biggest size of the photo was downloaded
    expect(tg!.sent.find((s) => s.method === "getFile")!.body.file_id).toBe("big");

    // an album: two messages with the same media_group_id become one chat message with 2 photos
    tg!.push({ message: { message_id: 6, chat: { id: OWNER }, from: { id: OWNER }, media_group_id: "g1", caption: "two photos", photo: [{ file_id: "p1" }] } });
    tg!.push({ message: { message_id: 7, chat: { id: OWNER }, from: { id: OWNER }, media_group_id: "g1", photo: [{ file_id: "p2" }] } });
    await waitFor(() => said("two photos"), 8000, "album reply");
    const jobs = Object.values(env.hub.hub.store.state.jobs).filter((j) => j.type === "chat");
    expect(jobs).toHaveLength(2);
    const album = getJob(env.hub.hub.db, jobs.at(-1)!.id)!;
    expect(album.input.attachments).toHaveLength(2);

    // strangers are ignored; /agent switches who you talk to
    tg!.push({ message: { chat: { id: 999 }, from: { id: 999 }, text: "hello?" } });
    tg!.push({ message: { chat: { id: OWNER }, from: { id: OWNER }, text: "/agent echo" } });
    await waitFor(() => said("Now talking to Echo"), 5000, "switched");
    expect(Object.values(env.hub.hub.store.state.jobs).filter((j) => j.type === "chat")).toHaveLength(2);
  }, 30_000);

  test("videos: up to 20 MB go to the agent, bigger ones get a pointer to the web chat; video drafts arrive with the video", async () => {
    await setup();
    const pub = ((await env.api("/api/agents")).body.agents as { id: string; slug: string }[]).find((a) => a.slug === "publisher")!;
    await env.api(`/api/agents/${pub.id}`, { method: "PATCH", body: { provider: "mock", model: "mock-echo" } });
    tg!.push({ message: { chat: { id: OWNER }, from: { id: OWNER }, caption: "edit ni", video: { file_id: "v1", file_size: 5_000_000, mime_type: "video/mp4", file_name: "match.mp4" } } });
    await waitFor(() => said("Publisher:"), 8000, "agent reply");
    const job = Object.values(env.hub.hub.store.state.jobs).find((j) => j.type === "chat")!;
    expect(getJob(env.hub.hub.db, job.id)!.input.attachments).toMatchObject([{ name: "match.mp4", content_type: "video/mp4" }]);
    tg!.push({ message: { chat: { id: OWNER }, from: { id: OWNER }, video: { file_id: "v2", file_size: 80_000_000, mime_type: "video/mp4" } } });
    await waitFor(() => said("over 20 MB"), 5000, "too big");

    // a video draft: the video is sent first, then the card
    const project = (await env.api("/api/projects", { body: { slug: "sp", name: "SmashPoint" } })).body.project;
    const video = (getJob(env.hub.hub.db, job.id)!.input.attachments as { id: string }[])[0]!.id;
    const ed = (await env.api("/api/agents", { body: { slug: "ed", name: "Editor", provider: "mock", model: "mock-script", tools: ["save_draft"], config: { self_review: false } } })).body.agent;
    const check = { facts_match_brief: true, only_released_features: true, no_overclaims: true, tone_and_language_match: true, notes: "" };
    const script = [{ tool: "save_draft", input: { project: "sp", platform: "tiktok", kind: "video", title: "Highlight", body: "Smash! #smashpoint", self_check: check, video } }, { text: "ok" }];
    await env.api("/api/jobs", { body: { agent_id: ed.id, project_id: project.id, title: "tiktok", input: { script, attachments: [{ id: video, name: "match.mp4", content_type: "video/mp4" }] } } });
    await waitFor(() => tg!.sent.find((s) => s.method === "sendMessage" && String(s.body.text).includes("Highlight") && s.body.reply_markup), 8000, "video card");
    const sv = tg!.sent.find((s) => s.method === "sendVideo")!;
    expect(sv.body).toMatchObject({ caption: "🎬 Highlight", video: { size: 11 } });
  }, 30_000);

  test("each new draft arrives as a card; the owner approves or rejects it with a signed button", async () => {
    await setup();
    const project = (await env.api("/api/projects", { body: { slug: "sp", name: "SmashPoint" } })).body.project;
    const agent = (await env.api("/api/agents", { body: { slug: "mk", name: "Marketing", provider: "mock", model: "mock-script", tools: ["save_draft"], config: { self_review: false } } })).body.agent;
    const check = { facts_match_brief: true, only_released_features: true, no_overclaims: true, tone_and_language_match: true, notes: "" };
    const draft = (title: string) => ({ tool: "save_draft", input: { project: "sp", platform: "facebook", kind: "caption", title, body: `${title}: court promo this weekend`, self_check: check } });
    await env.api("/api/jobs", { body: { agent_id: agent.id, project_id: project.id, title: "captions", input: { script: [draft("Caption A"), draft("Caption B"), { text: "done" }] } } });

    const card = await waitFor(() => tg!.sent.find((s) => s.method === "sendMessage" && String(s.body.text).includes("Caption A") && s.body.reply_markup), 8000, "draft card");
    await waitFor(() => said("Caption B"), 5000, "second card");
    const [approve, reject] = (card.body.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard[0]!.map((b) => b.callback_data);
    const drafts = (await env.api("/api/drafts?status=pending")).body.drafts as { id: string; title: string }[];
    const a = drafts.find((d) => d.title === "Caption A")!;

    // a forged button does nothing
    tg!.push({ callback_query: { id: "x1", from: { id: OWNER }, data: approve!.replace(/:[^:]+$/, ":AAAAAAAAAAAA"), message: { message_id: 1, chat: { id: OWNER } } } });
    await waitFor(() => tg!.sent.find((s) => s.method === "answerCallbackQuery" && s.body.text === "Not allowed."), 5000, "refused");
    // the real one approves
    tg!.push({ callback_query: { id: "x2", from: { id: OWNER }, data: approve!, message: { message_id: 1, chat: { id: OWNER } } } });
    await waitFor(() => tg!.sent.find((s) => s.method === "answerCallbackQuery" && String(s.body.text).startsWith("✅ Approved")), 5000, "approved");
    const decided = (await env.api("/api/drafts?status=decided")).body.drafts as { id: string; status: string }[];
    expect(decided.find((d) => d.id === a.id)?.status).toBe("approved");
    expect(reject).toContain(":n:");
  }, 30_000);

  test("voice notes: a voice note becomes voice-note.ogg attached to the chat job; audio over 20 MB is refused", async () => {
    await setup();
    const pub = ((await env.api("/api/agents")).body.agents as { id: string; slug: string }[]).find((a) => a.slug === "publisher")!;
    await env.api(`/api/agents/${pub.id}`, { method: "PATCH", body: { provider: "mock", model: "mock-echo" } });

    // a voice note: message.voice with mime_type: "audio/ogg", no file name
    tg!.push({
      message: {
        message_id: 20,
        chat: { id: OWNER },
        from: { id: OWNER },
        voice: { file_id: "voice-note-1", file_size: 1_500_000, mime_type: "audio/ogg" },
      },
    });

    await waitFor(() => said("Publisher:"), 8000, "agent reply for voice note");
    const job = Object.values(env.hub.hub.store.state.jobs).find((j) => j.type === "chat")!;
    const row = getJob(env.hub.hub.db, job.id)!;
    expect(row.input.attachments).toMatchObject([
      { name: "voice-note.ogg", content_type: "audio/ogg" },
    ]);
    expect(tg!.sent.find((s) => s.method === "getFile" && s.body.file_id === "voice-note-1")).toBeTruthy();

    // an audio file over 20 MB is refused with the existing "over 20 MB" notice
    tg!.push({
      message: {
        message_id: 21,
        chat: { id: OWNER },
        from: { id: OWNER },
        audio: { file_id: "audio-huge", file_size: 25_000_000, mime_type: "audio/mpeg", file_name: "meeting.mp3" },
      },
    });
    await waitFor(() => said("over 20 MB"), 5000, "audio over 20 MB refused");
  }, 30_000);
});

