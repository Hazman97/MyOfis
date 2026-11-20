# Review 038 (public Video HD): passed after Claude's security fixes (2026-11-20)

Checked by Claude: report read, code read, tests and screenshots re-run/looked at. Gemini's 3 tests, typecheck,
full suite and web build were all real. Isolation (no owner rows, owner routes 401/404, settings `ownerOnly`,
128-bit job ids, sanitised names, `textContent` only in the page) is good.

Fixed by Claude (tests added in `apps/hub/test/public-hd.test.ts`):
1. **Untrusted demuxers (high).** ffmpeg picks a demuxer by content. An upload that is really an `ffconcat` list
   with a `duration` line passed the probe check (320×240, 2 s) and ffmpeg rendered a neighbour's upload from
   `incoming/` (shown: test fails with the old code, "done" instead of "failed"). Now `sniffContainer()` accepts only
   ISO BMFF (`ftyp`) and EBML (MKV/WebM) by magic bytes, ffprobe runs with that `-f`, and the probed
   `format_name` must be in the mov/mp4 or matroska/webm family.
2. **Disk fill (high).** In-flight uploads were unlimited and the storage cap only counted files already on disk, so
   many parallel 500 MB uploads could pass the 20 GB cap. Now: one upload at a time per visitor, no more in flight
   than `max_queue`, remaining bytes of in-flight uploads count toward the cap, parts must arrive in order, stale
   entries are dropped after 2 h.
3. **Part size** is checked after reading too (a body without content-length).
4. **IP:** only `CF-Connecting-IP`; the `X-Forwarded-For` fallback could be forged to dodge per-IP limits.

Lesson for future tasks: anything that runs ffmpeg/ffprobe on files from strangers must check the container by
magic bytes first (SUPERVISOR rule candidate).
