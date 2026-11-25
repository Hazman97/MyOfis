import type { AgentInput, ScheduleInput } from "@agent-office/shared";
import { coderAgent } from "./coder.ts";
import { echoAgent } from "./echo.ts";
import { englishCoachAgent } from "./englishCoach.ts";
import { researcherAgent } from "./researcher.ts";
import { publisherAgent } from "./publisher.ts";
import { MOTION_TEXT_TIKTOK_SKILL, SHORT_VIDEO_EDITING_SKILL, editorAgent, editorUpgrade } from "./editor.ts";
import { ketuaAgent, ketuaSchedule } from "./ketua.ts";
import { openchatcutAgent, openchatcutUpgrade } from "./openchatcutEditor.ts";
import { TIKTOK_CAPTIONS_SKILL, tiktokAgent, tiktokSchedule, tiktokUpgrade } from "./tiktok.ts";
import { tiktokPosterAgent, tiktokPosterUpgrade } from "./tiktokPoster.ts";
import { projectAssistantAgent, projectAssistantSchedule } from "./projectAssistant.ts";
import { keraniAgent, keraniSchedule } from "./kerani.ts";
import { notulisAgent } from "./notulis.ts";
import { CLIP_FACTORY_PLAYBOOK_SKILL, CLIP_FACTORY_PROMPT, clipFactoryAgent } from "./clipFactory.ts";
import { cikguTechAgent, techExplainerBmSkill } from "./explainer.ts";
import { marketingAgent, marketingSchedule } from "./marketing.ts";
import { pakGuardAgent, pakGuardSchedule } from "./pakGuard.ts";
import { testerAgent, testerSchedule } from "./tester.ts";
import {
  SOCIAL_CAPTIONS_MULTI_SKILL,
  SOCIAL_MANAGER_PROMPT,
  socialManagerAgent,
  socialManagerSchedule,
} from "./socialManager.ts";

export { echoAgent, ECHO_SYSTEM_PROMPT } from "./echo.ts";
export { pakGuardAgent, PAK_GUARD_PROMPT } from "./pakGuard.ts";
export { testerAgent, TESTER_PROMPT } from "./tester.ts";
export { coderAgent, CODER_PROMPT, FEATURE_NOTE_PROMPT } from "./coder.ts";
export { marketingAgent, MARKETING_PROMPT } from "./marketing.ts";
export { englishCoachAgent, ENGLISH_COACH_PROMPT } from "./englishCoach.ts";
export { researcherAgent, RESEARCHER_PROMPT } from "./researcher.ts";
export { publisherAgent, PUBLISHER_PROMPT } from "./publisher.ts";
export { editorAgent, EDITOR_PROMPT, MOTION_TEXT_TIKTOK_SKILL, SHORT_VIDEO_EDITING_SKILL } from "./editor.ts";
export { ketuaAgent, ketuaSchedule, KETUA_PROMPT } from "./ketua.ts";
export { projectAssistantAgent, projectAssistantSchedule, PROJECT_ASSISTANT_PROMPT } from "./projectAssistant.ts";
export { keraniAgent, keraniSchedule, KERANI_PROMPT } from "./kerani.ts";
export { openchatcutAgent, OPENCHATCUT_PROMPT } from "./openchatcutEditor.ts";
export { tiktokAgent, tiktokSchedule, TIKTOK_PROMPT, TIKTOK_CAPTIONS_SKILL } from "./tiktok.ts";
export { tiktokPosterAgent, TIKTOK_POSTER_PROMPT } from "./tiktokPoster.ts";
export { notulisAgent, NOTULIS_PROMPT } from "./notulis.ts";
export { clipFactoryAgent, CLIP_FACTORY_PROMPT, CLIP_FACTORY_PLAYBOOK_SKILL } from "./clipFactory.ts";
export { cikguTechAgent, techExplainerBmSkill } from "./explainer.ts";
export {
  socialManagerAgent,
  socialManagerSchedule,
  SOCIAL_MANAGER_PROMPT,
  SOCIAL_CAPTIONS_MULTI_SKILL,
} from "./socialManager.ts";

