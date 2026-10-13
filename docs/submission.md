# StyleMemory — submission

*Banana Hacks 2026. All figures below are measured, not estimated.*

---

## Inspiration

Comic artists and indie game developers need the same character to look the
same across dozens of images. Standard text-to-image generation is stateless:
the same prompt produces a different identity every time, and nothing you
generated last session informs this one. We talked to the problem from the
production side — a character drifting between pages breaks a comic faster than
bad rendering does.

The industry's usual answer is to **train a LoRA per character**: collect 15+
curated images, run a GPU training job, ship a model file per character. It
works, but it costs a dataset and a training run for every new character, and
it does nothing for styles, palettes, or "stop doing X" feedback. Multiple
independent 2026 surveys of studios working on graphic novels name character
consistency as *the* blocker to adoption.

## What it does

StyleMemory asks a narrower question: **how much consistency can you get from
memory alone** — no training, no reference images, no per-character model
files?

Characters, style profiles, and learned preferences live in
[MemOS](https://github.com/Markgatcha/memos) (`@mem-os/sdk`), a local-first
persistent memory layer. At generation time the studio:

1. **Recalls** what's relevant — whole-word character/style name match first,
   then relevance-thresholded text search, plus always-on learned traits.
2. **Builds an enriched prompt** by folding those memories into the positive
   conditioning.
3. **Generates** through ComfyUI + Qwen Image 2.1 Turbo, streaming live
   per-step progress.
4. **Shows its work** — the final prompt actually sent, and the list of
   memories that shaped it.
5. **Learns** — thumbs up/down with a note writes a trait back to memory, so
   the next generation improves.

Because memory is the *only* thing that changes between two runs, the
**same-seed A/B comparison isolates its contribution exactly**: same prompt,
same seed, same size, memory off vs on.

## How we built it

- **Stack:** pnpm workspaces · Hono + TypeScript server · Vite + React +
  Tailwind v4 client · ComfyUI + Qwen Image 2.1 Turbo (Q5_0 GGUF) ·
  `@mem-os/sdk` for memory · JSON index + local image folder. No paid APIs.
- **Pipeline, not a wrapper.** Recall → prompt construction → diffusion →
  feedback → re-store. The ComfyUI workflow is read from disk and
  **introspected at runtime** for node IDs — nothing is hardcoded, so swapping
  the workflow file changes the pipeline without touching code.

Three non-obvious problems we had to solve:

**CFG 1 ignores negative prompts.** Qwen Image 2.1 runs at CFG 1, where
ComfyUI discards negative conditioning entirely. Learned "avoid" traits are
therefore rewritten as *positive* phrasing (`"too dark"` → `"bright,
well-lit"`), and the negative node is only filled for higher-CFG workflows.

**The Turbo checkpoint wants 8 steps, not 25.** It ships a distilled 8-step
sigma schedule. Running 25 steps forces that distilled trajectory through 25
uniform steps, which over-iterates the coarse phase and starves fine detail —
we measured it as sharp ground with under-denoised fur. Dropping to 8 steps
fixed the quality *and* cut generation time ~2.7×.

**Memory recall was contaminating unrelated prompts.** A relevance fallback in
MemOS returned a constant score of 1.0 for every node regardless of query, so
the highest-importance character was injected into *every* prompt — we caught
it when "a red fox in a forest" came back wearing the character's jacket, with
fur melting into the fabric. Fixed by removing the fallback and adding a
relevance floor; recall now relies on the two paths that carry real signal.

## Accomplishments we're proud of

- **A working, measurable intervention point.** The same-seed A/B turns "it
  remembers" into something checkable. Across **20 same-seed pairs** (40
  generations, 33 min) on the prompt *"Kai skateboarding at sunset"*:

  | Metric | Result |
  |---|---|
  | Memory recall rate | **20/20 (100%)** — every run pulled the stored character |
  | Mean pixel divergence | **15.1%** (median 15.1%, σ 2.3 pts) |
  | Range | 11.4% – 19.0% |
  | Pixels visibly changed | **68.7%** mean |

  The recall rate is the number that evidences memory doing work: every single
  run retrieved the character, so no pair is an accident of matching nothing.
  The tight spread (σ 2.3 pts across 20 independent seeds) is what makes it a
  measurement rather than an anecdote — the effect is reproducible, not a lucky
  draw.
- **Quarantine.** Feedback that names a defining attribute ("hair color is
  wrong") is *held for review* rather than written to memory. It is usually a
  complaint about one character, not a general preference, and auto-storing it
  would inject a meaningless phrase into every future prompt. Most feedback
  systems write straight to memory; refusing to trust identity-level feedback
  is what keeps the memory clean.
- **Version history via `supersede()`.** Editing a character never
  delete-and-recreates; the full chain stays queryable, and the Memory tab
  shows superseded versions marked.
- **Real-time progress that does not lie.** ComfyUI's progress events turned
  out to be intermittent — we measured back-to-back runs delivering 16 frames
  and 1. A socket-only bar would sometimes sit at 0% for the whole generation,
  so the socket drives the bar when it has data and a measured clock model
  keeps it moving when it does not. It never claims completion; only the
  authoritative history poll does.

## What we learned

- **Diffusion quality is a configuration problem before it is a model
  problem.** Two of our three worst image bugs were launch flags and step
  count, not the checkpoint. `--fast fp8_matrix_mult` alone caused visible
  softness and color drift.
- **Measuring beats asserting.** The consistency suite found the recall bug
  indirectly and is what makes the project's central claim falsifiable.
- **Don't trust a similarity metric you can't explain.** We evaluated LPIPS
  and DreamSim for the A/B comparison and rejected them: both need neural
  model downloads we don't have, and neither can say whether the memory-ON
  image is *better* — they measure distance, not quality. The reported pixel
  delta is explicitly a proxy; the recall rate is the half that evidences
  memory doing work.

## What's next for StyleMemory

- **Semantic recall.** Prose recall now works through app-layer
  word-overlap — each content word is queried individually and a memory
  is recalled when it shares at least two of them, so "a skateboarder
  with a scar" finds Kai without naming him. What remains is true
  semantic recall: paraphrase with no shared words, which needs an
  embedding model (the local-hash fallback scores degenerate, and a
  multi-GB download was rejected for this hackathon).
- **Image-reference memory.** Attach a generated image to a character so
  future generations can condition on it directly, via Qwen's multi-reference
  support.
- **Per-workspace memory.** Separate memory per project so a comic's cast does
  not bleed into a game's.
- **Consistency score as a regression test.** Run the suite in CI and fail if
  mean divergence drops, so memory regressions are caught before release.

## Built with

`@mem-os/sdk` · ComfyUI · Qwen Image 2.1 Turbo · Hono · React · Vite ·
Tailwind CSS · pnpm · TypeScript · pngjs

## Try it

Local-first: clone, `pnpm install`, `pnpm dev`, open http://127.0.0.1:5173.
Requires a running ComfyUI on port 8188. See the README for the required model
files and the launch-flag caveat that materially affects output quality.
