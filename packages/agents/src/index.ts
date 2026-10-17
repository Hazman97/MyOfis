import type { AgentInput, ScheduleInput } from "@agent-office/shared";
import { coderAgent } from "./coder.ts";
import { echoAgent } from "./echo.ts";
import { englishCoachAgent } from "./englishCoach.ts";
import { researcherAgent } from "./researcher.ts";
import { publisherAgent } from "./publisher.ts";
import { editorAgent } from "./editor.ts";
import { ketuaAgent } from "./ketua.ts";
import { keraniAgent, keraniSchedule } from "./kerani.ts";
import { marketingAgent, marketingSchedule } from "./marketing.ts";
import { pakGuardAgent, pakGuardSchedule } from "./pakGuard.ts";
import { testerAgent, testerSchedule } from "./tester.ts";

export { echoAgent, ECHO_SYSTEM_PROMPT } from "./echo.ts";
export { pakGuardAgent, PAK_GUARD_PROMPT } from "./pakGuard.ts";
export { testerAgent, TESTER_PROMPT } from "./tester.ts";
export { coderAgent, CODER_PROMPT, FEATURE_NOTE_PROMPT } from "./coder.ts";
export { marketingAgent, MARKETING_PROMPT } from "./marketing.ts";
export { englishCoachAgent, ENGLISH_COACH_PROMPT } from "./englishCoach.ts";
export { researcherAgent, RESEARCHER_PROMPT } from "./researcher.ts";
export { publisherAgent, PUBLISHER_PROMPT } from "./publisher.ts";
export { editorAgent, EDITOR_PROMPT } from "./editor.ts";
export { ketuaAgent, KETUA_PROMPT } from "./ketua.ts";
export { keraniAgent, keraniSchedule, KERANI_PROMPT } from "./kerani.ts";

export interface BuiltinAgent {
  agent: AgentInput;
  /** Whether it needs a real LLM (seeded onto the first configured real provider). */
  needsLlm: boolean;
  /** Schedules created together with the agent (seeded disabled; the owner turns them on). */
  schedules?: (agentId: string) => ScheduleInput[];
}

/** Seeded on first boot by slug; never overwrites owner edits. */
export const BUILTIN_AGENTS: BuiltinAgent[] = [
  { agent: echoAgent, needsLlm: false },
  { agent: pakGuardAgent, needsLlm: true, schedules: (id) => [pakGuardSchedule(id)] },
  { agent: testerAgent, needsLlm: true, schedules: (id) => [testerSchedule(id)] },
  { agent: coderAgent, needsLlm: true },
  { agent: marketingAgent, needsLlm: true, schedules: (id) => [marketingSchedule(id)] },
  { agent: englishCoachAgent, needsLlm: true },
  { agent: researcherAgent, needsLlm: true },
  { agent: publisherAgent, needsLlm: true },
  { agent: keraniAgent, needsLlm: true, schedules: (id) => [keraniSchedule(id)] },
  { agent: editorAgent, needsLlm: true },
  { agent: ketuaAgent, needsLlm: true },
];
