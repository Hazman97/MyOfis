/**
 * Scripted OpenAI-compatible chat completions server (streaming and non-streaming).
 * Requests that carry tools consume the next script step; requests without tools
 * (OpenCode's title/summary helpers) get a short text and do not consume the script.
 */
export type FakeStep = { text: string } | { tool: string; input: Record<string, unknown> };

export interface FakeOpenAI {
  url: string;
  requests: { auth: string | null; path: string; hasTools: boolean; lastToolResult?: string }[];
  stop(): void;
}

export function startFakeOpenAI(script: FakeStep[], expectedKey = "fake-key"): FakeOpenAI {
  let step = 0;
  const requests: FakeOpenAI["requests"] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const auth = req.headers.get("authorization");
      if (url.pathname.endsWith("/models")) return Response.json({ object: "list", data: [{ id: "fake-model", object: "model" }] });
      const body = (await req.json()) as { stream?: boolean; tools?: unknown[]; messages?: { role: string; content: unknown }[] };
      const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
      const last = body.messages?.at(-1);
      requests.push({ auth, path: url.pathname, hasTools, lastToolResult: last?.role === "tool" ? String(last.content).slice(0, 2000) : undefined });
      if (auth !== `Bearer ${expectedKey}`) return Response.json({ error: { message: "bad key" } }, { status: 401 });

      // OpenCode resolves relative tool paths against its working directory, so scripts use relative paths.
      const s: FakeStep = hasTools ? (script[step++] ?? { text: "Done." }) : { text: "Fake title" };
      const id = `chatcmpl-${requests.length}`;
      const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };
      const toolCall = "tool" in s ? { index: 0, id: `call_${requests.length}`, type: "function", function: { name: s.tool, arguments: JSON.stringify(s.input) } } : null;

      if (!body.stream) {
        return Response.json({
          id,
          object: "chat.completion",
          created: 0,
          model: "fake-model",
          choices: [
            {
              index: 0,
              message: toolCall ? { role: "assistant", content: null, tool_calls: [toolCall] } : { role: "assistant", content: (s as { text: string }).text },
              finish_reason: toolCall ? "tool_calls" : "stop",
            },
          ],
          usage,
        });
      }
      const chunk = (delta: unknown, finish: string | null) =>
        `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 0, model: "fake-model", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      const parts = [chunk({ role: "assistant", content: "" }, null)];
      if (toolCall) parts.push(chunk({ tool_calls: [toolCall] }, null), chunk({}, "tool_calls"));
      else parts.push(chunk({ content: (s as { text: string }).text }, null), chunk({}, "stop"));
      parts.push(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 0, model: "fake-model", choices: [], usage })}\n\n`, "data: [DONE]\n\n");
      return new Response(parts.join(""), { headers: { "content-type": "text/event-stream" } });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, requests, stop: () => void server.stop(true) };
}
