import { describe, expect, test } from "bun:test";
import { EVENT_TYPES, apply, initialState, type AgentEvent, type EventBody, type OfficeState } from "@agent-office/shared";
import { buildOfficeMap } from "../src/office/map/build.ts";
import { parseOfficeMap } from "../src/office/map/tmj.ts";
import { CATCH_UP_MS, OfficeWorld, assignDesks } from "../src/office/brain/world.ts";
import { REACTIONS } from "../src/office/brain/reactions.ts";
import type { AgentInfo } from "../src/office/brain/intent.ts";

const layout = parseOfficeMap(buildOfficeMap().map);

const agent = (id: string, slug: string, sprite = "default", extra: Partial<AgentInfo> = {}): AgentInfo => ({
  id,
  slug,
  name: slug,
  sprite,
  enabled: true,
  runner_id: null,
  desk_x: 0,
  desk_y: 0,
  ...extra,
});

/** A small office: drives the reducer and the world together, like the web app does. */
class Office {
  state: OfficeState = initialState();
  world = new OfficeWorld(layout);
  #id = 1;
  constructor(public agents: AgentInfo[]) {
    this.emit({ type: "runner.online", payload: { runner_id: "rn1", name: "main-pc" } });
    this.world.sync(this.state, agents);
  }
  emit(body: EventBody, extra: { run_id?: string; agent_id?: string } = {}): AgentEvent {
    const e = { id: this.#id++, ts: new Date().toISOString(), run_id: extra.run_id ?? null, agent_id: extra.agent_id ?? null, ...body } as AgentEvent;
    apply(this.state, e);
    this.world.sync(this.state, this.agents);
    return e;
  }
  run(ms: number, step = 50) {
    for (let t = 0; t < ms; t += step) this.world.update(step);
  }
  char(id: string) {
    return this.world.characters().find((c) => c.id === id);
  }
  place(id: string) {
    return this.world.debug(id)?.place ?? null;
  }
  // ---- event shorthands
  job(agentId: string, jobId: string, parent: string | null = null) {
    this.emit({ type: "job.created", payload: { job_id: jobId, agent_id: agentId, project_id: null, type: "task", title: "t", trigger: "manual", parent_job_id: parent } });
  }
  start(agentId: string, runId: string, jobId: string) {
    this.emit({ type: "run.started", payload: { run_id: runId, job_id: jobId, agent_id: agentId, runner_id: "rn1" } }, { run_id: runId, agent_id: agentId });
  }
  finish(agentId: string, runId: string, jobId: string) {
    this.emit(
      { type: "run.finished", payload: { run_id: runId, job_id: jobId, status: "done", tokens_in: 1, tokens_out: 1, cost_usd: 0, cost_unknown: false } },
      { run_id: runId, agent_id: agentId },
    );
  }
  tool(agentId: string, runId: string, category: "code" | "browser" | "search" | "read_docs" | "shell" | "meeting" | "git") {
    this.emit({ type: "agent.tool_call", payload: { call_id: `c${this.#id}`, tool: "x", category, args: {} } }, { run_id: runId, agent_id: agentId });
  }
}

const qa = agent("a_qa", "qa-bot", "tester");
const dev = agent("a_dev", "dev-bot", "coder");

describe("office brain", () => {
  test("first sync places idle agents in the pantry instantly", () => {
    const o = new Office([qa, dev]);
    for (const id of [qa.id, dev.id]) {
      expect(layout.places.find((p) => p.id === o.place(id))?.zone).toBe("pantry");
      expect(o.char(id)?.alpha).toBe(1);
      expect(o.char(id)?.moving).toBe(false);
    }
    expect(o.place(qa.id)).not.toBe(o.place(dev.id));
  });

  test("run.started: walks to its own desk and sits; tool categories change the look", () => {
    const o = new Office([qa, dev]);
    o.job(qa.id, "j1");
    o.start(qa.id, "r1", "j1");
    o.run(CATCH_UP_MS);
    const desk = o.world.deskOf(qa.id)!;
    expect(o.place(qa.id)).toBe(desk);
    expect(o.char(qa.id)).toMatchObject({ seated: true, moving: false, facing: "up" });

    o.emit({ type: "agent.thinking", payload: { summary: "reading the page" } }, { run_id: "r1", agent_id: qa.id });
    expect(o.char(qa.id)?.bubble).toBe("think");
    o.tool(qa.id, "r1", "code");
    expect(o.char(qa.id)).toMatchObject({ pose: "type", bubble: null });
    expect(o.world.screens().get(Number(desk.split("-")[1]))).toBe("code");
    o.tool(qa.id, "r1", "browser");
    expect(o.char(qa.id)?.bubble).toBe("browser");
    expect(o.world.screens().get(Number(desk.split("-")[1]))).toBe("browser");

    o.tool(qa.id, "r1", "search");
    o.run(CATCH_UP_MS);
    expect(layout.places.find((p) => p.id === o.place(qa.id))?.zone).toBe("library");
    expect(o.char(qa.id)).toMatchObject({ seated: false, bubble: "search" });
  });

  test("Marketing reads the brief at the file cabinets and pins drafts on the whiteboard", () => {
    const o = new Office([qa]);
    o.job(qa.id, "j1");
    o.start(qa.id, "r1", "j1");
    o.emit({ type: "agent.tool_call", payload: { call_id: "c1", tool: "read_brief", category: "read_docs", args: {} } }, { run_id: "r1", agent_id: qa.id });
    o.run(CATCH_UP_MS);
    expect(layout.places.find((p) => p.id === o.place(qa.id))?.zone).toBe("file_cabinets");
    expect(o.char(qa.id)?.bubble).toBe("book");
    o.emit({ type: "draft.created", payload: { draft_id: "d1", project_id: "p1", platform: "tiktok", kind: "caption" } }, { run_id: "r1", agent_id: qa.id });
    o.run(200);
    expect(o.char(qa.id)?.carrying).toBe(true);
    for (let t = 200; t < CATCH_UP_MS && o.char(qa.id)?.moving; t += 50) o.run(50);
    expect(layout.places.find((p) => p.id === o.place(qa.id))?.zone).toBe("whiteboard");
  });

  test("needs approval: hand up with a clickable alert, back to work when decided", () => {
    const o = new Office([qa]);
    o.job(qa.id, "j1");
    o.start(qa.id, "r1", "j1");
    o.tool(qa.id, "r1", "shell");
    o.run(CATCH_UP_MS);
    o.emit({ type: "agent.needs_approval", payload: { approval_id: "ap1", action: "run node -e", risk_level: "dangerous" } }, { run_id: "r1", agent_id: qa.id });
    expect(o.char(qa.id)).toMatchObject({ pose: "hand", bubble: "alert", needsApproval: true, seated: true });
    o.emit({ type: "approval.decided", payload: { approval_id: "ap1", decision: "approved", via: "web" } }, { run_id: "r1", agent_id: qa.id });
    expect(o.char(qa.id)).toMatchObject({ pose: "type", needsApproval: false });
  });

  test("run.finished: carries the file to the owner's desk, drops it, then goes to the pantry", () => {
    const o = new Office([qa]);
    o.job(qa.id, "j1");
    o.start(qa.id, "r1", "j1");
    o.run(CATCH_UP_MS);
    const trayBefore = o.world.trayCount();
    o.finish(qa.id, "r1", "j1");
    o.run(200);
    expect(o.char(qa.id)?.carrying).toBe(true);
    o.run(CATCH_UP_MS);
    expect(layout.places.find((p) => p.id === o.place(qa.id))?.zone).toBe("owner_desk");
    expect(o.char(qa.id)).toMatchObject({ carrying: false, bubble: "check" });
    expect(o.world.trayCount()).toBe(Math.min(3, trayBefore + 1));
    o.run(8000);
    expect(layout.places.find((p) => p.id === o.place(qa.id))?.zone).toBe("pantry");
    expect(o.world.screens().get(Number(o.world.deskOf(qa.id)!.split("-")[1]))).toBe("done");
  });

  test("run.failed: dizzy where it is, then the pantry", () => {
    const o = new Office([qa]);
    o.job(qa.id, "j1");
    o.start(qa.id, "r1", "j1");
    o.run(CATCH_UP_MS);
    o.emit(
      { type: "run.failed", payload: { run_id: "r1", job_id: "j1", error: "boom", tokens_in: 0, tokens_out: 0, cost_usd: 0, cost_unknown: false } },
      { run_id: "r1", agent_id: qa.id },
    );
    o.run(100);
    expect(o.char(qa.id)).toMatchObject({ effect: "dizzy", bubble: "fail", seated: true });
    o.run(10_000);
    expect(o.char(qa.id)?.effect).toBeNull();
    expect(layout.places.find((p) => p.id === o.place(qa.id))?.zone).toBe("pantry");
  });

  test("handoff: walks a document to the other agent's desk; a PR gets pinned on the notice board", () => {
    const o = new Office([qa, dev]);
    o.job(qa.id, "j1");
    o.start(qa.id, "r1", "j1");
    o.run(CATCH_UP_MS);
    o.emit({ type: "agent.handoff", payload: { from_agent: "qa-bot", to_agent: "dev-bot", new_job_id: "j2", reason: "fix" } }, { run_id: "r1", agent_id: qa.id });
    o.run(200);
    expect(o.char(qa.id)?.carrying).toBe(true);
    const visit = `visit-${o.world.deskOf(dev.id)}`;
    for (let t = 200; t < CATCH_UP_MS && !(o.place(qa.id) === visit && !o.char(qa.id)?.moving); t += 50) o.run(50);
    expect(o.place(qa.id)).toBe(visit);
    expect(o.char(qa.id)).toMatchObject({ moving: false, carrying: false, bubble: "chat" });
    o.run(3000);
    expect(o.place(qa.id)).toBe(o.world.deskOf(qa.id)); // back to work
    o.finish(qa.id, "r1", "j1");

    o.job(dev.id, "j2", "j1");
    o.start(dev.id, "r2", "j2");
    o.run(CATCH_UP_MS);
    o.emit({ type: "artifact.created", payload: { kind: "pr", title: "#1", url: "http://x" } }, { run_id: "r2", agent_id: dev.id });
    o.run(CATCH_UP_MS);
    expect(layout.places.find((p) => p.id === o.place(dev.id))?.zone).toBe("notice_board");
    expect(o.world.notesPinned()).toBe(1);
  });

  test("a handoff chain with both agents busy for a while meets in the meeting room", () => {
    const o = new Office([qa, dev]);
    o.job(qa.id, "j1");
    o.start(qa.id, "r1", "j1");
    o.job(dev.id, "j2", "j1");
    o.start(dev.id, "r2", "j2");
    o.run(1000);
    expect(o.place(qa.id)).toBe(o.world.deskOf(qa.id)); // debounced: not for a blip
    o.run(3000 + CATCH_UP_MS);
    for (const id of [qa.id, dev.id]) expect(layout.places.find((p) => p.id === o.place(id))?.zone).toBe("meeting_room");
  });

  test("budget exceeded or disabled: walks out and disappears; comes back when enabled", () => {
    const o = new Office([qa, dev]);
    o.emit({ type: "budget.exceeded", payload: { agent_id: qa.id, used: 10, budget: 5 } });
    o.run(CATCH_UP_MS + 1000);
    expect(o.char(qa.id)).toBeUndefined();
    o.agents = [qa, { ...dev, enabled: false }];
    o.world.sync(o.state, o.agents);
    o.run(CATCH_UP_MS + 1000);
    expect(o.char(dev.id)).toBeUndefined();
    o.agents = [qa, dev];
    o.world.sync(o.state, o.agents);
    o.run(100);
    expect(o.char(dev.id)?.alpha).toBeGreaterThan(0);
  });

  test("runner offline: lamp red, rack red, desk screens dark", () => {
    const o = new Office([qa]);
    o.job(qa.id, "j1");
    o.start(qa.id, "r1", "j1");
    o.tool(qa.id, "r1", "code");
    expect(o.world.lamp()).toBe("ok");
    o.emit({ type: "runner.offline", payload: { runner_id: "rn1", name: "main-pc" } });
    expect(o.world.lamp()).toBe("bad");
    expect(o.world.racks()).toEqual(["error"]);
    expect(o.world.screens().get(Number(o.world.deskOf(qa.id)!.split("-")[1]))).toBe("off");
  });

  test("many idle agents get distinct pantry places; extra searchers spill over without sharing", () => {
    const team = Array.from({ length: 9 }, (_, i) => agent(`a${i}`, `bot-${i}`));
    const o = new Office(team);
    o.run(CATCH_UP_MS);
    const spots = team.map((a) => o.place(a.id));
    expect(new Set(spots).size).toBe(team.length);
    for (const s of spots) expect(layout.places.find((p) => p.id === s)?.zone).toBe("pantry");
    // more agents than desks: the 9th has no desk and works in the meeting room
    expect(o.world.deskOf("a8")).toBeNull();
  });

  test("desk_x/desk_y pick the nearest desk", () => {
    const desks = layout.places.filter((p) => p.kind === "desk");
    const last = desks[desks.length - 1]!;
    const map = assignDesks([agent("a", "a"), agent("b", "b", "default", { desk_x: last.tx, desk_y: last.ty })], layout);
    expect(map.get("b")).toBe(last.id);
    expect(map.get("a")).toBe(desks[0]!.id);
  });
});

describe("catch-up", () => {
  test("after any burst of events, every character reaches its latest plan's first step within 2 s", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const team = [qa, dev, agent("a_3", "ops-bot", "guard")];
    for (let round = 0; round < 25; round++) {
      const o = new Office(team);
      const runs: Record<string, string | null> = {};
      let n = 0;
      // a burst: 5-30 events, 0-60 ms apart
      const burst = 5 + Math.floor(rnd() * 25);
      for (let i = 0; i < burst; i++) {
        const a = team[Math.floor(rnd() * team.length)]!;
        const r = runs[a.id];
        const pick = rnd();
        if (!r) {
          const j = `j${round}-${n}`;
          const run = `r${round}-${n++}`;
          o.job(a.id, j);
          o.start(a.id, run, j);
          runs[a.id] = run;
        } else if (pick < 0.3) {
          o.tool(a.id, r, (["code", "browser", "search", "read_docs", "meeting", "git"] as const)[Math.floor(rnd() * 6)]!);
        } else if (pick < 0.45) {
          o.emit({ type: "agent.thinking", payload: { summary: "hmm" } }, { run_id: r, agent_id: a.id });
        } else if (pick < 0.6) {
          o.emit({ type: "agent.handoff", payload: { from_agent: a.slug, to_agent: team[(team.indexOf(a) + 1) % team.length]!.slug, new_job_id: "x", reason: "r" } }, { run_id: r, agent_id: a.id });
        } else if (pick < 0.7) {
          o.emit({ type: "artifact.created", payload: { kind: "pr", title: "#1" } }, { run_id: r, agent_id: a.id });
        } else if (pick < 0.85) {
          o.finish(a.id, r, o.state.runs[r]!.job_id);
          runs[a.id] = null;
        } else {
          o.emit(
            { type: "run.failed", payload: { run_id: r, job_id: o.state.runs[r]!.job_id, error: "x", tokens_in: 0, tokens_out: 0, cost_usd: 0, cost_unknown: false } },
            { run_id: r, agent_id: a.id },
          );
          runs[a.id] = null;
        }
        o.run(Math.floor(rnd() * 60), 10);
      }
      o.run(CATCH_UP_MS, 20);
      for (const a of team) {
        const d = o.world.debug(a.id);
        if (!d) continue;
        expect(d.firstArrivedAt).not.toBeNull();
        expect(d.firstArrivedAt! - d.planAt).toBeLessThanOrEqual(CATCH_UP_MS);
      }
    }
  });
});

