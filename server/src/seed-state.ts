/**
 * Seed rotation — increments by 1 on every generation.
 *
 * Why: reusing one seed across many generations makes Qwen Image drift and
 * degrade (the user observed visible distortion). Each generation therefore
 * gets a fresh, monotonically increasing seed.
 *
 * State lives in `data/seed-state.json` so the counter survives restarts.
 * The starting value is read from the workflow's KSampler seed on first run.
 * Explicitly pinned seeds (before/after comparisons) do NOT advance the
 * counter — they bypass it entirely.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./paths.js";
import { loadWorkflow } from "./comfyui/introspect.js";
import { WORKFLOW_FILE } from "./paths.js";

const SEED_STATE_FILE = join(DATA_DIR, "seed-state.json");

interface SeedState {
  /** The seed used by the most recent generation. */
  lastSeed: number;
}

/** Read the workflow's configured seed — used to seed the counter on first run. */
function readWorkflowSeed(): number {
  try {
    const workflow = loadWorkflow(WORKFLOW_FILE);
    const seed = workflow.raw[workflow.nodes.sampler]?.inputs.seed;
    if (typeof seed === "number") return seed;
  } catch {
    // workflow missing or unparseable — fall through to default
  }
  return 0;
}

function readState(): SeedState {
  if (existsSync(SEED_STATE_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(SEED_STATE_FILE, "utf-8")) as SeedState;
      if (typeof parsed.lastSeed === "number") return parsed;
    } catch {
      // corrupt state file — re-seed from the workflow
    }
  }
  return { lastSeed: readWorkflowSeed() };
}

/**
 * Claim the next seed: lastSeed + 1, persisted immediately.
 * Safe under concurrent requests only because generation is serialised by
 * ComfyUI's own single-job queue in practice; the write is synchronous so
 * two overlapping calls still get distinct values (last write wins, and each
 * caller has already read a distinct value before either writes).
 */
export function nextSeed(): number {
  const state = readState();
  const seed = state.lastSeed + 1;
  writeFileSync(SEED_STATE_FILE, JSON.stringify({ lastSeed: seed }, null, 2), "utf-8");
  return seed;
}

/** The seed the next generation will use, without claiming it. */
export function peekNextSeed(): number {
  return readState().lastSeed + 1;
}
