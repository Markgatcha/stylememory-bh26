/**
 * A/B comparison (M4) — generate the same prompt twice with an identical
 * pinned seed, once with memory OFF and once with memory ON.
 *
 * The whole point is that seed and size are held constant, so any visual
 * difference is attributable to memory alone. That means:
 *   - the seed is generated ONCE here and passed to both runs
 *   - it does NOT come from the rotation counter, and does NOT advance it
 *     (otherwise the two runs would use different seeds and prove nothing)
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { IMAGES_DIR, WORKFLOW_FILE } from "./paths.js";
import { queuePrompt, waitForCompletion, fetchImage } from "./comfyui/client.js";
import { loadWorkflow } from "./comfyui/introspect.js";
import { recallMemories, type RecalledMemory } from "./memory/records.js";
import { buildEnrichedPrompt } from "./prompt/builder.js";
import { appendGeneration } from "./generations.js";

export interface AbArm {
  label: "memory-off" | "memory-on";
  imageFile: string;
  imageUrl: string;
  finalPrompt: string;
  negativePrompt: string;
  memoriesUsed: RecalledMemory[];
}

export interface AbResult {
  id: string;
  prompt: string;
  /** The single seed shared by both arms. */
  seed: number;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  arms: [AbArm, AbArm];
}

/**
 * Run one arm of the comparison. Shared by both sides so the only variable
 * between them is whether memory recall runs.
 *
 * Exported so the consistency suite can reuse the exact same code path —
 * a comparison is only meaningful if both features share it.
 */
export async function runArm(
  prompt: string,
  seed: number,
  memoryOff: boolean,
): Promise<AbArm> {
  const workflow = loadWorkflow(WORKFLOW_FILE);
  const patched = structuredClone(workflow.raw);

  let enriched = { positive: prompt, negative: "", memoriesUsed: [] as RecalledMemory[] };
  if (!memoryOff) {
    const memories = await recallMemories(prompt);
    enriched = buildEnrichedPrompt(prompt, memories);
  }

  const posNode = patched[workflow.nodes.positive]!;
  posNode.inputs.prompt = enriched.positive;
  if (enriched.negative && "negative_prompt" in posNode.inputs) {
    posNode.inputs.negative_prompt = enriched.negative;
  }

  // Seed and size are pinned by the caller — never taken from rotation state.
  const sampler = patched[workflow.nodes.sampler]!;
  sampler.inputs.seed = seed;

  const latent = patched[workflow.nodes.latent]!;
  const width = latent.inputs.width as number;
  const height = latent.inputs.height as number;
  const steps = sampler.inputs.steps as number;
  const cfg = sampler.inputs.cfg as number;

  const queued = await queuePrompt(patched);
  const outputs = await waitForCompletion(queued.prompt_id);

  let comfyFile = "";
  for (const [, out] of Object.entries(outputs)) {
    const o = out as { images?: Array<{ filename: string }> };
    if (o.images?.length) {
      comfyFile = o.images[0]!.filename;
      break;
    }
  }
  if (!comfyFile) throw new Error("no image in comfyui output");

  const buf = await fetchImage(comfyFile);
  const localName = `${randomUUID()}.png`;
  writeFileSync(join(IMAGES_DIR, localName), buf);

  return {
    label: memoryOff ? "memory-off" : "memory-on",
    imageFile: localName,
    imageUrl: `/images/${localName}`,
    finalPrompt: enriched.positive,
    negativePrompt: enriched.negative,
    memoriesUsed: enriched.memoriesUsed,
  };
}

/**
 * Run both arms sequentially. Sequential rather than parallel on purpose:
 * ComfyUI executes one job at a time, and interleaving would make the two
 * runs contend for the same VRAM budget.
 */
export async function runComparison(prompt: string): Promise<AbResult> {
  if (!prompt.trim()) throw new Error("prompt is required");

  // One seed for both arms. A random 32-bit-ish value in ComfyUI's range;
  // deliberately NOT nextSeed() — the comparison must not consume or depend
  // on rotation state.
  const seed = Math.floor(Math.random() * 2 ** 48);

  const off = await runArm(prompt, seed, true);
  const on = await runArm(prompt, seed, false);

  const id = randomUUID();

  // Record both arms in the gallery so they are reviewable afterwards.
  for (const arm of [off, on]) {
    appendGeneration({
      id: randomUUID(),
      createdAt: Date.now(),
      prompt,
      finalPrompt: arm.finalPrompt,
      memoriesUsed: arm.memoriesUsed.map((m) => m.id),
      seed,
      imageFile: arm.imageFile,
      width: 1024,
      height: 1024,
      steps: 8,
      cfg: 1,
      comfyuiPromptId: "",
      feedback: null,
      feedbackNote: null,
    });
  }

  return {
    id,
    prompt,
    seed,
    width: 1024,
    height: 1024,
    steps: 8,
    cfg: 1,
    arms: [off, on],
  };
}
