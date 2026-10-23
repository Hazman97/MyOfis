# How Gemini works with Claude as supervisor (from 2026-10-23)

The owner's choice: **Gemini does all the work** (logic, tests, UI, docs); **Claude only plans and reviews**.
Claude's time is limited, so every task must come back with its own proof.

## The loop
1. **Claude writes the task** `tasks/gemini/NNN-short-name.md`: the goal, the files, the facts from the code, and
   the checks. UI-only tasks use `TEMPLATE.md`; tasks that change logic use the rules below as well.
2. **The owner gives Gemini** the short prompt at the bottom of the task.
3. **Gemini does it** and writes `tasks/gemini/NNN-report.md` (format below). Gemini never commits.
4. **The owner says "semak NNN"**. Claude reads the report, the diff and the tests, re-runs them, and either
   commits + pushes or writes the fixes into the report under "Review".

## Rules for tasks that change logic
- Read `CLAUDE.md` and the files the task names before writing code. Follow the code around you: the same naming,
  comments, error style, and helpers (do not add a second helper that does what an existing one does).
- **Pure logic goes in pure functions with tests** (`packages/shared/src/*.ts` + `packages/shared/test/*.test.ts`,
  or the module's own `test/`). The hub and runner only wire them.
- Every new route or runner action is **guarded the same way as its neighbours** (owner/member scope, run checks,
  tool checks). Say in the report which guard you used.
- **No new packages**, no migrations, no Docker, no changes to auth, unless the task says so.
- Never print or log secrets (`.env`, tokens, keys). Never touch the owner's real database or `data/`.
- Do not stop or restart the owner's hub, runner, OpenChatCut or anything you did not start.
- Never delete or move files you did not create. Do not run `git commit`, `git push`, `git reset` or `git checkout --`.

## The report (`tasks/gemini/NNN-report.md`)
```
# NNN report
## Changed files
- path: one line on what changed
## Commands run (paste the last lines of each output)
- bun run typecheck
- bun test <the files you touched>   (and the full `bun test` at the end)
- bun run --cwd apps/web build        (if apps/web changed)
## Screenshots (UI tasks): paths outside the repo, desktop 1440 + phone 390, light + dark
## What I did NOT do or could not check, and why
## Questions for the owner / Claude
```
A task is **not done** if a check fails or a step was skipped without saying so.
