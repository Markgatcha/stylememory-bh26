# Research pass 3 — options to raise the odds

Date: Sat Oct 10, 2026 ~12:50 EDT
Deadline: Sun Oct 11, 23:59 EDT (~35h left
Current state: M0–M5 complete. 20-run suite measured. Submission written.
Demo script written. Nothing is on fire.

This pass asks: is there anything left that measurably raises the score, or is
the remaining time better spent rehearsing?

---

## The one hard deadline fact that changes sequencing

From Devpost's own submission walkthrough and help center:

> "You can't be uploading a video at 3 p.m. Won't work… The video usually
> takes 2 minutes [to upload]… judges start judging at 3."
> "Leave at least two or three hours before the end to polish, record, and
> upload your demo video and Devpost submission."
> "We will not judge any project that does not have a video. We will not
> wait."

Banana Hacks is scored on Devpost. **A missing or late video is a zero,
regardless of code quality.** That makes the submission and recording a hard
gate, not a nice-to-have.

**Sequencing implication:** everything below is subordinate to having a
recorded, uploaded video with hours to spare. Feature work is now strictly
optional.

---

## Devpost's own advice — and it contradicts adding features

Devpost's "6 tips for a winning demo video":

1. **"Start with your elevator pitch… in the first few seconds."**
2. **"Be concise. Get as much as possible covered in the first two to three
   minutes with key info upfront."**
3. **"Show your project in use"** — visual and interactive, not slides.
4. **"Don't get bogged down in the technical aspects."**
5. **"Edit out the messy stuff. Don't be afraid to do multiple takes."**
6. **"Get organized. Write out a script, rehearse it before recording."**

Every one of these is satisfied by the current build plus the demo script we
just wrote. **None of them is satisfied by adding a feature.** The rubric's
Row E explicitly rewards "the demo (3 min or less) and write-up" — we now have
both drafted.

---

## Option A — 4-panel consistency mode (the best remaining feature)

**What:** one prompt, four generated images, pinned distinct seeds, same size,
shown as a 2×2 grid — the classic character-consistency sheet.

**Why it's the strongest remaining option:**
- Directly targets Row A's "works reliably in the demo" with a visually
  obvious artifact.
- The 4-panel sheet is *the* standard artifact in the character-consistency
  literature, so judges recognise it instantly.
- It is the natural companion to the consistency score — the score says "15%",
  the panel lets a human *see* what that means.

**Verified feasibility (not assumed):**
- `TextEncodeQwenImage21.prompt` is a **single STRING** — ComfyUI will not
  batch prompts through it. So this is four sequential generations with four
  pinned seeds, not one batched job.
- `EmptyLatentImage` supports `batch_size`, but with a single prompt that
  produces four *identical-layout* images, which is not what a consistency
  sheet means. Distinct seeds are the correct approach.
- We already have pinned-seed infrastructure (`runArm(prompt, seed, off)`) —
  this reuses it directly.

**Cost:** ~2h (sequential = 4 × 50s ≈ 3.5 min runtime, plus UI).
**Risk:** adds a demo step to rehearse. Only worth it if the video is already
recorded.

---

## Option B — memory graph visualisation (cheap, high Row A signal)

**What:** render `/api/inspect/graph` — we already collect nodes and
`temporal_precedes` edges but never display them. A 2-3h SVG showing
characters/styles/traits as nodes and supersede/relation edges between them.

**Why it's interesting:** the wider memory-layer field (Mem0, Zep, Graphiti,
LangGraph) treats graph structure as the frontier — "embeddings will not be
sufficient" for relationships. Showing that our studio already *has* a real
memory graph, not a key-value store, is strong Row A evidence and costs almost
nothing because the data endpoint exists.

**Cost:** ~2h, no new backend.
**Risk:** low. It is a read-only view of data we already produce.

---

## Option C — semantic recall (highest technical value, highest risk)

The memory-framework survey is blunt: *"A memory system that cannot
distinguish 'true now' from 'true last quarter' will eventually hand an agent
stale or contradictory context."* The frontier is semantic + temporal +
graph hybrid retrieval.

Our known gap is that MemOS 1.6.26's full-text search returns nothing for
prose queries, so recall leans on name matching. Fixing that properly means
either an SDK change or a local embedding model — and we have **no CLIP or
embedding model on disk** (verified: `clip/` and `clip_vision/` are empty).

**Verdict: do not attempt.** Adding a multi-GB model download inside 35 hours
of a hard deadline, to fix a gap the demo does not currently expose, is a bad
trade. It is already listed as "what's next" in the submission, which is the
correct place for it.

---

## Option D — done, do not re-litigate

- **DreamSim/LPIPS** — rejected in pass 2. Needs model downloads we don't
  have; cannot answer the quality question anyway.
- **LoRA** — would make the memory engine look decorative, the exact failure
  mode Row C penalises.
- **Canvas/layers** — different product; scatters the pitch.
- **Consistency score** — shipped, 20 runs measured.
- **README / submission / demo script** — shipped.

---

## Recommended sequence for the remaining ~35h

| When | Do | Why |
|---|---|---|
| **Now** | Rehearse the demo script twice, timed, against the live app | Row E is the weakest row and the one rehearsal moves most |
| **Then** | Record the demo video (multiple takes, edit out the rough parts) | Devpost: no video = not judged |
| **Then** | Fill in Devpost, upload, **verify the video plays** | Hard gate |
| **Then** | Option A (4-panel) **only if** the above is done with hours spare | Best remaining feature |
| **Then** | Option B (graph view) | Cheap Row A signal, read-only |
| **Never** | Options C, LoRA, DreamSim, canvas | Wrong risk profile at this stage |

**The single most important line in this document:** record and upload the
video with hours to spare. Everything else is optimisation.

---

## Sources

- Devpost — *6 Tips for making a winning hackathon demo video*
- Devpost Help Center — *Video-making best practices*
- Devpost — *Submission Walkthrough* (video upload deadline)
- mem0.ai — *Graph Memory for AI: 5 Solutions Compared (2026)*
- Graphlit — *AI Agent Memory Frameworks in 2026: Memory vs. Context*
- mem0ai/mem0 — GitHub (embedding model recommendations)
- Stackademic — *Mem0 Memory Layer — Purpose and Core Functionality*
