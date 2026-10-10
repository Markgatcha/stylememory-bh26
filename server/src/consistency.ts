/**
 * Consistency Score (M5).
 *
 * Runs the same prompt N times as a same-seed A/B and reports how much the
 * memory layer actually changes the output. Turns "it remembers" into a
 * number a reader can check.
 *
 * What is measured
 * ----------------
 * Two independent signals per run:
 *
 *  1. Pixel divergence — mean absolute per-channel difference between the
 *     memory-OFF and memory-ON images, over a downsampled grayscale
 *     projection. Same seed and same size means the *only* difference is the
 *     prompt conditioning, so this is a direct measure of how much memory
 *     steered generation.
 *
 *  2. Trait recall rate — the fraction of runs where the memory-ON arm
 *     actually recalled at least one memory. A prompt that matches nothing
 *     stored produces an identical image, and the score should say so rather
 *     than claim credit.
 *
 * The score is reported per run and as a mean, with the seeds listed so any
 * single result can be reproduced.
 *
 * Honest limits
 * -------------
 * Pixel divergence is a proxy, not a perceptual metric: it says the images
 * differ, not that the memory-ON one is better. Judging "better" needs a
 * human or a learned metric. The recall rate is the part that actually
 * evidences memory doing work; divergence says how loudly.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { IMAGES_DIR } from "./paths.js";
import { runArm } from "./compare.js";
import { pushUpdate, type JobUpdate } from "./jobs.js";

export interface ConsistencyRun {
  index: number;
  seed: number;
  /** Mean absolute grayscale difference, 0-255. */
  pixelDelta: number;
  /** Same, normalised to 0-1 for readability. */
  normalisedDelta: number;
  /** Fraction of sampled pixels that differ by more than a visible threshold. */
  changedFraction: number;
  /** Did the memory-ON arm recall anything? */
  recalled: boolean;
  memoriesUsedCount: number;
  offImage: string;
  onImage: string;
}

export interface ConsistencyReport {
  id: string;
  prompt: string;
  runs: number;
  width: number;
  height: number;
  steps: number;
  createdAt: number;
  results: ConsistencyRun[];
  meanNormalisedDelta: number;
  meanChangedFraction: number;
  /** Runs where memory recalled at least one memory / total runs. */
  recallRate: number;
  /** Wall-clock seconds for the whole report. */
  elapsedSeconds: number;
}

/** Sample a PNG down to this width for comparison. Full-res diff is wasteful. */
const SAMPLE_WIDTH = 128;
/** Per-pixel grayscale difference above this counts as "visibly changed". */
const VISIBLE_THRESHOLD = 12;

interface GreyImage {
  width: number;
  height: number;
  /** Luma values, length width*height, each 0-255. */
  data: Float32Array;
}

/** Decode a PNG and project to grayscale at a fixed sample width. */
function toGreySampled(path: string): GreyImage {
  const png = PNG.sync.read(readFileSync(path));
  const { width: srcW, height: srcH, data: src } = png;

  const aspect = srcH / srcW;
  const w = Math.min(SAMPLE_WIDTH, srcW);
  const h = Math.max(1, Math.round(w * aspect));

  const out = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    // Nearest-neighbour row mapping — adequate for a divergence estimate and
    // far cheaper than a resampling kernel.
    const sy = Math.min(srcH - 1, Math.floor((y / h) * srcH));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x / w) * srcW));
      const si = (sy * srcW + sx) * 4;
      // Rec. 601 luma.
      const luma = 0.299 * src[si]! + 0.587 * src[si + 1]! + 0.114 * src[si + 2]!;
      out[y * w + x] = luma;
    }
  }

  return { width: w, height: h, data: out };
}

/** Compare two sampled grayscale images. Returns absolute and relative deltas. */
function diffGrey(a: GreyImage, b: GreyImage): {
  meanDelta: number;
  changedFraction: number;
} {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `image size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`,
    );
  }

  const n = a.data.length;
  let sum = 0;
  let changed = 0;

  for (let i = 0; i < n; i++) {
    const d = Math.abs(a.data[i]! - b.data[i]!);
    sum += d;
    if (d > VISIBLE_THRESHOLD) changed++;
  }

  return {
    meanDelta: sum / n,
    changedFraction: changed / n,
  };
}

export interface ConsistencyOptions {
  prompt: string;
  /** How many same-seed pairs to run. Each pair is two full generations. */
  runs?: number;
  /** Job id to report per-run progress against. Optional. */
  jobId?: string;
}

/**
 * Run the comparison suite.
 *
 * Sequential by necessity: ComfyUI executes one job at a time, and
 * interleaving would make the two arms contend for the same VRAM budget.
 * Expect roughly (runs * 2 * ~50s).
 */
export async function runConsistencySuite(
  opts: ConsistencyOptions,
): Promise<ConsistencyReport> {
  const prompt = opts.prompt?.trim();
  if (!prompt) throw new Error("prompt is required");

  const runs = Math.max(1, Math.min(50, opts.runs ?? 3));
  const startedAt = Date.now();
  const results: ConsistencyRun[] = [];

  for (let i = 0; i < runs; i++) {
    const report = (u: JobUpdate) => {
      if (opts.jobId) {
        pushUpdate(opts.jobId, {
          ...u,
          // Fold the pair index into the percentage so a 40-minute suite is
          // legible instead of a black box.
          pct: Math.round(((i + (u.pct ?? 0) / 100) / runs) * 100),
          message: `pair ${i + 1}/${runs} — ${u.message ?? u.stage}`,
        });
      }
    };

    report({ stage: "loading-model", message: "memory off" });

    // Fresh random seed per run — never the rotation counter, and never
    // reused, so each pair is an independent sample.
    const seed = Math.floor(Math.random() * 2 ** 48);

    const off = await runArm(prompt, seed, true);
    const on = await runArm(prompt, seed, false);

    report({ stage: "saving", message: "measuring", pct: 95 });

    const offPath = join(IMAGES_DIR, off.imageFile);
    const onPath = join(IMAGES_DIR, on.imageFile);

    const { meanDelta, changedFraction } = diffGrey(
      toGreySampled(offPath),
      toGreySampled(onPath),
    );

    results.push({
      index: i + 1,
      seed,
      pixelDelta: meanDelta,
      normalisedDelta: meanDelta / 255,
      changedFraction,
      recalled: on.memoriesUsed.length > 0,
      memoriesUsedCount: on.memoriesUsed.length,
      offImage: off.imageFile,
      onImage: on.imageFile,
    });
  }

  const meanNormalisedDelta =
    results.reduce((s, r) => s + r.normalisedDelta, 0) / results.length;
  const meanChangedFraction =
    results.reduce((s, r) => s + r.changedFraction, 0) / results.length;
  const recallRate =
    results.filter((r) => r.recalled).length / results.length;

  const report: ConsistencyReport = {
    id: randomUUID(),
    prompt,
    runs,
    width: 1024,
    height: 1024,
    steps: 8,
    createdAt: Date.now(),
    results,
    meanNormalisedDelta,
    meanChangedFraction,
    recallRate,
    elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
  };

  // Persist so the result survives a refresh and can be cited later.
  const dir = join(IMAGES_DIR, "..");
  if (existsSync(dir)) {
    writeFileSync(
      join(dir, "consistency-reports.json"),
      JSON.stringify(report, null, 2),
      "utf-8",
    );
  }

  return report;
}
