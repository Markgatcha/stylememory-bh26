# Research findings — what to do with the remaining time

Date: Sat Oct 10, 2026 ~00:10 EDT
Deadline: Sun Oct 11, 23:59 EDT (~48h left)
Rubric: 5 rows × 5 points. Rows A–E.

This document supersedes the ordering in the previous version of this file.
The earlier recommendation (Consistency Score → palette round-trip) has been
delivered; what follows is what the *next* research pass says to prioritise.

---

## The headline finding: stop coding

Multiple independent 2026 hackathon studies converge on one result, and it is
not close:

> "Teams that stop coding early and spend at least **two hours** rehearsing
> their pitch consistently outperform teams with stronger code and weaker
> storytelling. This is not a marginal effect; it is often decisive in close
> judging decisions." — NextAgile 2026 Devpost trend analysis, repeated
> independently by HackerEarth's 2026 research.

Supporting details from the same sources:

- Judges evaluate the project for **3–5 minutes**. They cannot review the code.
- "A solid project with a great pitch usually beats a great project with a poor
  pitch. This isn't fair, but it's reality."
- Recommended structure: **problem → solution → demo → impact → next steps**.
- Reserve **≥20% of total time** for pitch prep, starting early rather than at
  hour twenty.
- A thin or missing README is explicitly called out as a failure mode even when
  the demo goes well.

**Implication for us:** StyleMemory's weakest row is **E (Design, Presentation,
Demo)**, and Row E is the row that rehearsal moves most. We have ~48h. The
highest-expected-value action is no longer a feature — it is a rehearsed demo
and a submission write-up.

---

## Row-by-row assessment

| Row | Where we are | Cheapest way to gain |
|---|---|---|
| **A — Technical** | Solid: multi-step pipeline, CFG-1 negation, supersede versioning, SSE progress with a measured clock fallback, same-seed A/B, consistency scoring. Probably 4/5. | A 5/5 wants "custom training, fine-tuning, or a multi-step pipeline" that "works reliably in the demo." We have the pipeline and reliability. The gap is perceived depth — solved by *showing* the pipeline, not adding to it. |
| **B — Innovation** | The quarantine gate and the "measure what memory buys you" framing are the original elements. Probably 3–4/5. | Naming the twist explicitly in the first 30 seconds of the pitch. Not a code change. |
| **C — Image AI centrality** | Top band. Remove the memory engine and generation has nothing to condition on. 5/5. | Nothing. Already maximal. |
| **D — Impact** | Named user (comic artists, indie devs), real problem, local-first, no paid APIs. Probably 4/5. | One concrete "who cares" sentence with a number, e.g. generation cost per character vs LoRA training. |
| **E — Design/demo** | **Weakest row.** UI is clean, but there is no rehearsed demo and no submission write-up. Probably 3/5. | **Rehearsal + a written submission.** This is where the points are. |

---

## Finding 2: our pixel-delta metric is defensible, and DreamSim is not worth it

Research on perceptual metrics confirms the current approach is reasonable and
that upgrading it would be a poor trade:

- **LPIPS / DreamSim / DINO** all require loading a neural network to compute
  embeddings. DreamSim specifically needs CLIP + OpenCLIP + DINO concatenated
  and finetuned — three model downloads.
- **We have no CLIP model on disk.** `ComfyUI-Shared/models/clip/` and
  `clip_vision/` are both empty; the workflow's CLIPLoader uses the Qwen text
  encoder, not a CLIP image encoder.
- Critically, **none of these metrics answer our question anyway.** They
  measure perceptual distance between two images. They cannot say whether the
  memory-ON image is *better* — that needs a human or a learned quality metric
  (NIQE/BRISQUE/NIMA are no-reference quality, a different axis entirely).

**Verdict: keep the pixel-delta + recall-rate pair.** The honest framing
already in the code ("a proxy, not a perceptual metric") is correct, and the
recall rate is the half that actually evidences memory doing work. Adding a
multi-GB model download for a metric that still cannot judge quality is a net
loss with 48h left.

---

## Finding 3: "AI is table stakes" — but that cuts in our favour

HackerEarth 2026: *"Judges have seen a hundred GPT wrappers."* The winning
categories are agentic AI, RAG, and multimodal — projects with genuine
pipeline depth rather than a single API call.

StyleMemory is **not** a wrapper: it is a multi-stage pipeline
(recall → prompt construction → diffusion → feedback → re-store) with a
measurable intervention point. That is exactly the profile the research says
scores well. Worth stating plainly in the pitch so the judge classifies it
correctly in the first minute.

---

## Recommended plan

### Do first (highest expected value, ~3h total)

1. **Write the submission / Devpost description** (~60 min).
   Structure: problem → what we built → the twist → measured result → honest
   limits → next steps. Pull the real numbers from the README and the
   consistency report (13.1% mean delta, 100% recall, 2/2 runs).
2. **Build and rehearse a 3-minute demo script** (~90 min).
   Use the script already drafted in `HANDOFF.md`; rehearse it against the
   running app at least twice, timing it. Have a fallback for every step in
   case ComfyUI is busy.

### Do only if the above is done and time remains

3. **Style palette/styleTags round-trip** (~30 min). Pure polish, Row E.
4. **A one-slide architecture diagram** for the write-up. Row E, cheap.

### Do not do

- **DreamSim/LPIPS integration.** Three model downloads, cannot answer the
  quality question, 48h left.
- **LoRA training.** Would make the memory engine look decorative — the exact
  failure mode Row C penalises.
- **Canvas/layer editing.** Different product; scatters the pitch.
- **4-panel consistency mode / PNG export.** Could-haves; they add surface area
  to rehearse and risk the demo.

---

## Sources

- NextAgile — *Top 10 Hackathon Project Ideas & Topics To Win In 2026*
- HackerEarth — *50+ Hackathon Ideas for 2026*
- Skillify Solutions — *15 Hackathon Project Ideas With Source Code (2026)*
- Ainna — *How to Win a Hackathon: Preparation, Team, Build & Pitch*
- Medium — *The Hackathon Playbook: What Actually Works*
- ssundaram21/dreamsim — DreamSim (NeurIPS 2023 Spotlight)
- Lightning AI torchmetrics — LPIPS documentation
- Paperspace — *A Review of the Image Quality Metrics used in Image Generative Models*
- Reddit r/computervision — no-reference quality metrics (NIQE, BRISQUE, NIMA)
