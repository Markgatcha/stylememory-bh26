/**
 * Async generation with live progress (M5).
 *
 * `/api/generate` used to block for the whole run (~50s) so the browser only
 * ever showed an elapsed counter. It now returns a jobId immediately and the
 * work continues in the background; the browser subscribes to
 * `GET /api/progress/:jobId` (SSE) for step-by-step updates.
 *
 * Progress is relayed from ComfyUI's own WebSocket, so the bar reflects real
 * sampler steps rather than a guess.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { IMAGES_DIR, WORKFLOW_FILE } from "./paths.js";
import { queuePrompt, waitForCompletion, fetchImage, streamProgress } from "./comfyui/client.js";
import { loadWorkflow } from "./comfyui/introspect.js";
import { recallMemories, type RecalledMemory } from "./memory/records.js";
import { buildEnrichedPrompt } from "./prompt/builder.js";
import { appendGeneration } from "./generations.js";
import { nextSeed } from "./seed-state.js";
import { createJob, pushUpdate, finishJob, failJob } from "./jobs.js";
import { createProgressModel } from "./progress-model.js";

export interface GenerateRequest {
  prompt: string;
  memoryOff?: boolean;
  seed?: number;
  steps?: number;
  width?: number;
  height?: number;
}

/**
 * Upper bound on the enriched prompt we will send.
 *
 * The text encoder has a finite context window; a prompt past it fails
 * somewhere inside ComfyUI with an error that does not name the real cause.
 * Memory enrichment only ever appends, so a long user prompt plus several
 * recalled memories is the realistic way to hit this. Fail here instead,
 * with a message that says what happened.
 */
const MAX_PROMPT_CHARS = 4000;

export interface GenerateResult {
  id: string;
  prompt: string;
  imageFile: string;
  imageUrl: string;
  finalPrompt: string;
  negativePrompt: string;
  memoriesUsed: RecalledMemory[];
  seed: number;
  width: number;
  height: number;
  steps: number;
}

/**
 * Kick off a generation and return its jobId without waiting.
 * The job resolves in the background; failures are reported through the
 * same stream rather than thrown, because there is no caller left to catch.
 */
export function startGeneration(req: GenerateRequest): string {
  const job = createJob<GenerateResult>();
  void runGeneration(job.id, req);
  return job.id;
}