describe("reactions table", () => {
  test("covers every event type", () => {
    expect(Object.keys(REACTIONS).sort()).toEqual([...EVENT_TYPES].sort());
  });

  test("every listed reaction changes what the office shows", () => {
    const look = (o: Office) =>
      JSON.stringify({
        c: o.world.characters().map((c) => [c.id, Math.round(c.x), Math.round(c.y), c.pose, c.bubble, c.seated, c.carrying, c.effect]),
        s: [...o.world.screens()],
        r: o.world.racks(),
        l: o.world.lamp(),
        t: o.world.trayCount(),
        n: o.world.notesPinned(),
      });
    /** Build a state, settle, fire one event, check the picture changed within the catch-up window. */
    const check = (type: string, setup: (o: Office) => void, fire: (o: Office) => void) => {
      const o = new Office([qa, dev]);
      setup(o);
      o.run(12_000);
      const before = look(o);
      fire(o);
      o.run(CATCH_UP_MS);
      expect([type, look(o) !== before]).toEqual([type, true]);
    };
    const working = (o: Office) => {
      o.job(qa.id, "j1");
      o.start(qa.id, "r1", "j1");
    };
    const meta = { run_id: "r1", agent_id: qa.id };
    const cases: Record<string, [(o: Office) => void, (o: Office) => void]> = {
      "runner.online": [(o) => o.emit({ type: "runner.offline", payload: { runner_id: "rn1", name: "main-pc" } }), (o) => o.emit({ type: "runner.online", payload: { runner_id: "rn1", name: "main-pc" } })],
      "runner.offline": [working, (o) => o.emit({ type: "runner.offline", payload: { runner_id: "rn1", name: "main-pc" } })],
      "system.paused": [() => {}, (o) => o.emit({ type: "system.paused", payload: { paused: true } })],
      "job.created": [() => {}, (o) => o.job(qa.id, "j1")],
      "job.queued": [
        (o) => {
          o.job(qa.id, "j1");
          o.emit({ type: "job.cancelled", payload: { job_id: "j1" } });
        },
        (o) => o.emit({ type: "job.queued", payload: { job_id: "j1" } }),
      ],
      "job.cancelled": [(o) => o.job(qa.id, "j1"), (o) => o.emit({ type: "job.cancelled", payload: { job_id: "j1" } })],
      "run.started": [(o) => o.job(qa.id, "j1"), (o) => o.start(qa.id, "r1", "j1")],
      "run.finished": [working, (o) => o.finish(qa.id, "r1", "j1")],
      "run.failed": [
        working,
        (o) => o.emit({ type: "run.failed", payload: { run_id: "r1", job_id: "j1", error: "x", tokens_in: 0, tokens_out: 0, cost_usd: 0, cost_unknown: false } }, meta),
      ],
      "agent.thinking": [working, (o) => o.emit({ type: "agent.thinking", payload: { summary: "hmm" } }, meta)],
      "agent.message": [
        (o) => {
          working(o);
          o.emit({ type: "agent.thinking", payload: { summary: "hmm" } }, meta);
        },
        (o) => o.emit({ type: "agent.message", payload: { message_id: "m", text: "hi", final: false } }, meta),
      ],
      "agent.tool_call": [working, (o) => o.tool(qa.id, "r1", "code")],
      "agent.needs_approval": [working, (o) => o.emit({ type: "agent.needs_approval", payload: { approval_id: "ap", action: "x", risk_level: "review" } }, meta)],
      "approval.decided": [
        (o) => {
          working(o);
          o.emit({ type: "agent.needs_approval", payload: { approval_id: "ap", action: "x", risk_level: "review" } }, meta);
        },
        (o) => o.emit({ type: "approval.decided", payload: { approval_id: "ap", decision: "rejected", via: "web" } }, meta),
      ],
      "agent.handoff": [working, (o) => o.emit({ type: "agent.handoff", payload: { from_agent: "qa-bot", to_agent: "dev-bot", new_job_id: "j2", reason: "r" } }, meta)],
      "artifact.created": [working, (o) => o.emit({ type: "artifact.created", payload: { kind: "pr", title: "#1" } }, meta)],
      "feature.released": [working, (o) => o.emit({ type: "feature.released", payload: { project_id: "p1", feature_log_id: "f1" } }, meta)],
      "draft.created": [working, (o) => o.emit({ type: "draft.created", payload: { draft_id: "d1", project_id: "p1", platform: "instagram", kind: "caption" } }, meta)],
      "budget.exceeded": [() => {}, (o) => o.emit({ type: "budget.exceeded", payload: { agent_id: qa.id, used: 2, budget: 1 } })],
      "agent.idle": [working, (o) => o.emit({ type: "agent.idle", payload: { agent_id: qa.id } })],
    };
    for (const [type, reaction] of Object.entries(REACTIONS)) {
      if (reaction === null) continue;
      const c = cases[type];
      expect([type, !!c]).toEqual([type, true]);
      check(type, c![0], c![1]);
    }
  });
});
