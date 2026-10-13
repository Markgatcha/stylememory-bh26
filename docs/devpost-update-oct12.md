# Devpost update post — paste-ready (Oct 12, 2026)

Post this under the submission's **Updates** tab
(https://devpost.com/software/stylememory-2bsey1 → Edit → Updates → New update).
Keep it short; it signals continued work before the deadline without
contradicting the recorded video.

---

**Update — recall now works when you never name the character**

MemOS 1.6.26's full-text search wraps prose queries as a single phrase,
so they match nothing and recall leaned on whole-word name matching. The
studio now queries each content word individually and recalls a memory
when it shares at least two of them with the prompt:

- "a skateboarder with a scar on his cheek" finds Kai — no name needed
- "vibrant comic-ink sunset poster" finds the Neon Sunset style profile
- "a red fox in a forest" finds nothing — one shared word is a collision,
  not relevance, the same guard that killed the memory-contamination bug

The name-match path, the quarantine gate, and the 20-run A/B numbers
(100% recall, 15.1% mean divergence) are unchanged.

---

## Story-field edits (paste over the two stale spots)

**In "What it does", step 1 — replace:**

> Recall what is relevant — whole-word name match first, then a
> relevance-thresholded text search, plus any learned traits that are
> always active.

**with:**

> Recall what is relevant — whole-word name match first, then
> word-overlap search (each content word is queried individually and a
> memory is recalled when it shares at least two of them), plus any
> learned traits that are always active.

**In "What's next for StyleMemory" — replace:**

> Semantic recall is the biggest gap — MemOS full-text search returns no
> rows for prose queries on this install, so recall leans on name
> matching. Then image-reference memory via Qwen's multi-reference
> conditioning, per-workspace memory, and running the consistency suite
> in CI as a regression gate.

**with:**

> Semantic recall is the remaining gap — prose recall now works through
> word-overlap search ("a skateboarder with a scar" finds Kai without
> naming him), but paraphrase with no shared words still needs an
> embedding model, which I deliberately skipped for this build. Then
> image-reference memory via Qwen's multi-reference conditioning,
> per-workspace memory, and running the consistency suite in CI as a
> regression gate.

## Do NOT change

- The video, the four gallery images, the "Built with" tags, the
  tagline, and the challenges/accomplishments sections are all still
  accurate (the contamination story is real history — the word-overlap
  floor is the successor of that relevance floor).
