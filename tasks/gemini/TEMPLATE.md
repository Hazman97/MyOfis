# Template: a UI task for Gemini (or any second AI)

How Claude and the owner split work so the UI comes out clean, including on phones:
1. **Claude builds the logic first** (API, data, state, pure helpers with tests), working and plain.
2. **Gemini only does the look**, in a fixed list of files, keeping every piece of logic.
3. **Gemini proves it**: typecheck, tests, build, and real screenshots (desktop + 390 px, light + dark).
4. **Claude reviews** the diff, runs the tests and looks at the screenshots; anything off goes back.

Copy everything below the line into `tasks/gemini/NNN-short-name.md`, fill in the brackets, and give Gemini the short prompt at the bottom.

---

# Task NNN: [what the owner will see, in a few words]

[One or two sentences: who uses it and why. The logic is done and tested; this task is the look.]

## Scope: edit ONLY
- `[path/to/View.vue]`: [which part: the list, the form, the card…]
- `[path/to/Component.vue]`: [which part]

**Keep exactly as they are:**
- every `api.*` call and its arguments;
- props, emits, `v-model`s, computed values and watchers;
- [any special logic: e.g. "the choice/custom logic of the picker", "the polling timer"].

## What to build
1. [Element]: [what it shows, in what order, what happens on tap].
2. [Element]: [states: loading / empty / error / success; what each looks like].
3. **Phone (390 px):** no sideways scroll; tap targets ≥ 40 px; [what stacks or collapses].
4. **Light and dark** both readable.

## Rules
- Follow `docs/FRONTEND.md`: design tokens only (no raw colours), canonical Tailwind v4 classes, no `-[Npx]` for spacing or sizes.
- English UI text [or: Malay for docs/manual].
- Do not edit: [logic files, packages/, apps/hub/, apps/runner/, api/http.ts, pure helpers].
- No new packages. Never delete or move files. Do not run `git commit`.
- Screenshots go outside the repo (or delete them before handing back).

## Check before you hand back
- `bun run --cwd apps/web typecheck`, `bun test apps/web` and `bun run --cwd apps/web build` pass.
- Screenshots of [pages] at desktop and 390 px, light and dark, from the preview hub (CLAUDE.md "Screenshots now need a preview hub").
- Tell the owner you are done; Claude reviews the diff and the screenshots.

---

**Prompt for Gemini:**

```
Read tasks/gemini/NNN-short-name.md in the [repo] repo and do the whole task.
Edit only the files it lists; keep every api call, prop, emit, v-model and computed as they are.
Follow docs/FRONTEND.md. Before handing back: typecheck, tests, build, and screenshots
(desktop + 390 px, light + dark) of the pages it names, saved outside the repo.
Do not git commit. Tell me when you are done.
```

## For another project (no docs/FRONTEND.md yet)
Write the rules into the task instead:
- the colour tokens / CSS variables to use and where they live;
- the CSS framework and its version (Tailwind v3 and v4 class names differ);
- the command for typecheck, tests, build, and how to run the app to take screenshots.
