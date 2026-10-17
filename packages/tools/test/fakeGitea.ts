/**
 * In-memory stand-in for the Gitea REST API (only the endpoints our tools use).
 * Shapes follow Gitea's /api/v1 responses for those endpoints.
 */
export interface FakeGitea {
  url: string;
  token: string;
  issues: { number: number; title: string; body: string; labels: string[] }[];
  pulls: { number: number; head: string; base: string; title: string; body: string; merged_sha?: string }[];
  /** Mark a PR as merged (as if the owner clicked Merge in Gitea). */
  merge(number: number, sha?: string): void;
  comments: { number: number; body: string }[];
  statuses: Record<string, string>;
  requests: { method: string; path: string; auth: string | null }[];
  stop(): void;
}

/**
 * Serve real git repos over smart HTTP by running `git http-backend` as a CGI,
 * the same protocol Gitea speaks. Repos live at `<gitRoot>/<owner>/<repo>.git`.
 */
async function gitHttpBackend(req: Request, url: URL, gitRoot: string): Promise<Response> {
  const body = req.method === "POST" ? new Uint8Array(await req.arrayBuffer()) : undefined;
  const proc = Bun.spawn(["git", "http-backend"], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: gitRoot,
      GIT_HTTP_EXPORT_ALL: "1",
      PATH_INFO: url.pathname,
      QUERY_STRING: url.search.replace(/^\?/, ""),
      REQUEST_METHOD: req.method,
      CONTENT_TYPE: req.headers.get("content-type") ?? "",
      HTTP_CONTENT_ENCODING: req.headers.get("content-encoding") ?? "",
      REMOTE_USER: "agent", // authenticated by our token check; enables receive-pack (push)
      REMOTE_ADDR: "127.0.0.1",
    },
    stdin: body ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
  await proc.exited;
  // Split CGI headers from body.
  let sep = -1;
  for (let i = 0; i < out.length - 3; i++) {
    if (out[i] === 13 && out[i + 1] === 10 && out[i + 2] === 13 && out[i + 3] === 10) {
      sep = i;
      break;
    }
  }
  if (sep < 0) return new Response(await new Response(proc.stderr).text(), { status: 500 });
  const head = new TextDecoder().decode(out.subarray(0, sep));
  const headers = new Headers();
  let status = 200;
  for (const line of head.split("\r\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k.toLowerCase() === "status") status = Number(v.split(" ")[0]);
    else headers.set(k, v);
  }
  return new Response(out.subarray(sep + 4), { status, headers });
}

export function startFakeGitea(token = "gitea-test-token-0123456789", opts: { gitRoot?: string } = {}): FakeGitea {
  const state: Omit<FakeGitea, "url" | "stop" | "token" | "merge"> = { issues: [], pulls: [], comments: [], statuses: {}, requests: [] };
  let next = 1;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const auth = req.headers.get("authorization");
      state.requests.push({ method: req.method, path: url.pathname + url.search, auth });
      if (auth !== `token ${token}`) {
        // Git asks anonymously first; a 401 with a challenge makes it retry with credentials.
        if (/\.git\//.test(url.pathname)) return new Response("auth required", { status: 401, headers: { "www-authenticate": 'Basic realm="fake gitea"' } });
        return Response.json({ message: "token is required" }, { status: 401 });
      }
      if (opts.gitRoot && /^\/[^/]+\/[^/]+\.git\//.test(url.pathname)) return gitHttpBackend(req, url, opts.gitRoot);
      const m = url.pathname.match(/^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/(.+)$/);
      if (!m) return Response.json({ message: "not found" }, { status: 404 });
      const [, owner, repo, rest] = m;
      const html = (p: string) => `${url.origin}/${owner}/${repo}/${p}`;

      if (req.method === "GET" && rest === "issues") {
        const label = url.searchParams.get("labels");
        const list = state.issues.filter((i) => !label || i.labels.includes(label));
        return Response.json(list.map((i) => ({ ...i, html_url: html(`issues/${i.number}`), labels: i.labels.map((name) => ({ name })) })));
      }
      if (req.method === "GET" && rest === "pulls") {
        const want = url.searchParams.get("state") ?? "open";
        const list = state.pulls.filter((p) => (want === "closed" ? !!p.merged_sha : want === "open" ? !p.merged_sha : true));
        return Response.json(
          list.map((p) => ({
            number: p.number,
            title: p.title,
            body: p.body,
            html_url: html(`pulls/${p.number}`),
            state: p.merged_sha ? "closed" : "open",
            merged: !!p.merged_sha,
            merged_at: p.merged_sha ? new Date().toISOString() : null,
            merge_commit_sha: p.merged_sha ?? null,
            head: { ref: p.head },
            base: { ref: p.base },
          })),
        );
      }
      if (req.method === "POST" && rest === "pulls") {
        const b = (await req.json()) as { head: string; base: string; title: string; body: string };
        if (state.pulls.some((p) => p.head === b.head)) return Response.json({ message: "pull request already exists" }, { status: 409 });
        const pr = { number: next++, ...b };
        state.pulls.push(pr);
        return Response.json({ number: pr.number, html_url: html(`pulls/${pr.number}`) }, { status: 201 });
      }
      const c = rest!.match(/^issues\/(\d+)\/comments$/);
      if (req.method === "POST" && c) {
        const b = (await req.json()) as { body: string };
        state.comments.push({ number: Number(c[1]), body: b.body });
        return Response.json({ id: state.comments.length, html_url: html(`issues/${c[1]}#c`) }, { status: 201 });
      }
      const s = rest!.match(/^commits\/(.+)\/status$/);
      if (req.method === "GET" && s) {
        const ref = decodeURIComponent(s[1]!);
        const st = state.statuses[ref] ?? "pending";
        return Response.json({ state: st, statuses: [{ context: "ci/build", status: st, description: "build", target_url: html("actions") }] });
      }
      return Response.json({ message: "not found" }, { status: 404 });
    },
  });
  const merge = (number: number, sha = "abc123merge") => {
    const pr = state.pulls.find((p) => p.number === number);
    if (!pr) throw new Error(`no PR #${number}`);
    pr.merged_sha = sha;
  };
  return Object.assign(state, { url: `http://127.0.0.1:${server.port}`, token, merge, stop: () => void server.stop(true) });
}
