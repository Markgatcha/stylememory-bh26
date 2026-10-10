# StyleMemory

An image studio that remembers. MemOS (@mem-os/sdk) stores characters, style profiles, and learned preferences; every ComfyUI + Qwen Image 2.1 generation is conditioned on that memory.

**Status:** M0 scaffold — API health check + UI shell. Generation lands in M1.

## Quickstart

```bash
pnpm install
pnpm install-scripts approve better-sqlite3 esbuild  # npm 12 blocks these by default
pnpm rebuild better-sqlite3
pnpm dev
```

- API: http://127.0.0.1:3001/api/health
- Web: http://127.0.0.1:5173

## Core loop

```
prompt → recall memories → enriched prompt → ComfyUI/Qwen → gallery → feedback → MemOS
```

Every image shows which memories shaped it.

## Milestones

| Milestone | Description | Status |
|-----------|-------------|--------|
| M0 | Scaffold, health check, UI shell | done |
| M1 | Generate from prompt through ComfyUI | pending |
| M2 | Characters + style profiles in MemOS | pending |
| M3 | Feedback loop + quarantine screen | pending |
| M4 | Memory inspector + before/after | pending |
| M5 | Polish + README + bugfixes | pending |
