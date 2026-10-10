# StyleMemory

**An image studio that remembers.**

A local-first image generation studio where a persistent memory layer — not
the prompt box — is what keeps your characters consistent across sessions.
Every generation is conditioned on what the studio already knows about your
characters, styles, and preferences; every generation feeds back into that
memory.

Built for **Banana Hacks 2026** (Image AI Hackathon, Oct 9–12 2026).

---

## The problem

Comic artists and indie game devs need the same character to look the same
across dozens of images. Standard text-to-image generation is stateless: the
same prompt produces a different identity every time, and nothing you
generated last session informs this one.

The industry's usual answer is to **train a LoRA per character** — collect
15+ curated images, run a GPU training job, ship a model file per character.
It works, but it costs a dataset and a training run for every new character,
and it doesn't generalize to styles, palettes, or "stop doing X" feedback.

## What StyleMemory does instead

It asks a narrower question: **how much consistency can you get from memory
alone** — no training, no reference images, no per-character model files?

Characters, style profiles, and learned preferences live in
[MemOS](https://github.com/Markgatcha/memos) (`@mem-os/sdk`). At generation
time the studio recalls what's relevant, folds it into the prompt, and shows
you exactly which memories shaped the result. Thumbs-down an image with a
note and the studio learns to avoid that thing next time.

Because the memory layer is the only thing that changes between two runs,
**the same-seed A/B comparison isolates its contribution exactly** — same
prompt, same seed, same size, memory off vs on. That turns "it remembers"
into something you can measure.

> Measured on this machine, prompt *"Kai skateboarding at sunset"*, one shared
> seed: memory **off** produced a generic figure with light brown hair in a
> grey t-shirt; memory **on** produced the stored character — electric blue
> hair, red windbreaker, ripped jeans, crouched stance. The only variable was
> memory.

---

## Quickstart

Requires Node 20+, pnpm, and a running ComfyUI on `127.0.0.1:8188`.

```bash
pnpm install
pnpm dev
```

Then open **http://127.0.0.1:5173**.

`pnpm install` may report a `better-sqlite3` build-script failure on pnpm 12.
The prebuilt binding is already correct and the install still succeeds; if a
fresh clone ever breaks, run `pnpm rebuild better-sqlite3` once.

| Service | URL |
|---|---|
| Web UI | http://127.0.0.1:5173 |
| API | http://127.0.0.1:3001 |
| ComfyUI | http://127.0.0.1:8188 |

### Useful scripts

```bash
pnpm dev            # API + web together
pnpm typecheck      # server + web
pnpm build          # production web build
```

---

## The core loop

```
prompt
  → recall relevant memories (name match → relevance search → active traits)
  → build enriched POSITIVE prompt
  → ComfyUI + Qwen Image 2.1 Turbo
  → gallery
  → thumbs up/down + note
  → learned trait written back to MemOS
  → next generation improves
```

Every image in the gallery records the final prompt that was actually sent and
the list of memories that shaped it.

### Notable implementation details

- **CFG 1 negation.** Qwen Image 2.1 runs at CFG 1, where ComfyUI ignores
  negative conditioning entirely. Learned "avoid" traits are therefore
  rewritten as *positive* prompt phrasing (`"too dark"` → `"bright,
  well-lit"`), and the negative node is only filled for higher-CFG workflows.
- **Turbo step count.** The Turbo checkpoint ships a distilled 8-step sigma
  schedule. Running 25 steps forces that distilled trajectory through 25
  uniform steps, which over-iterates the coarse phase and starves fine detail
  — observed as sharp ground with under-denoised fur. 8 steps is what the
  checkpoint was trained and evaluated at, and it is ~2.7× faster.
- **Edits use `supersede()`, never delete-and-recreate.** Character version
  history stays queryable, and the Memory tab shows the full chain with
  superseded versions marked.
- **App IDs are separate from MemOS node IDs.** MemOS generates node UUIDs;
  our records keep their own `id` plus the `memosNodeId` they came from.
- **Quarantine.** Feedback that names a defining attribute ("hair color is
  wrong") is held for review rather than written to memory — it is usually a
  complaint about one character, not a general preference, and auto-storing it
  would inject a meaningless phrase into future prompts.
- **Seed rotation.** Unpinned generations take `lastSeed + 1` from a persisted
  counter. Explicitly pinned seeds (used by the A/B comparison) bypass the
  counter entirely so comparisons stay reproducible.

---

## Features

| Tab | What it does |
|---|---|
| **A/B Compare** | Same prompt, one shared seed, memory off vs on, side by side with both final prompts |
| **Generate** | Prompt → memory-conditioned image, with live SSE progress (stage + sampler step) |
| **Characters** | Create/edit character profiles; edits supersede, history preserved |
| **Styles** | Create/edit style profiles with palette and tags |
| **Gallery** | Every generation with its final prompt, seed, and thumbs up/down + note |
| **Quarantine** | Review feedback that was held back from memory; approve or reject |
| **Traits** | Learned avoid/prefer traits, individually removable |
| **Memory** | Inspect every stored memory: content, tags, importance, trust, access count, version history |

---

## Architecture

```
stylememory-bh26/
├── server/                    Hono + @hono/node-server (TypeScript, ESM)
│   └── src/
│       ├── index.ts           routes
│       ├── jobs.ts            in-memory job registry for SSE progress
│       ├── progress-model.ts  socket-or-clock progress estimation
│       ├── generate-async.ts  non-blocking generation + live progress
│       ├── compare.ts         same-seed A/B comparison
│       ├── generations.ts     JSON index of generated images
│       ├── seed-state.ts      persisted seed rotation counter
│       ├── paths.ts           data dirs, ports, ComfyUI URL
│       ├── comfyui/
│       │   ├── client.ts      /prompt, /history, /view, /ws
│       │   └── introspect.ts  reads node IDs from the workflow file
│       ├── memory/
│       │   ├── memos.ts       MemOS singleton (namespace "stylememory")
│       │   ├── records.ts     characters, styles, traits, recall
│       │   ├── feedback.ts    feedback routing + quarantine
│       │   └── inspect.ts     memory inspector + version history
│       └── prompt/builder.ts  memory → enriched prompt (CFG 1 negation)
├── web/                       Vite + React + Tailwind v4
├── workflow/qwen-image.json   API-format ComfyUI workflow
└── docs/
    ├── research.md            rubric-scored roadmap + sources
    └── comfyui-launch-flags.md
```

### Why Qwen Image 2.1 Turbo

The project targets an **8 GB RTX 5050**, which rules out FLUX.2 [dev] (~32 GB),
FLUX.2 [klein] (13 GB), Krea 2 (12 GB), and Ideogram 4 (24 GB). Among models
that fit, Qwen-Image 2.1 is the strongest choice for this use case: it is
Apache-2.0 licensed, supports **multi-reference conditioning** (directly
aligned with a memory-conditioned studio), and has strong bilingual text
rendering. The Q5_0 GGUF quant of the Turbo checkpoint fits the VRAM budget
and the 8-step distilled schedule keeps iteration fast enough to demo live.

---

## API

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/health` | ComfyUI + MemOS + workflow status |
| `POST` | `/api/generate` | Queue a generation → `{ jobId, streamUrl }` |
| `GET` | `/api/progress/:jobId` | SSE progress stream → `result` event |
| `GET` | `/api/gallery` | All generations |
| `GET` | `/images/:file` | Generated image bytes |
| `POST` | `/api/compare` | Same-seed A/B (memory off vs on) |
| `GET`/`POST` | `/api/characters` | List / create |
| `PUT`/`DELETE` | `/api/characters/:id` | Update (supersede) / delete |
| `GET`/`POST` | `/api/styles` | List / create |
| `PUT`/`DELETE` | `/api/styles/:id` | Update (supersede) / delete |
| `GET`/`DELETE` | `/api/traits[/:nodeId]` | List / delete learned traits |
| `POST` | `/api/generate/:id/feedback` | Thumbs up/down + note |
| `GET` | `/api/quarantine` | Pending review items |
| `POST` | `/api/quarantine/:id/approve` \| `/reject` | Resolve a held item |
| `GET` | `/api/inspect` | All stored memories |
| `GET` | `/api/inspect/history/:appId` | Version chain for one record |
| `GET` | `/api/inspect/graph` | Nodes + edges |

---

## Requirements

- **ComfyUI** running on `127.0.0.1:8188` (Comfy Desktop or manual install)
- Model files in ComfyUI's `diffusion_models/`, `text_encoders/`, `vae/`:
  - `qwen-image-2.1-turbo-Q5_0.gguf` (diffusion, Q5_0 GGUF)
  - `qwen3vl_8b_int8_convrot.safetensors` (text encoder)
  - `qwen_image_2.1_vae_bf16.safetensors` (VAE)
- Node 20+, pnpm
- ~8 GB VRAM recommended

> **ComfyUI launch flags matter.** This project requires `--fast
> fp8_matrix_mult` to be **absent** — FP8 matmuls visibly degrade output
> quality (soft subject, color drift). See
> [`docs/comfyui-launch-flags.md`](docs/comfyui-launch-flags.md).

---

## Honest limitations

- **Text-only memory.** There is no image reference or CLIP-embedding memory;
  consistency comes entirely from prompt conditioning. The A/B compare exists
  partly to measure how far that gets you.
- **Recall is name-match driven.** MemOS 1.6.26's full-text search returns no
  rows for prose queries on this install, so semantic recall relies on the
  whole-word character/style name match. Text search is wired with a relevance
  floor and will start contributing if the SDK's FTS behaviour improves.
- **Style palette/tags don't round-trip** in the list view — they are stored in
  the memory content string rather than as structured fields. They do reach the
  prompt.
- **In-memory job registry.** Restarting the server drops in-flight progress
  streams; the gallery record is still written on completion.
- **No delete of a whole character's history** beyond `forget()` on the current
  node.

## Not attempted, deliberately

- **Per-character LoRA training.** It would do the identity work directly,
  which makes the *memory* engine look decorative — the exact failure mode an
  image-AI-themed hackathon penalizes. See [`docs/research.md`](docs/research.md).
- **Canvas / layer editing.** That is a different product. The "studio" claim
  rests on remembering, not on editing tools.

---

## License

MIT.
