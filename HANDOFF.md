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

### Post-M3 fixes (all traced to root cause)
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

## What's Next (M4)

- Memory inspector: browse every stored memory (characters, styles, traits),
  see its content/tags/metadata, and view version history for superseded
  character edits (`getGraph()` / `searchTemporal()`)
- Memory OFF vs ON **side-by-side** with an identical pinned seed and size,
  showing both final prompts next to both images. The single-toggle A/B
  already exists in the API (`memoryOff`, `seed`); what is missing is the
  two-up view and the automatic seed pinning so the comparison is honest.

### Rubric notes (Banana Hacks 2026 scoring criteria)

- **Row C (Image AI theme):** already at the top band. Remove the memory
  engine and generation has nothing to condition on — the product stops
  working. Nothing to add.
- **Row A (Technical execution):** the multi-step pipeline (recall → prompt
  build → ComfyUI → feedback → re-store) plus the CFG-1 positive-prompt
  negation and supersede-based versioning is the evidence here. M4's
  side-by-side makes it legible to a judge in one screen.
- **Row E (Design/demo):** the 3-minute demo should lead with M4's
  side-by-side — same seed, memory off vs on — because it proves the
  memory engine is load-bearing rather than decorative.

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
