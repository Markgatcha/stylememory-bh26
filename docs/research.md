# Research — where to take StyleMemory next

Findings from web research, scored against the Banana Hacks rubric
(Row A technical, Row B innovation, Row C image-AI centrality, Row D impact,
Row E demo). Ordered by expected score gain per hour of work, given the
remaining time before the Sunday 11:59 PM EDT deadline.

## The honest strategic picture

StyleMemory currently scores well on C and D and adequately on A/B/E. The
single biggest risk is **Row B (Innovation)** — "memory-conditioned prompting"
reads as a known technique, and a judge may see it as a prompt-template layer
over ComfyUI. The research surfaced one finding that changes that calculus.

## Finding 1 — the industry's gold standard is LoRA, and that's our opening

Multiple independent sources converge on the same conclusion:

- Pareto (working with comic/graphic-novel studios): *"the main missing
  feature, to widespread adoption of AI tools for production of graphic
  novels, comic books, children's books, etc. is in fact character
  consistency."* Their answer is DreamBooth LoRA on ~15-22 curated images.
- PixAI / Photo AI / LlamaGen: a trained character LoRA is described as "the
  most consistent option," needing 10-25 images, versus prompting which stays
  unreliable.

**Why this matters for scoring:** our text-only memory is the documented
weakness of the field. Every competitor solves consistency by *training*.
StyleMemory's differentiator is that it achieves *useful* consistency with
zero training and zero reference images — and, crucially, it can **measure**
whether memory actually helped (the A/B compare).

**Recommended framing for the demo and write-up** (Row B):
> "The industry solves character consistency by training a LoRA per character
> — 15+ curated images, a GPU training run, and a model file per character.
> StyleMemory asks what you get from memory alone, and proves the delta with
> a same-seed A/B."

That is a genuinely new angle: not "another consistency tool," but
"a measurement harness for how much a memory layer buys you." It reframes the
project from *competitor* to *baseline-and-experiment*, which is defensible
and hard to dismiss as a wrapper.

**Cheap version (2-3h, high demo value):** a "Consistency Score" panel that
runs the A/B compare N times and reports the mean perceptual difference
memory ON vs OFF. Turns the qualitative "it remembers" into a number a judge
can read. Feeds Row A and Row E directly.

## Finding 2 — LoRA is a real technical upgrade, but time-boxed

If time somehow permits after the MUST features, wiring `LoraLoader` into the
workflow would let a character carry a trained identity. But:
- Training needs a dataset we don't have and hours we don't have.
- The RUNBOOK already lists LoRA as the **first thing to cut**.
- It risks Row C: a LoRA does the identity work, which makes the *memory*
  engine look decorative — the exact failure mode judges penalize.

**Verdict: skip.** Note it in the README as future work instead.

## Finding 3 — the model landscape (for the README, not the code)

2026 open-weight image models, with VRAM on consumer cards:

| Model | VRAM | Strength | Relevance |
|---|---|---|---|
| **Qwen-Image 2.x** | ~12 GB | bilingual text, multi-reference | ← our choice; Apache-2.0, multi-reference is exactly our use case |
| FLUX.2 [klein] 4B | 13 GB | photorealism | heavier than our 8 GB card |
| FLUX.2 [dev] fp8 | ~32 GB | photorealism | out of reach |
| Z-Image Turbo | 8 GB | speed, volume | fits, but thinner ecosystem |
| Krea 2 Turbo fp8 | 12 GB | photorealism | out of reach |
| Ideogram 4.0 nf4 | 24 GB | typography | out of reach |

**Qwen-Image 2.1 is the right pick for an 8 GB card** and its multi-reference
conditioning is directly aligned with a memory-conditioned studio. Worth one
paragraph in the README to show the choice was deliberate (Row A: "sensible
model choices"). No code change needed.

## Finding 4 — UI expectations from InvokeAI / Fooocus

The comparison pieces agree on what a "studio" UI implies:
- **Unified canvas with layers, brushes, masks** (InvokeAI's flagship) —
  out of scope; it's a different product.
- **Fooocus's pitch is "fewest clicks to a first good image."** We already
  beat ComfyUI on this: prompt → image, memory applied automatically.
- Batch/queue management — ComfyUI wins; we don't need it.

**Verdict:** don't chase canvas features. Our "studio" claim should rest on
*remembering*, not on editing tools. Keep the UI as it is.

## Recommended plan for the remaining time

| Priority | Item | Rubric row | Effort |
|---|---|---|---|
| 1 | Reframe write-up + demo around "measure what memory buys you" | B, E | 30 min |
| 2 | README: problem, user, why Qwen, architecture, honest limits | D, E | 45 min |
| 3 | Consistency Score panel (N-run A/B, mean delta) | A, E | 2-3 h |
| 4 | Fix style palette/styleTags round-trip | E (polish) | 30 min |
| — | 4-panel consistency mode | A | cut if tight |
| — | Character sheet PNG export | E | cut if tight |
| — | LoRA | — | **do not attempt** (see Finding 2) |

## Sources

- Pareto — *Achieving Consistent Characters in Image Generative AI*
- prompting.systems — *Creating Consistent Characters in AI Art: 2026 Guide*
- Photo AI Studio — *Train Custom AI Models for Consistent Characters*
- Medium/PixAI — *3 Ways to Maintain Character Consistency*
- LlamaGen — LoRA training workflow
- PlugNode — *InvokeAI vs ComfyUI (2026)*
- earngenix — *Best Local Image Generation Models 2026 (ComfyUI Tested)*
- Thunder Compute — *Best Open-Source Image Generation Models (2026)*
- Morphed — *AI Image Generation Models: The Complete 2026 Guide*
