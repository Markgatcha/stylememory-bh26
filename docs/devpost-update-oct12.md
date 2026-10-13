# Devpost submission edits — paste-ready (Oct 12/13, 2026)

Two rounds of changes shipped tonight. Apply BOTH — they replace the
same two story fields.

---

## Story field 1 — "What it does", step 1 (recall)

**Replace:**

> Recall what is relevant — whole-word name match first, then a
> relevance-thresholded text search, plus any learned traits that are
> always active.

**With:**

> Recall what is relevant — whole-word name match first, then
> word-overlap search (each content word is queried individually and a
> memory is recalled when it shares at least two of them), then a
> semantic leg: a 33 MB local embedding model recalls at cosine ≥ 0.50,
> so "a boy doing tricks on a board" finds the character even with zero
> shared words. Plus any learned traits that are always active.

## Story field 2 — "What's next for StyleMemory"

**Replace:**

> Semantic recall is the biggest gap — MemOS full-text search returns no
> rows for prose queries on this install, so recall leans on name
> matching. Then image-reference memory via Qwen's multi-reference
> conditioning, per-workspace memory, and running the consistency suite
> in CI as a regression gate.

**With:**

> Semantic recall shipped tonight. Recall runs three legs — whole-word
> name match, word-overlap (recalled when a memory shares at least two
> content words with the prompt), and a 33 MB local ONNX embedding
> model (bge-small-en-v1.5, q8) at cosine ≥ 0.50, so "a boy doing
> tricks on a board at golden hour" finds Kai with zero shared words.
> The model was picked by a four-way bake-off; the leg is additive and
> self-disabling — no package, no network, or an env kill-switch all
> fall back to the lexical legs with recall unchanged. What's next is a
> stronger embedding model (bge-base or Qwen3-embedding, one line to
> swap), image-reference memory via Qwen's multi-reference conditioning,
> per-workspace memory, and running the consistency suite in CI as a
> regression gate.

---

## Updates tab post (paste after applying the edits)

> **Update — recall now understands prompts that never name a character**
>
> MemOS 1.6.26's full-text search wraps prose queries as a single phrase,
> so they match nothing and recall leaned on whole-word name matching.
> Recall now runs three legs:
>
> 1. **Word-overlap** — each content word is queried individually; a
>    memory is recalled when it shares at least two of them. "a
>    skateboarder with a scar" finds Kai without naming him.
> 2. **Semantic** — a 33 MB local ONNX model (bge-small-en-v1.5, q8)
>    embeds the prompt and each character/style; cosine ≥ 0.50 recalls.
>    "a boy doing tricks on a board at golden hour" finds Kai with zero
>    shared words; "a red fox in a forest" finds nothing (the same guard
>    that killed the contamination bug still holds).
> 3. **Name match** — unchanged, still instant and exact.
>
> The model was chosen by a four-model bake-off (MiniLM-L6 lost — its
> negatives scored above its positives). The semantic leg is additive and
> self-disabling: package missing, offline, or `STYLEMEMORY_SEMANTIC=0`
> all fall back to the lexical legs with recall behavior unchanged.
>
> The 20-run A/B numbers (100% recall, 15.1% mean divergence) are
> unchanged — recall only ever added memories, never removed them.

## Do NOT change

The video, gallery images, built-with tags, tagline, challenges and
accomplishments sections are all still accurate.

## Note on the recorded demo

The video was recorded before these two recall upgrades, so it does not
show them — the story text above describes the shipped code, and the
update post makes the timeline explicit (no contradiction: the video
shows the A/B and the quarantine gate, both still exactly as recorded).
