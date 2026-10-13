import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve project root from this file: server/src/paths.ts → server/src → server → project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const PROJECT_ROOT = resolve(__dirname, "..", "..");

export const DATA_DIR = join(PROJECT_ROOT, "data");
export const IMAGES_DIR = join(DATA_DIR, "images");
export const GENERATIONS_FILE = join(DATA_DIR, "generations.json");
/** Overridable so tests/verification can run against a scratch DB. */
export const DB_PATH =
  process.env.STYLEMEMORY_DB ?? join(DATA_DIR, "stylememory.db");
export const WORKFLOW_FILE = join(PROJECT_ROOT, "workflow", "qwen-image.json");

export const COMFYUI_URL = process.env.COMFYUI_URL ?? "http://127.0.0.1:8188";
export const PORT = Number(process.env.PORT ?? 3001);

/** Create all runtime directories. Called once at boot. */
export function ensureDirs(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(IMAGES_DIR, { recursive: true });
}
