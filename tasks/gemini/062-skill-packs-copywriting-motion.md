# 062: Skill packs — samber/cc-skills + motion design skills in Skills → Browse, BM caption skills

Owner (2026-11-27): add these to our system: https://github.com/samber/cc-skills (MIT) and
https://github.com/frankxai/awesome-motion-design-agent-skills (CC0). Use what fits our agents; make Bahasa Melayu
versions of the caption skills.

Read first: `tasks/gemini/SUPERVISOR.md`, CLAUDE.md "Skills → Browse" (`apps/hub/src/skillCatalog.ts`), "Skills per
agent", `BUILTIN_SKILLS` + `BuiltinAgent.upgrade.skills` (`packages/agents/src/index.ts`, seed rules from 032 fixes).

## Part A — Catalog sources
- Add to `skillCatalog.ts` sources: `samber/cc-skills` (roots `skills/`, MIT) and
  `frankxai/awesome-motion-design-agent-skills` (roots `skills/`, CC0-1.0). Check each repo's default branch and
  licence file at build time; show them in Browse with their licence.
- These skills reference **other files in their folder** (`references/*.md`) and Claude Code tools in
  `allowed-tools`. Our install copies only SKILL.md today: extend install to copy the skill folder's other `.md`
  files (≤ 20 files, ≤ 200 KB total, Markdown only; no scripts, no binaries) under `skills/<name>/`, and make
  `skill_view` able to open `skills/<name>/<file>.md` by name (path-safe; only files inside that skill folder).
  Ignore `allowed-tools` (our tools differ); show a note in Browse.
- Install warnings as today (download/delete commands). Owner approval as today.

## Part B — Install and assign (built-in, once, owner can remove)
Through the seed upgrade path (`seeded.skill.<agent>.<skill>`), install from a pinned copy saved in
`packages/agents/skills-vendor/<repo>/<skill>/` (copied at a fixed commit, write the commit SHA + licence in
`skills-vendor/README.md`), never fetched at runtime:
| Skill | Agents |
|---|---|
| `copywriting-hooks`, `copywriting-cta`, `copywriting-prose-creator` | Marketing, Pengurus Sosial (EN posts / website articles only) |
| `copywriting-tone-of-voice-creator` | Marketing (use with the existing `style_guide` flow) |
| `humanizer-en-asd-ste100` | Marketing, Publisher |
| `deep-research` | Researcher |
| `influence-and-negotiation` | smashpoint-wa (060) when it exists, else skip |
| `press-release-writer`, `linkedin-ghostwriting` | Pengurus Sosial (LinkedIn arrives in 056) |
| `remotion-video-agent`, `motion-director` | the Motion agent of 061 (skip if 061 not done; add later via upgrade) |
Do not install the engineering ones (promql, crxjs, chrome-extension, conventional-git…) for agents.

## Part C — BM caption skills (our own, built-in)
Write two new built-in skills, in our style, using the method of samber's hooks/CTA skills (credit them in the
frontmatter `metadata.based_on` with the licence):
- `hook-caption-bm`: hooks for **short social posts** (TikTok/Reels/IG/FB/Threads) in BM + Manglish. The five
  levers (gap, prediction break, scene, payoff, borrowed weight) with Malaysian examples (SmashPoint court, sewa
  kamera, kahwin/raya moments, food), the first 1–2 lines must work before "lagi…/see more", banned openers ("Hai
  semua", "Korang tahu tak" overused, clickbait lies), length rules per platform. 12 good/bad example pairs.
- `cta-bm`: CTAs that match the goal (book slot, DM, link in bio, save/share, comment keyword), one CTA per post,
  soft vs direct, WhatsApp/booking phrasing, never fake urgency. 10 example pairs.
Assign both to Pengurus Sosial, TikTok Poster, Misi 1K, Marketing, Publisher. Prompt upgrades only when unedited:
"for BM captions open `hook-caption-bm` and `cta-bm`".

## Part D — For Gemini itself
Use `web-motion-auditor` (read it from the vendored copy) when you polish UI with motion in later tasks (office,
Quick Post, previews): reduced-motion path, no gratuitous animation. Mention in `SUPERVISOR.md` under UI rules
(Claude edits on review).

## Tests
Catalog parses both repos from a fake GitHub tree; multi-file install copies only allowed `.md` files and refuses
`..`/scripts/oversize; `skill_view` opens a reference file inside the folder and refuses outside paths; seed adds
the skills once to the listed agents and respects removal; the two BM skills parse (frontmatter, name, description)
and are listed for the assigned agents only.

## Proof
Raw new tests, `bun run typecheck`, full `bun test`, web build final lines; screenshot of Skills → Browse with the
two new sources. Anything not run is NOT RUN. Do not commit.
