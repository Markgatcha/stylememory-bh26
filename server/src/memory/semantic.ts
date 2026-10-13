/**
 * Semantic recall — the optional model-backed leg.
 *
 * The word-overlap leg (records.ts) needs at least two shared content
 * words, so a prompt that describes a character without reusing any of
 * their stored words ("a boy doing tricks on a board") matches nothing.
 * True paraphrase recall needs embeddings. This module provides that as
 * a THIRD leg, additive and optional:
 *
 *   - `@huggingface/transformers` runs a small ONNX model locally
 *     (Xenova/bge-small-en-v1.5, q8 ≈ 33 MB — two orders of magnitude
 *     below the multi-GB download research-3.md rejected), no network at
 *     query time, no paid API.
 *   - Model choice was a measured bake-off (MiniLM-L6 / bge-small /
 *     e5-small / bge-base): bge-small q8 separated every positive from
 *     every negative on a 13-case battery (min positive 0.518, max
 *     negative 0.480); MiniLM-L6 did not (margin −0.053).
 *   - Any failure — package missing, model download blocked, ONNX
 *     broken — degrades to `null` and the leg simply stays off. Recall
 *     falls back to the word-overlap behavior, which is already shipped
 *     and verified. The demo never depends on this leg being alive.
 */


const MODEL = "Xenova/bge-small-en-v1.5";

/** Minimum cosine similarity before a semantic hit is recalled. */
export const SEMANTIC_MIN_COSINE = 0.5;

/** Kill switch: STYLEMEMORY_SEMANTIC=0 disables the leg for the process. */
const KILL_SWITCH = process.env.STYLEMEMORY_SEMANTIC === "0";

type Extractor = (
  texts: string | string[],
  opts: { pooling: "mean"; normalize: true },
) => Promise<{ data: Float32Array | number[]; dims: number[] }>;

let extractor: Extractor | null = null;
let initStarted = false;
let initFailed = false;

/** Lazy-load the embedding model. Returns null (and logs once) on any failure. */
async function getExtractor(): Promise<Extractor | null> {
  if (extractor) return extractor;
  if (initFailed) return null;
  if (KILL_SWITCH) {
    initFailed = true;
    console.log("[semantic] disabled by STYLEMEMORY_SEMANTIC=0");
    return null;
  }
  if (initStarted) return null; // in-flight — next call will see the result
  initStarted = true;
  try {
    const mod = (await import("@huggingface/transformers")) as {
      pipeline: (
        task: string,
        model: string,
        opts: { dtype: string },
      ) => Promise<Extractor>;
    };
    extractor = await mod.pipeline("feature-extraction", MODEL, {
      dtype: "q8",
    });
    console.log(`[semantic] ready — ${MODEL} (q8)`);
    return extractor;
  } catch (err) {
    initFailed = true;
    console.warn(
      `[semantic] disabled — ${
        err instanceof Error ? err.message.slice(0, 160) : String(err)
      }`,
    );
    return null;
  }
}

/**
 * Warm the model in the background at boot so the first generation does
 * not pay the load (and, on first ever run, the ~33 MB download) inline.
 * Fire-and-forget: never throws, never blocks startup.
 */
export function warmSemantic(): void {
  void getExtractor();
}

/** Whether the semantic leg can (probably) run. Cheap, no model load. */
export function semanticEnabled(): boolean {
  return !initFailed;
}

/** Embed one or more texts into normalized vectors (same order). */
export async function embedBatch(texts: string[]): Promise<number[][] | null> {
  const ext = await getExtractor();
  if (!ext) return null;
  try {
    const out = await ext(texts, { pooling: "mean", normalize: true });
    const dim = out.dims[out.dims.length - 1];
    if (!dim || out.data.length < dim) return null;
    const rows = Math.floor(out.data.length / dim);
    const vectors: number[][] = [];
    for (let r = 0; r < rows; r += 1) {
      vectors.push(Array.from(out.data.slice(r * dim, (r + 1) * dim)));
    }
    return vectors;
  } catch (err) {
    console.warn(
      `[semantic] embed failed — ${
        err instanceof Error ? err.message.slice(0, 160) : String(err)
      }`,
    );
    return null;
  }
}

/** Cosine similarity for two normalized vectors. */
export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += a[i]! * b[i]!;
  return sum;
}
