# HANDOFF — StyleMemory @ Banana Hacks 2026

Last updated: Fri Oct 9, 2026 ~11:30 PM EDT (mid-M2)

## What's Done

### M0 — Scaffold ✓ (committed: `7e1dc6c`)
- pnpm workspaces (server + web)
- Hono API on port 3001, GET /api/health
- MemOS singleton, namespace "stylememory", SQLite persisted
- Vite + React + Tailwind UI shell on port 5173
- ComfyUI probe (v0.39.0 reachable)

### M1 — Generate ✓ (`259c6bc`)
- `workflow/qwen-image.json` — API-format workflow flattened from the user's
  ComfyUI UI-format file (`qwen21_gguf_fast.json`). Node IDs were READ from
  that file, never invented. Uses `qwen-image-2.1-turbo-Q5_0.gguf`.
- `POST /api/generate` — introspects the workflow, patches
  prompt/seed/steps/size, queues to ComfyUI, polls history, downloads the
  image, saves it to the gallery with a JSON index entry
- `GET /api/gallery` + `GET /images/:filename`
- Progress: elapsed-seconds counter in the UI.
  **Real-time WebSocket progress bar is NOT wired** — see Known Issues.
- Verified: multiple generations completed end-to-end, real PNGs on disk,
  served over HTTP 200.

### M2 — Characters & Styles ✓ (`11fb8e1`)
- Characters and styles CRUD in the UI, stored in MemOS
  (namespace "stylememory", tags as discriminators)
- Edits use `supersede()` — history preserved
- Recall: whole-word name match first, then relevance-thresholded text search
- Enriched prompt: memories merged into the POSITIVE prompt (CFG 1 ignores
  negatives; avoid traits rewritten as positive counter-phrasings)
- UI shows final prompt, negative prompt, seed, size, and memories used
- Memory OFF toggle for before/after comparison (same seed)
- Verified: "Kai" recalled by name and merged into the prompt

### M3 — Feedback, learned traits, quarantine ✓
- Thumbs up/down with an optional note on any gallery image
- Feedback routing (`server/src/memory/feedback.ts`):
  - rendering complaint → stored as an `avoid` trait in MemOS
  - explicit praise with a note → stored as a `prefer` trait
  - references a defining attribute (hair/eyes/outfit/…) → **quarantined**
  - no note, or a generic note ("bad", "ok") → ignored, nothing learned
- Quarantine screen: approve writes the trait into MemOS, reject discards it.
  Approved/rejected history is kept. Double-resolving returns 404.
- Traits tab lists learned avoid/prefer traits with delete (`forget()`)
- Avoid traits are always-on: every generation rewrites them into the
  POSITIVE prompt (CFG 1 workaround) and into the negative node
- Verified end-to-end: all five routing outcomes exercised over HTTP;
  quarantine confirmed to gate an identity-touching note out of memory
  until approved; approve → present in memory; approve twice → 404.

### M4 — Memory inspector + A/B comparison ✓

**Memory inspector** (`GET /api/inspect`, `GET /api/inspect/history/:appId`,
`GET /api/inspect/graph`):
- Lists every active memory with kind, content, tags, importance, trust,
  access count, source and timestamps
- Version history walks the full supersede chain — requires
  `includeHistorical: true`, since superseded nodes are excluded from the
  default search and would otherwise only ever show v1
- Graph view exposes `temporal_precedes` edges created by `supersede()`

**A/B comparison** (`POST /api/compare`, "A / B Compare" tab):
- Generates the same prompt twice with **one shared seed** and identical size
- The seed is generated once inside `compare.ts` and passed to both arms. It
  deliberately does NOT use the rotation counter and does not advance it —
  otherwise the two runs would differ by seed and prove nothing.
- Arms run sequentially (ComfyUI executes one job at a time)
- Both arms are recorded in the gallery
- UI shows both images side by side with both final prompts and the memory list

**Delete** (`DELETE /api/characters|styles|traits/:id`) via `forget()`, with a
confirm step in the UI. Distinct from `supersede()`: an edit keeps history
queryable, a delete removes the record entirely.

**Verified:**
- Version history: created a character, edited twice → v1/v2 marked
  superseded, v3 current, correct order
- A/B: seed `150634584270736` shared by both arms, images differ.
  Memory OFF → light brown hair, grey t-shirt, standing pose.
  Memory ON → electric blue hair, red windbreaker, ripped jeans, crouching.
  Same seed, same prompt, so the difference is attributable to memory alone.
- Delete: removes the record; deleting a missing id returns 404
- `8983740` Seed rotation: unpinned generations take lastSeed+1 from a
  persistent counter; pinned seeds (A/B) bypass it.
- `7a243a7` Memory contamination: removed an importance-ranked recall
  fallback that returned a constant score of 1.0 for every node, which was
  injecting the top character into every unrelated prompt.
- `03bd911` Removed `--fast fp8_matrix_mult` from the ComfyUI launch flags —
  FP8 matmuls were degrading image quality. See `docs/comfyui-launch-flags.md`.
- `e2d3efb` Steps 25 → 8 for the Turbo checkpoint. The distilled 8-step
  sigma schedule is baked into the checkpoint; 25 steps starved the
  fine-detail phase (sharp ground, under-denoised fur).

## What's Next (M5 — Sunday AM)

Polish, README, bug fixes only. No new features.

### Remaining known gaps (priority order)

1. **WebSocket real-time progress bar** — still an elapsed-seconds counter.
   `streamProgress()` exists in `server/src/comfyui/client.ts` but is not
   wired to a browser-facing endpoint. Needs an SSE or WS route from Hono.
   This is the most visible polish item for a live demo.
