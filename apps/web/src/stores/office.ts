import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";
import { apply, dayKey, initialState, type Agent, type AgentEvent, type OfficeState } from "@agent-office/shared";
import { api } from "../api/http.ts";
import { connectEventStream } from "../api/ws.ts";

const MAX_CACHED_EVENTS_PER_RUN = 2000;

/**
 * Single source of UI truth: the hub's OfficeState, kept current by applying
 * the same shared reducer to live events.
 */
export const useOffice = defineStore("office", () => {
  const state = reactive<OfficeState>(initialState());
  const connected = ref(false);
  const ready = ref(false);
  const agents = ref<Agent[]>([]);
  /** Per-run event timelines (loaded on demand, then kept live). */
  const runEvents = reactive<Record<string, AgentEvent[]>>({});
  let disconnect: (() => void) | null = null;

  const agentById = computed(() => Object.fromEntries(agents.value.map((a) => [a.id, a])));
  const costToday = computed(() => state.cost_by_day[dayKey(new Date().toISOString())] ?? 0);
  const jobsNewestFirst = computed(() =>
    Object.values(state.jobs).sort((a, b) => b.created_at.localeCompare(a.created_at)),
  );

  function onEvents(events: AgentEvent[]) {
    for (const e of events) {
      if (!apply(state, e)) continue;
      if (e.run_id && runEvents[e.run_id]) {
        const list = runEvents[e.run_id]!;
        list.push(e);
        if (list.length > MAX_CACHED_EVENTS_PER_RUN) list.splice(0, list.length - MAX_CACHED_EVENTS_PER_RUN);
      }
    }
  }

  function start(onUnauthorized: () => void) {
    if (disconnect) return;
    loadAgents().catch(() => {}); // 401 is handled globally
    disconnect = connectEventStream(() => state.last_event_id, {
      snapshot(s) {
        Object.assign(state, s);
        ready.value = true;
      },
      events(evts) {
        onEvents(evts);
        ready.value = true;
      },
      status(c) {
        connected.value = c;
      },
      unauthorized: onUnauthorized,
    });
  }

  function stop() {
    disconnect?.();
    disconnect = null;
    Object.assign(state, initialState());
    ready.value = false;
  }

  async function loadAgents() {
    agents.value = (await api.agents()).agents;
  }

  async function loadRun(runId: string) {
    const { run, events } = await api.run(runId);
    // Merge with anything that arrived live while loading.
    const live = runEvents[runId] ?? [];
    const seen = new Set(events.map((e) => e.id));
    runEvents[runId] = [...events, ...live.filter((e) => !seen.has(e.id))].sort((a, b) => a.id - b.id);
    return run;
  }

  return { state, connected, ready, agents, agentById, costToday, jobsNewestFirst, runEvents, start, stop, loadAgents, loadRun };
});
