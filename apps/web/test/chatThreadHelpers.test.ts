import { describe, expect, test } from "bun:test";
import {
  clipSpeechBubble,
  detectNewReply,
  extractOccLinks,
  extractSpeakableText,
  fetchAndOpenThread,
  formatLiteMarkdown,
  isAudioAttachment,
  isChattableAgent,
  isDocAttachment,
  isVideoAttachment,
  liveMessageState,
  readStoredBool,
  resolveInitialDockOpen,
  type ReplySnapshot,
} from "../src/chat/chatThreadHelpers.ts";
import type { ChatMessage } from "../src/api/http.ts";
import type { JobView, RunView } from "@agent-office/shared";

describe("chatThreadHelpers", () => {
  test("formatLiteMarkdown escapes HTML and converts formatting", () => {
    const raw = `<script>alert('xss')</script> & **bold** with \`code\` and $\\rightarrow$ arrow\n- bullet 1`;
    const formatted = formatLiteMarkdown(raw);
    expect(formatted).not.toContain("<script>");
    expect(formatted).toContain("&lt;script&gt;");
    expect(formatted).toContain("<strong>bold</strong>");
    expect(formatted).toContain("<code>code</code>");
    expect(formatted).toContain("→ arrow");
    expect(formatted).toContain("• bullet 1");
  });

  test("extractSpeakableText separates coach conversation from correction notes", () => {
    const text = "Good job on your explanation!\n\n**More natural:** You could say 'I run a rental service'.";
    expect(extractSpeakableText(text)).toBe("Good job on your explanation!");

    const text2 = "Great point.\n\nUseful phrase: In my experience...";
    expect(extractSpeakableText(text2)).toBe("Great point.");
  });

  test("extractOccLinks extracts unique OpenChatCut editor URLs", () => {
    const text = "Check http://localhost:5173/#/editor/12345678-1234-1234-1234-123456789abc and http://127.0.0.1:3000/#/editor/12345678-1234-1234-1234-123456789abc";
    const links = extractOccLinks(text);
    expect(links.length).toBe(2);
    expect(links[0]).toBe("http://localhost:5173/#/editor/12345678-1234-1234-1234-123456789abc");
  });

  test("attachment type helpers", () => {
    expect(isVideoAttachment({ content_type: "video/mp4" })).toBe(true);
    expect(isVideoAttachment({ content_type: "image/png" })).toBe(false);

    expect(isAudioAttachment({ content_type: "audio/ogg" })).toBe(true);
    expect(isAudioAttachment({ content_type: "video/mp4" })).toBe(false);

    expect(isDocAttachment({ content_type: "application/pdf" })).toBe(true);
    expect(isDocAttachment({ content_type: "image/jpeg" })).toBe(false);
  });

  test("isChattableAgent filters out external agents or disabled agents", () => {
    expect(isChattableAgent({ enabled: true })).toBe(true);
    expect(isChattableAgent({ enabled: false })).toBe(false);
    expect(isChattableAgent({ enabled: true, config: { external: true } })).toBe(false);
  });

  test("liveMessageState derives live output and status from store", () => {
    const jobs: Record<string, JobView> = {
      j1: {
        id: "j1",
        agent_id: "a1",
        project_id: null,
        title: "Test",
        type: "chat",
        trigger: "manual",
        parent_job_id: null,
        status: "running",
        created_at: "2026-10-29T10:00:00Z",
        run_ids: ["r1"],
      },
    };
    const runs: Record<string, RunView> = {
      r1: {
        id: "r1",
        job_id: "j1",
        agent_id: "a1",
        runner_id: "rn1",
        status: "running",
        started_at: "2026-10-29T10:00:01Z",
        ended_at: null,
        tokens_in: 10,
        tokens_out: 20,
        cost_usd: 0.001,
        cost_unknown: false,
        error: null,
        output: "Live reply text streaming...",
        step: "Thinking",
        event_count: 3,
        last_event_at: "2026-10-29T10:00:02Z",
      },
    };
    const msg: ChatMessage = {
      job_id: "j1",
      agent_id: "a1",
      text: "Hello",
      created_at: "2026-10-29T10:00:00Z",
      status: "queued",
      run_id: null,
      reply: null,
    };

    const res = liveMessageState(jobs, runs, msg);
    expect(res.reply).toBe("Live reply text streaming...");
    expect(res.status).toBe("running");
    expect(res.runId).toBe("r1");
    expect(res.isThinking).toBe(false);
  });

  test("clipSpeechBubble cleans markdown and limits to ~60 characters", () => {
    const text = "**WiFi 8** mengekalkan kelajuan puncak sekitar `23 Gbps` dan memfokuskan kepada kebolehpercayaan ultra-tinggi dalam rangkaian padat.";
    const clipped = clipSpeechBubble(text, 60);
    expect(clipped.length).toBeLessThanOrEqual(60);
    expect(clipped).not.toContain("**");
    expect(clipped).not.toContain("`");
    expect(clipped.endsWith("…")).toBe(true);

    const shortText = "Baik, saya sedang siapkan analisa.";
    expect(clipSpeechBubble(shortText, 60)).toBe("Baik, saya sedang siapkan analisa.");
  });

  test("readStoredBool & resolveInitialDockOpen restore stored open/closed state when prop is undefined (item 3)", () => {
    const fakeStore = (val: string | null) => ({ getItem: () => val });
    const throwingStore = {
      getItem: () => {
        throw new Error("SecurityError");
      },
    };

    expect(readStoredBool(fakeStore("true"), "k")).toBe(true);
    expect(readStoredBool(fakeStore("false"), "k")).toBe(false);
    expect(readStoredBool(fakeStore(null), "k")).toBe(null);
    expect(readStoredBool(throwingStore, "k")).toBe(null);

    // When prop is undefined (uncontrolled initial), stored value is restored
    expect(resolveInitialDockOpen(undefined, true)).toBe(true);
    expect(resolveInitialDockOpen(undefined, false)).toBe(false);
    expect(resolveInitialDockOpen(undefined, null)).toBe(false);
    // Explicit prop wins
    expect(resolveInitialDockOpen(false, true)).toBe(false);
    expect(resolveInitialDockOpen(true, false)).toBe(true);
  });

  test("fetchAndOpenThread invokes onReady strictly after messages are applied (item 5)", async () => {
    let currentMessages: ChatMessage[] = [];
    const events: string[] = [];
    const sampleMsg: ChatMessage = {
      job_id: "j1",
      agent_id: "a1",
      text: "Hi",
      created_at: "2026-11-18T00:00:00Z",
      status: "done",
      run_id: "r1",
      reply: "Hello!",
    };

    const err = await fetchAndOpenThread(
      "cht_1",
      async () => [sampleMsg],
      (msgs) => {
        currentMessages = msgs;
        events.push(`applied:${msgs.length}`);
      },
      (tid) => {
        events.push(`ready:${tid}:count=${currentMessages.length}`);
      },
    );

    expect(err).toBeNull();
    expect(events).toEqual(["applied:1", "ready:cht_1:count=1"]);
  });

  test("detectNewReply ignores initial load and agent switch, triggers only on new reply after user message (item 8)", () => {
    let snap: ReplySnapshot | null = null;

    // 1. Loading state does not trigger unread
    let res = detectNewReply(snap, "a1:t1", [], true);
    snap = res.next;
    expect(res.hasNewReply).toBe(false);

    // 2. Initial thread load with an existing reply does NOT trigger unread
    res = detectNewReply(snap, "a1:t1", [{ job_id: "j1", reply: "Old reply" }], false);
    snap = res.next;
    expect(res.hasNewReply).toBe(false);

    // 3. Switching to another agent/thread with existing reply does NOT trigger unread
    res = detectNewReply(snap, "a2:t2", [{ job_id: "j2", reply: "Another old reply" }], false);
    snap = res.next;
    expect(res.hasNewReply).toBe(false);

    // 4. User sends a new message (no reply yet) -> does NOT trigger unread
    res = detectNewReply(
      snap,
      "a2:t2",
      [
        { job_id: "j2", reply: "Another old reply" },
        { job_id: "j3", reply: "" },
      ],
      false,
    );
    snap = res.next;
    expect(res.hasNewReply).toBe(false);

    // 5. Agent reply arrives for j3 -> DOES trigger unread
    res = detectNewReply(
      snap,
      "a2:t2",
      [
        { job_id: "j2", reply: "Another old reply" },
        { job_id: "j3", reply: "Here is my answer!" },
      ],
      false,
    );
    snap = res.next;
    expect(res.hasNewReply).toBe(true);
  });
});

