<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import type { AgentEvent } from "@agent-office/shared";
import { fmtTime } from "../format.ts";

const props = defineProps<{ events: AgentEvent[] }>();

interface Row {
  id: number;
  ts: string;
  kind: string;
  text: string;
  tone: "text" | "tool" | "good" | "bad" | "quiet" | "ask";
  /** External URL (opens in a new tab) or an in-app path. */
  href?: string;
}

/** Collapse streamed message chunks into one row per message so the log stays readable. */
const rows = computed<Row[]>(() => {
  const out: Row[] = [];
  const msgRow = new Map<string, Row>();
  for (const e of props.events) {
    switch (e.type) {
      case "agent.message": {
        const existing = msgRow.get(e.payload.message_id);
        if (existing) existing.text += e.payload.text;
        else if (e.payload.text.trim()) {
          const row: Row = { id: e.id, ts: e.ts, kind: "says", text: e.payload.text, tone: "text" };
          msgRow.set(e.payload.message_id, row);
          out.push(row);
        }
        break;
      }
      case "agent.thinking":
        out.push({ id: e.id, ts: e.ts, kind: "thinking", text: e.payload.summary, tone: "quiet" });
        break;
      case "agent.tool_call":
        out.push({ id: e.id, ts: e.ts, kind: e.payload.category, text: `${e.payload.tool} ${JSON.stringify(e.payload.args)}`, tone: "tool" });
        break;
      case "agent.tool_result":
        out.push({ id: e.id, ts: e.ts, kind: e.payload.ok ? "ok" : "error", text: e.payload.summary, tone: e.payload.ok ? "quiet" : "bad" });
        break;
      case "agent.needs_approval":
        out.push({ id: e.id, ts: e.ts, kind: `asks · ${e.payload.risk_level}`, text: e.payload.action, tone: "ask" });
        break;
      case "approval.decided":
        out.push({ id: e.id, ts: e.ts, kind: e.payload.decision, text: `by owner via ${e.payload.via}`, tone: e.payload.decision === "approved" ? "good" : "bad" });
        break;
      case "agent.handoff":
        out.push({ id: e.id, ts: e.ts, kind: "handoff", text: `${e.payload.from_agent} → ${e.payload.to_agent}: ${e.payload.reason}`, tone: "good", href: `/jobs/${e.payload.new_job_id}` });
        break;
      case "artifact.created":
        out.push({ id: e.id, ts: e.ts, kind: e.payload.kind, text: e.payload.title ?? e.payload.path ?? e.payload.url ?? "", tone: "good", href: e.payload.url });
        break;
      case "run.started":
        out.push({ id: e.id, ts: e.ts, kind: "started", text: `on runner ${e.payload.runner_id}`, tone: "quiet" });
        break;
      case "run.finished":
        out.push({
          id: e.id,
          ts: e.ts,
          kind: e.payload.status === "done" ? "finished" : "cancelled",
          text: `${e.payload.tokens_in} in / ${e.payload.tokens_out} out tokens · $${e.payload.cost_usd.toFixed(4)}`,
          tone: e.payload.status === "done" ? "good" : "quiet",
        });
        break;
      case "run.failed":
        out.push({ id: e.id, ts: e.ts, kind: "failed", text: e.payload.error, tone: "bad" });
        break;
      default:
        out.push({ id: e.id, ts: e.ts, kind: e.type, text: JSON.stringify(e.payload), tone: "quiet" });
    }
  }
  return out;
});

const textClass: Record<Row["tone"], string> = {
  text: "font-sans text-[13px] leading-relaxed text-fg",
  tool: "font-mono text-fg",
  good: "font-mono text-accent",
  bad: "font-mono text-danger",
  quiet: "font-mono text-muted",
  ask: "font-mono font-medium text-signal",
};
const kindClass: Record<Row["tone"], string> = {
  text: "text-fg",
  tool: "text-info",
  good: "text-accent",
  bad: "text-danger",
  quiet: "text-faint",
  ask: "text-signal",
};
</script>

<template>
  <ol class="divide-y divide-line text-xs">
    <li v-for="r in rows" :key="r.id" class="grid grid-cols-[4.25rem_6rem_minmax(0,1fr)] items-baseline gap-2 px-4 py-2 max-sm:grid-cols-[4.25rem_minmax(0,1fr)]">
      <span class="font-mono text-faint tabular-nums">{{ fmtTime(r.ts) }}</span>
      <span class="truncate font-mono max-sm:hidden" :class="kindClass[r.tone]">{{ r.kind }}</span>
      <a v-if="r.href && /^https?:/.test(r.href)" :href="r.href" target="_blank" rel="noopener noreferrer" class="wrap-break-word underline" :class="textClass[r.tone]">{{ r.text }}</a>
      <RouterLink v-else-if="r.href" :to="r.href" class="wrap-break-word underline" :class="textClass[r.tone]">{{ r.text }}</RouterLink>
      <span v-else class="wrap-break-word whitespace-pre-wrap" :class="textClass[r.tone]">{{ r.text }}</span>
    </li>
    <li v-if="!rows.length" class="px-4 py-6 text-center text-faint">No events yet</li>
  </ol>
</template>