2. **Style palette / styleTags don't round-trip** in the list view — they are
   stored in the MemOS content string, not as structured fields. They do reach
   the prompt; the list just can't show them.
3. **4-panel consistency mode** — not started (could-have).
4. **Character sheet PNG export** — not started (could-have).

### Cut order if time runs short
LoRA → PNG export → 4-panel consistency → before/after falls back to two
screenshots. The six MUST features are never cut.

### Demo script (3 min, leads with the strongest evidence)

1. **0:00–0:45 — A/B Compare tab.** Same seed, memory off vs on. Point at the
   hair and the jacket changing. This is the single most persuasive screen:
   it proves memory is load-bearing, not decorative. (Row C + Row A)
2. **0:45–1:30 — Memory tab.** Expand Kai, show the version chain with
   superseded v1/v2 and current v3. Shows real engineering, not a wrapper.
   (Row A)
3. **1:30–2:15 — Feedback loop.** Thumbs-down an image with a note, watch it
   land in Traits, then show a note that gets *quarantined* instead of
   trusted. Explains why the memory stays clean. (Row B)
4. **2:15–3:00 — Architecture + problem.** Comic artists / indie devs who
   can't keep a character consistent across sessions. One local install, no
   paid APIs, memory persists across restarts.

### Rubric notes (Banana Hacks 2026 scoring criteria)

- **Row C (Image AI theme):** top band. Remove the memory engine and
  generation has nothing to condition on — the product stops working.
- **Row A (Technical):** the multi-step pipeline (recall → prompt build →
  ComfyUI → feedback → re-store), CFG-1 positive-prompt negation, and
  supersede-based versioning are the evidence. M4's side-by-side makes it
  legible in one screen.
- **Row B (Innovation):** the quarantine gate is the original twist — most
  feedback systems write straight to memory; refusing to trust
  identity-level feedback is a defensible design choice worth calling out.
- **Row D (Impact):** comic artists and indie game devs are the named user.
  Local-first, no paid APIs, memory survives restarts.
- **Row E (Design/demo):** lead with the A/B compare. Close gap #1 (progress
  bar) if time allows.

## How to Run

```bash
cd C:\Users\marki\stylememory-bh26
pnpm install                          # first time only
pnpm dev                              # starts API :3001 + web :5173
```

Then open http://127.0.0.1:5173

Individual:
```bash
pnpm dev:server                       # API only, port 3001
pnpm dev:web                          # web only, port 5173
pnpm typecheck                        # server + web
pnpm build                            # web production build
```

ComfyUI must be running on 127.0.0.1:8188 (it is, as a background service).

## Known Issues / Honest Status

1. **WebSocket progress bar not wired.** The server has `streamProgress()`
   in `server/src/comfyui/client.ts` but it's not called from the generate
   route. The UI shows an elapsed-seconds counter instead. Real-time
   per-step progress needs an SSE or WS endpoint from the Hono server to
   the browser — planned but not done.

2. **better-sqlite3 rebuild error on `pnpm install`.** pnpm tries to re-run
   the native build script on every install and it fails (node-gyp issue).
   The prebuilt binding is already correct and works. The install still
   succeeds (exit 0) — the error is cosmetic. If a fresh clone ever breaks,
   run `pnpm rebuild better-sqlite3` manually.

3. **Style palette/styleTags not round-tripped.** `listStyles()` returns
   empty `palette` and `styleTags` arrays because they're stored in the
   MemOS content string, not as structured fields. The create/edit forms
   accept them and they appear in the prompt, but the list view doesn't
   show them. Fix: parse them back from content, or store in metadata.

4. **No delete for characters/styles.** Only create + update (supersede).
   Delete would need `forget()` wiring — not done.

5. **Quarantine list not implemented.** M3 scope.

6. **4-panel consistency mode not implemented.** Could-have.

7. **Character sheet PNG export not implemented.** Could-have.

## Files Another Agent Must Not Touch

- `workflow/qwen-image.json` — hand-flattened from the user's ComfyUI
  export. If ComfyUI nodes change, re-export and re-flatten. Do not
  hand-edit node IDs.
- `data/stylememory.db` — MemOS SQLite. Do not open while server runs.
- `server/src/memory/memos.ts` — the singleton. Race-safe init() promise.
  Do not create a second MemOS instance.
- `C:\Users\marki\AppData\Local\Comfy-Desktop\` — the ComfyUI install.
  Only `workflow/qwen-image.json` and model files in ComfyUI-Shared/models
  are ours to touch.

## Commit History

| Commit | Message | Time (EDT) |
|--------|---------|------------|
| 7e1dc6c | M0: scaffold — API + health, UI shell | 2026-10-09 21:12 |
| (pending) | M1: generate + gallery | — |
| (pending) | M2: characters, styles, memory recall | — |

## Environment Facts

- GPU: RTX 5050 Laptop, 8GB VRAM (ComfyUI self-limits to ~3.8GB)
- Model: qwen-image-2.1-turbo-Q5_0.gguf (4.19GB, 8-step, CFG 1)
- Text encoder: qwen3vl_8b_int8_convrot.safetensors
- VAE: qwen_image_2.1_vae_bf16.safetensors
- Generation time: ~140s at 1024×1024, 25 steps
- Ports: API 3001, web 5173, ComfyUI 8188
- ComfyUI launch flags: see `docs/comfyui-launch-flags.md` — `--fast
  fp8_matrix_mult` was removed because FP8 matmuls were degrading image
  quality (soft subject, color drift).