async function runGeneration(jobId: string, req: GenerateRequest): Promise<void> {
  try {
    if (!req.prompt?.trim()) throw new Error("prompt is required");

    pushUpdate(jobId, { stage: "queued", message: "queued" });

    const workflow = loadWorkflow(WORKFLOW_FILE);

    // ── Recall + prompt build (local, fast, but worth reporting) ──────────
    let enriched = { positive: req.prompt, negative: "", memoriesUsed: [] as RecalledMemory[] };
    if (!req.memoryOff) {
      pushUpdate(jobId, { stage: "loading-model", message: "recalling memories" });
      const memories = await recallMemories(req.prompt);
      enriched = buildEnrichedPrompt(req.prompt, memories);
    }

    const patched = structuredClone(workflow.raw);

    // Patch the prompt through the input name the introspector resolved, so a
    // Qwen node (`prompt`) and a stock CLIPTextEncode node (`text`) both work
    // without this code knowing which model is in use.
    const posNode = patched[workflow.nodes.positive]!;

    if (enriched.positive.length > MAX_PROMPT_CHARS) {
      throw new Error(
        `Enriched prompt is ${enriched.positive.length} characters, over the ${MAX_PROMPT_CHARS} limit. ` +
          `Shorten the prompt or store fewer/shorter memories.`,
      );
    }

    posNode.inputs[workflow.nodes.positivePromptInput] = enriched.positive;
    if (enriched.negative && workflow.nodes.negativePromptInput) {
      posNode.inputs[workflow.nodes.negativePromptInput] = enriched.negative;
    }

    const sampler = patched[workflow.nodes.sampler]!;
    // Seed policy mirrors /api/generate: pinned seeds are used verbatim and
    // do not advance the rotation counter; unpinned seeds take lastSeed+1.
    if (req.seed !== undefined) {
      sampler.inputs.seed = req.seed;
    } else {
      sampler.inputs.seed = nextSeed();
    }
    // Steps: the Turbo checkpoint ships a distilled 8-step sigma schedule.
    // Raising this starves fine detail — see the note in index.ts.
    if (req.steps !== undefined) sampler.inputs.steps = req.steps;

    const latent = patched[workflow.nodes.latent]!;
    if (req.width !== undefined) latent.inputs.width = req.width;
    if (req.height !== undefined) latent.inputs.height = req.height;

    const width = latent.inputs.width as number;
    const height = latent.inputs.height as number;
    const steps = sampler.inputs.steps as number;
    const cfg = sampler.inputs.cfg as number;
    const seed = sampler.inputs.seed as number;

    // ── Stream live sampler progress from ComfyUI's WebSocket ─────────────
    // Order matters: the WS must be OPEN before the job is queued, and the
    // job must carry the same client_id, or ComfyUI accepts the prompt but
    // never routes progress events to this connection.
    //
    // The socket alone is NOT sufficient: measured on ComfyUI 0.39.0, two
    // identical runs delivered 16 progress_state frames and 1 respectively.
    // A bar fed only by the socket would sometimes sit at 0% for the whole
    // generation. So the socket drives the bar when it has data, and
    // createProgressModel's clock fallback keeps it moving when it does not.
    let resolved = false;
    const startedAt = Date.now();
    const model = createProgressModel({
      startedAt,
      totalSteps: steps,
      emit: (u) => {
        if (!resolved) pushUpdate(jobId, u);
      },
    });
    const ticker = setInterval(() => model.tick(), 1000);

    const ws = streamProgress(jobId, {
      onProgress: (value, max) => {
        if (resolved) return;
        model.onStep(value, max);
      },
      onStage: (msg) => {
        if (resolved) return;
        if (msg === "execution started") model.onStage("starting");
        else if (msg === "complete") model.onStage("decoding");
      },
      onDone: () => {
        if (resolved) return;
        model.onStage("decoding");
      },
    });

    await new Promise<void>((resolve) => {
      if (ws.readyState === WebSocket.OPEN) resolve();
      else ws.once("open", () => resolve());
    });

    pushUpdate(jobId, { stage: "loading-model", message: "queued on ComfyUI" });
    const queued = await queuePrompt(patched, jobId);

    let outputs: Record<string, unknown>;
    try {
      outputs = await waitForCompletion(queued.prompt_id);
    } finally {
      resolved = true;
      clearInterval(ticker);
      model.stop();
      ws.close();
    }

    // ── Save ──────────────────────────────────────────────────────────────
    pushUpdate(jobId, { stage: "saving", message: "saving image" });

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

    const record = {
      id: randomUUID(),
      createdAt: Date.now(),
      prompt: req.prompt,
      finalPrompt: enriched.positive,
      memoriesUsed: enriched.memoriesUsed.map((m) => m.id),
      seed,
      imageFile: localName,
      width,
      height,
      steps,
      cfg,
      comfyuiPromptId: queued.prompt_id,
      feedback: null as "up" | "down" | null,
      feedbackNote: null as string | null,
    };
    appendGeneration(record);

    finishJob<GenerateResult>(jobId, {
      id: record.id,
      prompt: record.prompt,
      imageFile: localName,
      imageUrl: `/images/${localName}`,
      finalPrompt: enriched.positive,
      negativePrompt: enriched.negative,
      memoriesUsed: enriched.memoriesUsed,
      seed,
      width,
      height,
      steps,
    });
  } catch (err) {
    failJob(jobId, err instanceof Error ? err.message : String(err));
  }
}
