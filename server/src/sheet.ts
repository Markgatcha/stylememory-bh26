/**
 * 4-panel consistency mode.
 *
 * Generates the same prompt four times with four DISTINCT pinned seeds at the
 * same size, producing the classic character-consistency sheet.
 *
 * Design notes, both verified against the running ComfyUI rather than assumed:
 *
 * 1. Four sequential generations, not one batched job.
 *    `TextEncodeQwenImage21.prompt` is a single STRING — ComfyUI will not
 *    accept a list of prompts through it. `EmptyLatentImage.batch_size` can
 *    batch, but with one prompt that produces four images sharing the same
 *    composition, which is not what a consistency sheet means. Distinct seeds
 *    are the point.
 *
 * 2. Seeds are distinct AND reproducible. Each panel's seed is returned in the
 *    result, so anyone can regenerate a specific panel and get the same image.
 *    They are deliberately NOT drawn from the rotation counter — the sheet is a
 *    fixed artifact, and consuming rotation state would silently change what
 *    other generations get.
 *
 * 3. A partial failure is still a result. If panel 3 fails, panels 1-2 are
 *    returned rather than throwing away two minutes of GPU time. The failed
 *    panel is reported as null with its error.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { IMAGES_DIR } from "./paths.js";
import { runArm } from "./compare.js";
import { pushUpdate, type JobUpdate } from "./jobs.js";

export interface Panel {
  /** 1-4, matching the on-screen position. */
  index: number;
  seed: number;
  imageFile: string | null;
  imageUrl: string | null;
  finalPrompt: string;
  memoriesUsedCount: number;
  error?: string;
}

export interface SheetResult {
  id: string;
  prompt: string;
  width: number;
  height: number;
  steps: number;
  /** True when memory was applied to all panels. */
  memoryOn: boolean;
  panels: Panel[];
  /** Panels that produced an image. */
  completed: number;
  createdAt: number;
  elapsedSeconds: number;
}

export interface SheetOptions {
  prompt: string;
  /** Default 4. Clamped to 1-8. */
  panels?: number;
  /** Apply memory recall. Default true — a sheet is for checking consistency. */
  memoryOn?: boolean;
  /** Job id for per-panel progress. Optional. */
  jobId?: string;
  /** Explicit seeds. When omitted, four distinct random seeds are generated. */
  seeds?: number[];
}

const MAX_PANELS = 8;

/**
 * Build a consistency sheet.
 *
 * Sequential by necessity: ComfyUI executes one job at a time, and
 * interleaving would make panels contend for the same VRAM budget. Expect
 * roughly (panels × 50s).
 */
export async function runSheet(opts: SheetOptions): Promise<SheetResult> {
  const prompt = opts.prompt?.trim();
  if (!prompt) throw new Error("prompt is required");

  const count = Math.max(1, Math.min(MAX_PANELS, opts.panels ?? 4));
  const memoryOn = opts.memoryOn !== false;
  const startedAt = Date.now();

  const seeds =
    opts.seeds && opts.seeds.length >= count
      ? opts.seeds.slice(0, count)
      : Array.from({ length: count }, () => Math.floor(Math.random() * 2 ** 48));

  const report = (u: JobUpdate, panelIndex: number) => {
    if (!opts.jobId) return;
    pushUpdate(opts.jobId, {
      ...u,
      // Fold the panel index into the percentage so a 4-panel sheet reads as
      // one progress bar, not four restarts.
      pct: Math.round(((panelIndex - 1 + (u.pct ?? 0) / 100) / count) * 100),
      message: `panel ${panelIndex}/${count} — ${u.message ?? u.stage}`,
    });
  };

  const panels: Panel[] = [];

  for (let i = 0; i < count; i++) {
    const seed = seeds[i]!;
    report({ stage: "loading-model", message: "generating", pct: 0 }, i + 1);

    try {
      const arm = await runArm(prompt, seed, !memoryOn);
      panels.push({
        index: i + 1,
        seed,
        imageFile: arm.imageFile,
        imageUrl: `/images/${arm.imageFile}`,
        finalPrompt: arm.finalPrompt,
        memoriesUsedCount: arm.memoriesUsed.length,
      });
      report({ stage: "saving", message: "done", pct: 100 }, i + 1);
    } catch (err) {
      // Keep going: a partial sheet is more useful than none.
      panels.push({
        index: i + 1,
        seed,
        imageFile: null,
        imageUrl: null,
        finalPrompt: "",
        memoriesUsedCount: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const result: SheetResult = {
    id: randomUUID(),
    prompt,
    width: 1024,
    height: 1024,
    steps: 8,
    memoryOn,
    panels,
    completed: panels.filter((p) => p.imageFile !== null).length,
    createdAt: Date.now(),
    elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
  };

  // Persist so the sheet survives a refresh and can be cited later.
  const dir = join(IMAGES_DIR, "..");
  writeFileSync(join(dir, "sheets.json"), JSON.stringify(result, null, 2), "utf-8");

  return result;
}
