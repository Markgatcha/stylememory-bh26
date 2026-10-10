/**
 * Generation records — JSON index of all generated images.
 * Each entry links the prompt, the memories used, the final enriched prompt,
 * and the output image filename.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { GENERATIONS_FILE } from "./paths.js";

export interface GenerationRecord {
  /** Our own UUID. */
  id: string;
  /** Unix ms timestamp. */
  createdAt: number;
  /** The user's original prompt. */
  prompt: string;
  /** The final enriched prompt actually sent to ComfyUI. */
  finalPrompt: string;
  /** IDs of MemOS memories that shaped this generation. */
  memoriesUsed: string[];
  /** Seed used (for reproducibility / before-after comparison). */
  seed: number;
  /** Output image filename (in ComfyUI output dir, copied to our images/). */
  imageFile: string;
  /** Width × height. */
  width: number;
  height: number;
  /** Steps used. */
  steps: number;
  /** CFG value. */
  cfg: number;
  /** ComfyUI prompt_id (for debugging). */
  comfyuiPromptId: string;
  /** User feedback: thumbs up / down, or null if not yet rated. */
  feedback: "up" | "down" | null;
  /** Optional user note on feedback. */
  feedbackNote: string | null;
}

export function loadGenerations(): GenerationRecord[] {
  if (!existsSync(GENERATIONS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(GENERATIONS_FILE, "utf-8")) as GenerationRecord[];
  } catch {
    return [];
  }
}

export function saveGenerations(records: GenerationRecord[]): void {
  writeFileSync(GENERATIONS_FILE, JSON.stringify(records, null, 2), "utf-8");
}

export function appendGeneration(record: GenerationRecord): void {
  const all = loadGenerations();
  all.unshift(record); // newest first
  saveGenerations(all);
}

export function findGeneration(id: string): GenerationRecord | undefined {
  return loadGenerations().find((r) => r.id === id);
}

export function updateGeneration(id: string, patch: Partial<GenerationRecord>): boolean {
  const all = loadGenerations();
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  all[idx] = { ...all[idx]!, ...patch };
  saveGenerations(all);
  return true;
}