export interface BuiltinAgent {
  agent: AgentInput;
  /** Whether it needs a real LLM (seeded onto the first configured real provider). */
  needsLlm: boolean;
  /** Schedules created together with the agent (seeded disabled; the owner turns them on). */
  schedules?: (agentId: string) => ScheduleInput[];
  /** For an agent seeded earlier: tools/skills added once (the owner may remove them later), and older
   *  built-in prompts that are replaced by the current one (an edited prompt is never touched). */
  upgrade?: { tools?: string[]; skills?: string[]; previousPrompts?: string[] };
}

export const BEAT_MONTAGE_BM_SKILL = `---
name: beat-montage-bm
description: Cara buat montaj ikut beat muzik (cut setiap 1/2/4 beat, teks 5-9 patah perkataan bertukar ikut bar, hook awal, dan loop lancar).
---

# Beat-Sync Montage (Bahasa Malaysia)

## 1. Pilih \`cut_every\` ikut kelajuan lagu
- Lagu laju (>= 130 BPM): guna \`cut_every: 2\` (atau \`4\`) supaya penonton sempat nampak klip dan jumlah klip kekal <= 80.
- Lagu sederhana (90–125 BPM): guna \`cut_every: 1\` untuk rasa bertenaga, atau \`2\` untuk suasana tenang.

## 2. Tulis baris teks (5–9 patah perkataan)
- Tulis 1 \`hook\` pembukaan (0 hingga bar pertama) yang terus tarik perhatian sebelum orang scroll.
- Tulis 4–8 baris pendek Bahasa Malaysia (5–9 patah perkataan setiap satu). Setiap baris bertukar tepat pada permulaan bar.

## 3. Aliran kerja wajib
1. \`clip_library(action: "pick")\` untuk pilih 3–6 klip yang sesuai dengan tema.
2. \`music_beats(track: "...")\` untuk kesan BPM, beat, dan bar.
3. \`montage_plan(track, target_seconds, cut_every, hook, lines, loop: true)\` untuk bina \`edit_plan\`.
4. Semak \`edit_plan\`, kemudian \`video_edit\` -> \`video_review\` -> \`save_draft\`.
`;

/** SKILL.md files seeded once into the skills folder (the owner may edit or delete them). */
export const BUILTIN_SKILLS: { name: string; content: string }[] = [
  { name: "short-video-editing", content: SHORT_VIDEO_EDITING_SKILL },
  { name: "tiktok-captions-bm", content: TIKTOK_CAPTIONS_SKILL },
  { name: "motion-text-tiktok", content: MOTION_TEXT_TIKTOK_SKILL },
  { name: "clip-factory-playbook", content: CLIP_FACTORY_PLAYBOOK_SKILL },
  { name: "tech-explainer-bm", content: techExplainerBmSkill.content },
  { name: "beat-montage-bm", content: BEAT_MONTAGE_BM_SKILL },
  { name: "social-captions-multi", content: SOCIAL_CAPTIONS_MULTI_SKILL },
];

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
  { agent: editorAgent, needsLlm: true, upgrade: editorUpgrade },
  { agent: ketuaAgent, needsLlm: true, schedules: (id) => [ketuaSchedule(id)] },
  { agent: projectAssistantAgent, needsLlm: true, schedules: (id) => [projectAssistantSchedule(id)] },
  { agent: openchatcutAgent, needsLlm: true, upgrade: openchatcutUpgrade },
  { agent: tiktokAgent, needsLlm: true, schedules: (id) => [tiktokSchedule(id)], upgrade: tiktokUpgrade },
  { agent: tiktokPosterAgent, needsLlm: true, upgrade: tiktokPosterUpgrade },
  clipFactoryAgent,
  { agent: cikguTechAgent, needsLlm: true },
  { agent: notulisAgent, needsLlm: true },
  { agent: socialManagerAgent, needsLlm: true, schedules: (id) => [socialManagerSchedule(id)] },
];
