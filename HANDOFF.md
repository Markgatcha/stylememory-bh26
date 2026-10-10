# HANDOFF — StyleMemory @ Banana Hacks 2026

Last updated: Fri Oct 9, 2026 ~11:30 PM EDT (mid-M2)

## What's Done

### M0 — Scaffold ✓ (committed: `7e1dc6c`)
- pnpm workspaces (server + web)
- Hono API on port 3001, GET /api/health
- MemOS singleton, namespace "stylememory", SQLite persisted
- Vite + React + Tailwind UI shell on port 5173
- ComfyUI probe (v0.39.0 reachable)

### M1 — Generate ✓
- `workflow/qwen-image.json` — API-format workflow flattened from the user's
  ComfyUI UI-format file (`qwen21_gguf_fast.json`). Node IDs were READ from
  that file, never invented. Uses `qwen-image-2.1-turbo-Q5_0.gguf`.
- `POST /api/generate` — loads workflow, patches prompt/seed/steps/size,
  queues to ComfyUI `/prompt`, polls `/history/{id}`, downloads image via
  `/view`, saves to `data/images/`, appends to `data/generations.json`
- `GET /api/gallery` + `GET /images/:filename` — gallery with image serving
- Progress: elapsed-seconds counter in the UI button during generation.
  **NOTE: real-time WebSocket progress bar is NOT wired yet** — see Known Issues.
- **Verified:** 2 generations completed end-to-end (memory ON + OFF),
  both images are real PNGs on disk, served via HTTP 200.

### M2 — Characters & Styles ✓
- `POST/GET /api/characters`, `PUT /api/characters/:id` — CRUD with
  MemOS storage. Tags: `["character", "character:<name>"]`
- `POST/GET /api/styles`, `PUT /api/styles/:id` — CRUD with MemOS storage.
  Tags: `["style", "style:<name>"]`
- Edits use `supersede()` — old node gets `validTo` set, history preserved
- `recallMemories()` — whole-word case-insensitive name match FIRST
  (`reason: "character-name"`), then tag search, then full-text search.
  Active "avoid" traits always included.
- `buildEnrichedPrompt()` — merges recalled memories into the POSITIVE prompt.
  CFG 1 means negatives are ignored, so "avoid" traits are rewritten as
  positive counter-phrasings (e.g. "neon" → "muted, desaturated colors").
- UI shows: final prompt, negative prompt, seed, size, and the list of
  memories used (with kind + recall reason)
- **Verified:** "Kai" recalled by name match, merged into prompt, image
  shows spiky blue hair + red jacket + worn jeans (visually confirmed).
  Memory OFF with same seed produces unenriched prompt — valid A/B.

## What's Next (M3)

- Thumbs up/down on gallery images → write learned traits to MemOS
  (thumbs-up = importance boost via `update()`, thumbs-down = candidate
  "avoid" trait)
- Quarantine screen: feedback that looks wrong/contradictory goes to a
  review list, not straight into memory
- `POST /api/generate/:id/feedback` already exists (stores feedback on the
  generation record) but does NOT yet write to MemOS — that's M3 work

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

- GPU: RTX 5050 Laptop, 8GB VRAM
- Model: qwen-image-2.1-turbo-Q5_0.gguf (4.19GB, 8-step, CFG 1)
- Text encoder: qwen3vl_8b_int8_convrot.safetensors
- VAE: qwen_image_2.1_vae_bf16.safetensors
- Generation time: ~140s at 1024×1024, 25 steps
- Ports: API 3001, web 5173, ComfyUI 8188
