# ComfyUI Launch Flags — VRAM & Quality Fix

**Changed:** Fri Oct 9, 2026 ~22:40 EDT
**File:** `%APPDATA%\Comfy Desktop\installations.json` → `[0].launchArgs`
**Backup:** `installations.json.bak-before-vram-fix`

## Before → After

```
OLD: --enable-manager --cache-lru 2 --fast fp8_matrix_mult --use-ck-attention
NEW: --enable-manager --cache-lru 0 --use-ck-attention
```

| Flag | Change | Reason |
|------|--------|--------|
| `--cache-lru 2` → `0` | changed | Was pinning 2 models resident. Removed so nothing is permanently held. |
| `--fast fp8_matrix_mult` | **removed** | **This was the actual quality fix.** FP8 matmuls caused the soft/"480p" subject and the color drift. Model runs at bf16 now. |
| `--use-ck-attention` | kept | Real memory optimization, no quality cost. |
| `--enable-manager` | kept | Needed for custom-node management. |

## Measured VRAM (RTX 5050 Laptop, 8 GB)

| Metric | Before | After |
|--------|--------|-------|
| `vram_total` | 8,518 MB | 8,123 MB |
| `torch_vram_total` | 4,127 MB | 3,904 MB |
| `torch_vram_free` (idle, post-gen) | 22 MB | 23 MB |

**Honest note:** the VRAM budget did NOT materially change — `--cache-lru 0`
did not raise the ceiling. ComfyUI still self-limits to ~3.8 GB on this card.
The quality gain came specifically from dropping `--fast fp8_matrix_mult`,
which had been forcing low-precision matmuls. The cache-lru change is still
correct (it stops 13.3 GB of models being demanded against a 3.8 GB budget),
but it was not what fixed the image quality.

## Verified Result

Vision-checked a fresh generation (seed 593103825222993):

- Subject (fox): individual fur strands, crisp whiskers, clean eye reflections
- Background: naturally blurred (shallow depth of field), as expected
- Colors: natural, warm, consistent — no banding, no drift
- No melting or texture blending

## To Revert

```
copy "%APPDATA%\Comfy Desktop\installations.json.bak-before-vram-fix" "%APPDATA%\Comfy Desktop\installations.json"
```
Then fully quit and reopen Comfy Desktop.

## Applying Flag Changes

Editing the JSON is NOT enough — a stale Python process keeps serving with
the old flags. To force a fresh launch:

```powershell
Get-CimInstance Win32_Process -Filter "name='python.exe'" |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

Comfy Desktop then respawns the server with the new args. Verify with:

```powershell
Get-CimInstance Win32_Process -Filter "name='python.exe'" |
  Select-Object -ExpandProperty CommandLine
```
