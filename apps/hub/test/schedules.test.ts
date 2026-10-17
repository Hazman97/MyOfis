import { afterEach, describe, expect, test } from "bun:test";
import type { Agent } from "@agent-office/shared";
import { createTestEnv, waitFor, type TestEnv } from "./helpers.ts";

let env: TestEnv;
afterEach(async () => {
  await env?.close();
});

const echo = async (e: TestEnv) => ((await e.api<{ agents: Agent[] }>("/api/agents")).body.agents.find((a) => a.slug === "echo")!);

const myt = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).format(
    new Date(iso),
  );

describe("schedules", () => {
  test("built-in schedules (Pak Guard 08:00 weekdays, Tester 02:00 nightly, Marketing Monday 09:00) are seeded switched off", async () => {
    env = await createTestEnv();
    const { body } = await env.api("/api/schedules");
    const crons = body.schedules.map((s: { cron: string; enabled: boolean }) => `${s.cron}|${s.enabled}`).sort();
    expect(crons).toEqual(["0 2 * * *|false", "0 8 * * 1-5|false", "0 9 * * 1|false"]);
  });

  test("a cron schedule creates jobs with trigger=schedule", async () => {
    env = await createTestEnv();
    const agent = await echo(env);
    const res = await env.api("/api/schedules", {
      body: { agent_id: agent.id, cron: "* * * * * *", job_template: { title: "tick", input: { text: "hello" } } },
    });
    expect(res.status).toBe(201);
    const job = await waitFor(
      () => Object.values(env.hub.hub.store.state.jobs).find((j) => j.trigger === "schedule"),
      3000,
      "scheduled job",
    );
    expect(job.title).toBe("tick");
    const { body } = await env.api("/api/schedules");
    const mine = body.schedules.find((s: { id: string }) => s.id === res.body.schedule.id);
    expect(mine.last_run_at).not.toBeNull();
    expect(mine.next_run_at).not.toBeNull();
  });

  test("next run is computed in Asia/Kuala_Lumpur", async () => {
    env = await createTestEnv();
    const agent = await echo(env);
    const { body } = await env.api("/api/schedules", {
      body: { agent_id: agent.id, cron: "0 8 * * 1-5", job_template: { title: "morning report" } },
    });
    const next = myt(body.schedule.next_run_at);
    expect(next).toMatch(/^(Mon|Tue|Wed|Thu|Fri) 08:00$/);
  });

  test("paused system and disabled schedules do not create jobs", async () => {
    env = await createTestEnv();
    const agent = await echo(env);
    await env.api("/api/settings/pause", { body: { paused: true } });
    const { body } = await env.api("/api/schedules", {
      body: { agent_id: agent.id, cron: "* * * * * *", job_template: { title: "nope" } },
    });
    await Bun.sleep(1500);
    expect(Object.keys(env.hub.hub.store.state.jobs)).toHaveLength(0);

    await env.api(`/api/schedules/${body.schedule.id}`, { method: "PATCH", body: { enabled: false } });
    await env.api("/api/settings/pause", { body: { paused: false } });
    await Bun.sleep(1500);
    expect(Object.keys(env.hub.hub.store.state.jobs)).toHaveLength(0);
    const list = await env.api("/api/schedules");
    expect(list.body.schedules.find((s: { id: string }) => s.id === body.schedule.id).next_run_at).toBeNull();
  });

  test("run now, invalid cron, delete", async () => {
    env = await createTestEnv();
    const agent = await echo(env);
    expect(
      (await env.api("/api/schedules", { body: { agent_id: agent.id, cron: "every tuesday-ish", job_template: { title: "x" } } })).status,
    ).toBe(400);
    const { body } = await env.api("/api/schedules", {
      body: { agent_id: agent.id, cron: "0 3 * * *", job_template: { title: "nightly", input: { text: "t" } } },
    });
    const run = await env.api(`/api/schedules/${body.schedule.id}/run-now`, { method: "POST" });
    expect(run.status).toBe(200);
    expect(env.hub.hub.store.state.jobs[run.body.job_id]?.trigger).toBe("schedule");
    expect((await env.api(`/api/schedules/${body.schedule.id}`, { method: "DELETE" })).status).toBe(200);
    const left = (await env.api("/api/schedules")).body.schedules as { id: string }[];
    expect(left.some((s) => s.id === body.schedule.id)).toBe(false);
  });
});

describe("projects", () => {
  test("create, list, update; jobs may reference a project", async () => {
    env = await createTestEnv();
    const created = await env.api("/api/projects", {
      body: { slug: "sewa-kamera", name: "Sewa Kamera ZV-E10", live_url: "https://example.com", repo_url: "" },
    });
    expect(created.status).toBe(201);
    expect(created.body.project.repo_url).toBeNull();
    expect((await env.api("/api/projects", { body: { slug: "sewa-kamera", name: "dup" } })).status).toBe(409);
    expect((await env.api("/api/projects", { body: { slug: "x", name: "x", live_url: "not a url" } })).status).toBe(400);

    const id = created.body.project.id;
    const upd = await env.api(`/api/projects/${id}`, { method: "PATCH", body: { live_url: "https://sewa.example.com" } });
    expect(upd.body.project.live_url).toBe("https://sewa.example.com");
    expect(upd.body.project.name).toBe("Sewa Kamera ZV-E10");

    const agent = await echo(env);
    expect((await env.api("/api/jobs", { body: { agent_id: agent.id, title: "t", project_id: id } })).status).toBe(201);
    expect((await env.api("/api/jobs", { body: { agent_id: agent.id, title: "t", project_id: "prj_nope" } })).status).toBe(400);
  });
});
