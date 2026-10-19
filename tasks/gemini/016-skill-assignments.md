# Task 016: assign skills to agents (Skills page)

Until now every agent with the `skill_view` tool saw every skill in the library. The owner wants to choose:
- which agents get which skill;
- one-tap **All** buttons, so it stays easy.

Claude built the back end; you build the UI.

## How it works (already in the code; do not change it)
- **`AgentConfig.skills`** is either `"all"` (every skill, including new ones) or a list of skill names. Agents only see their skills.
- **Read the state:** `api.skillAssignments()` → `{ skills: string[], agents: { id, slug, name, sprite, enabled, skills: "all" | string[], reads_skills }[] }` (agents of the current room). `reads_skills` = the agent has the `skill_view` tool.
- **Per skill:** `api.setSkillAgents(skillName, agentIds)` sets exactly which agents get that skill.
  - Agents on "all" that you leave out switch to a list without it.
  - Every agent you include also gets the skill tools.
- **Per agent:** `api.setAgentSkills(agentId, "all" | string[])`.
- **Reload** with `api.skillAssignments()` after each change. Owner only: members get 403, so hide the controls for them (`isOwner` from `apps/web/src/me.ts`).

## Scope: edit ONLY
- `apps/web/src/views/SkillsView.vue`: add the controls; keep everything else (import, catalog, proposals, usage, memory switch).
- New `apps/web/src/components/SkillAgents.vue` (per-skill assignment).
- New `apps/web/src/components/AgentSkillsMatrix.vue` (per-agent view).

Never delete, rename or move files. No new packages. Do not run `git commit`. Do not edit `api/http.ts`, `packages/` or `apps/hub/`.

## What to build
1. **SkillAgents** (inside each skill card on the Skills page):
   - **"Used by":** one chip per agent with its `AgentAvatar` and name.
     - Filled = the agent gets this skill (`skills === "all"` or it includes the name).
     - Tap to toggle. This calls `setSkillAgents` with the new full list of agent ids.
   - **Buttons:** **All agents** (every agent id) and **None** (empty list).
   - **Small marks:** "all skills" on agents that get everything; a muted "can't read skills yet" on agents with `reads_skills: false`. They get the tools when assigned.
   - Disabled agents are dimmed but can still be assigned.
2. **AgentSkillsMatrix** (a section "Skills per agent" on the Skills page, collapsible):
   - one row per agent: avatar, name, and a segmented control **All skills / Choose**;
   - **Choose** shows checkboxes for every skill;
   - "All skills" calls `setAgentSkills(id, "all")`; checkbox changes call `setAgentSkills(id, [...names])`.
   - **Desktop:** a compact matrix (agents × skills) with checkboxes is welcome, sticky first column. On a phone, use one row per agent with chips instead; no horizontal page scroll.
3. **Saving:** optimistic toggles with a small spinner, and an error message if the call fails (then reload).
4. **Phone (390 px):** tap targets ≥ 40 px.

## Rules
- Use the design system in `apps/web/src/style.css` (tokens; `card`, `btn`, `chip`, `label`, `input`, `sign`), light and dark. English UI text.

## Check before you hand back
- `bun run --cwd apps/web typecheck` and `bun run --cwd apps/web build` pass.
- Open `/skills` at desktop width and 390 px, light and dark:
  - assign a skill to one agent;
  - press All agents, then None;
  - set an agent to All skills, then Choose.
- Tell the owner you are done; Claude reviews the diff.
