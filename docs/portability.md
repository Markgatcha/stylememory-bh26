# Portability — other models, other GPUs

StyleMemory was built against one machine (RTX 5050, 8 GB, Comfy Desktop on
Windows). This document states exactly what transfers to other setups and what
does not, so nobody has to discover it by debugging.

---

## TL;DR

| What | Portable? | Notes |
|---|---|---|
| **Swapping the diffusion model** | **Yes, no code change** | Drop a new workflow in `workflow/qwen-image.json` |
| **SDXL / Flux / SD1.5-style graphs** | **Yes** | Verified — see "Verified" below |
| **AMD GPUs (ROCm)** | **Yes** | ComfyUI-side concern only; our code is GPU-agnostic |
| **Intel Arc** | **Partly** | Needs ComfyUI's IPEX/SYCL build; GGUF support is weaker |
| **Apple Silicon** | **Yes** | ComfyUI MPS backend |
| **CPU-only** | Technically, practically no | Qwen-class models are unusably slow |

Nothing in our source hardcodes a model filename. Every model reference lives
in the workflow JSON.

---

## Swapping the model

All model choices live in `workflow/qwen-image.json`:

```json
"1": { "class_type": "UnetLoaderGGUF", "inputs": { "unet_name": "qwen-image-2.1-turbo-Q5_0.gguf" } },
"2": { "class_type": "CLIPLoader",     "inputs": { "clip_name": "qwen3vl_8b_int8_convrot.safetensors", "type": "qwen_image" } },
"3": { "class_type": "VAELoader",      "inputs": { "vae_name": "qwen_image_2.1_vae_bf16.safetensors" } }
```

To use a different model, export a new workflow from ComfyUI in **API format**
(menu → Export (API)) and save it over that file. Our server introspects it at
startup — node IDs, sampler, latent, save, and prompt-input names are all read
from the file, never hardcoded.

**Required node types** (the introspector throws a clear error if any are
missing):

| Role | Accepted node classes |
|---|---|
| Sampler | `KSampler`, `KSamplerAdvanced`, `SamplerCustom` |
| Positive encode | `TextEncodeQwenImage21`, `CLIPTextEncode`, `CLIPTextEncodeSDXL` |
| Latent | `EmptyLatentImage`, `EmptyLatentImagePresets` |
| Save | `SaveImage`, `SaveImageWebsocket`, `PreviewImage` |
| UNet | `UnetLoaderGGUF`, `UNETLoader` |
| CLIP | `CLIPLoader`, `DualCLIPLoader` |
| VAE | `VAELoader` |
| Optional image input | `LoadImage`, `LoadImageMask` |

To add a node class, edit the `*_TYPES` sets at the top of
`server/src/comfyui/introspect.ts`. That is the only change needed.

---

## How prompt patching stays model-agnostic

Different models name the prompt field differently:

- Qwen's `TextEncodeQwenImage21` → **`prompt`** (+ `negative_prompt`)
- Stock SD/SDXL/Flux `CLIPTextEncode` → **`text`** (separate nodes for positive
  and negative)

Rather than branching on model, the introspector reads which field the node
actually declares and returns it as `positivePromptInput` /
`negativePromptInput`. Callers patch that field by name:

```ts
posNode.inputs[workflow.nodes.positivePromptInput] = enriched.positive;
```

Positive/negative are disambiguated by reading the **sampler's `positive` and
`negative` input links** — authoritative for any model — with a shape-based
fallback for graphs whose conditioning inputs are not simple links.

---

## Verified

Tested against two synthetic graphs plus the real Qwen workflow:

| Graph | Positive resolved | Negative resolved | Prompt inject |
|---|---|---|---|
| Qwen (`prompt` + `negative_prompt`) | node 5, `prompt` | node 5, `negative_prompt` | OK |
| SDXL (separate `CLIPTextEncode` nodes using `text`, `UNETLoader`) | node 5, `text` | node 9 | OK |
| Real `qwen-image.json` | node 5, `prompt` | node 5, `negative_prompt` | OK |

The SDXL case caught a real bug during this work: the old heuristic only
recognised a negative node if it declared a `negative_prompt` field, which
separate SDXL encode nodes do not have. Reading the sampler's links fixed it.

---

## GPU support

### AMD (ROCm) — supported
Our code contains no CUDA-specific anything; it speaks HTTP and WebSocket to
ComfyUI. ROCm support is entirely a ComfyUI install concern:

```bash
comfy --skip-prompt install --amd
```

Notes:
- GGUF quants work on ROCm.
- Expect lower throughput than an equivalent NVIDIA card; the step-count
  reasoning in the README still holds but wall-clock times will be longer.
- If you hit OOM, reduce `width`/`height` in the workflow rather than steps.

### Intel Arc — partial
ComfyUI has an Intel IPEX/SYCL build. Caveats:
- **GGUF loading is weaker on Intel** than on CUDA/ROCm. If `UnetLoaderGGUF`
  fails, switch the workflow to `UNETLoader` with a safetensors checkpoint
  instead — the introspector already accepts both.
- Keep the model small (SDXL-class, not Qwen-class).

### Apple Silicon — supported
```bash
comfy --skip-prompt install --m-series
```
Use the MPS backend. 16 GB unified memory is the practical floor; 32 GB is
comfortable for SDXL-class work.

### CPU-only — not viable
A Qwen-class model at 1024² on CPU will take many minutes per image. The
progress bar will work; your patience will not. Use a small SD1.5-class model
if you must.

---

## Install portability

One native dependency: **`better-sqlite3`** (MemOS's storage driver). It
compiles per-OS/arch, which is the main cross-platform friction point.

pnpm blocks build scripts by default, so:

```bash
pnpm install
# If better-sqlite3 reports a build-script failure:
pnpm rebuild better-sqlite3
```

`onlyBuiltDependencies` in `pnpm-workspace.yaml` already permits `better-sqlite3`
and `esbuild`, so a clean clone should build without intervention. The
prebuilt binary ships for common platforms; only exotic architectures compile
from source.

Verify it loaded correctly:

```bash
node -e "const D=require('better-sqlite3'); new D(':memory:').exec('CREATE TABLE t(x)'); console.log('ok')"
```

Run that from inside `server/` — running it from your home directory picks up an
unrelated `node_modules` and reports a false failure.

---

## Known portability gaps (honest)

- **Comfy Desktop vs manual install.** Model paths differ. Comfy Desktop
  scans only the `modelsDirs` listed in its `settings.json`; a manual install
  scans its own `models/`. Our code reads models from whatever the running
  ComfyUI exposes, so either works — but you must put files where *your*
  install looks.
- **Launch flags matter and are not portable.** `--fast fp8_matrix_mult`
  degrades output quality on NVIDIA. It is set by Comfy Desktop, not by us. See
  `docs/comfyui-launch-flags.md`.
- **Recall leans on name matching.** MemOS 1.6.26's full-text search returns no
  rows for prose queries on our install. This is model-independent but
  SDK-version-dependent, so a different MemOS version may behave differently.
- **Only tested on Windows.** The code is plain Node + TypeScript with no
  platform-specific calls, and CI runs typecheck + build cross-platform, but
  runtime verification has been Windows-only.
