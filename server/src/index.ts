import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { COMFYUI_URL, ensureDirs, WORKFLOW_FILE, IMAGES_DIR } from "./paths.js";
import { closeMemOS, getMemOS, NAMESPACE } from "./memory/memos.js";
import type { HealthResponse } from "./types.js";
import { queuePrompt, waitForCompletion, fetchImage } from "./comfyui/client.js";
import { loadWorkflow } from "./comfyui/introspect.js";
import { appendGeneration, loadGenerations, updateGeneration } from "./generations.js";
import {
  storeCharacter, updateCharacter, storeStyle, updateStyle,
  recallMemories, listCharacters, listStyles, listTraits,
  type RecalledMemory,
} from "./memory/records.js";
import { buildEnrichedPrompt } from "./prompt/builder.js";
import { nextSeed } from "./seed-state.js";

ensureDirs();

const app = new Hono();

/** Probe ComfyUI with a short timeout. Returns version string or null if unreachable. */
async function probeComfyUI(): Promise<{ reachable: boolean; version?: string; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${COMFYUI_URL}/system_stats`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      return { reachable: false, error: `HTTP ${res.status}` };
    }
    const stats = (await res.json()) as { system?: { comfyui_version?: string } };
    return { reachable: true, version: stats.system?.comfyui_version ?? "unknown" };
  } catch (err) {
    return {
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

app.get("/api/health", async (c) => {
  const [comfyui, memos] = await Promise.all([probeComfyUI(), getMemOS()]);

  const memosCount = memos.count;

  // Probe supersede support — the function must exist at runtime for character edits.
  const supersedeSupport = typeof memos.supersede === "function";

  const workflowLoaded = existsSync(WORKFLOW_FILE);

  const payload: HealthResponse = {
    status: comfyui.reachable && supersedeSupport ? "ok" : "degraded",
    milestone: "M2",
    comfyui: { reachable: comfyui.reachable, version: comfyui.version, url: COMFYUI_URL, error: comfyui.error },
    memos: { ready: true, count: memosCount, dbPath: NAMESPACE },
    workflow: { loaded: workflowLoaded, file: WORKFLOW_FILE },
    supersedeSupport,
  };

  return c.json(payload);
});

app.get("/", (c) => c.text("StyleMemory API — Banana Hacks 2026 — M2"));

// ─── Generate ─────────────────────────────────────────────────────────────

interface GenerateRequest {
  prompt: string;
  memoryOff?: boolean;
  seed?: number;
  steps?: number;
  width?: number;
  height?: number;
}

app.post("/api/generate", async (c) => {
  const body = await c.req.json<GenerateRequest>();
  if (!body.prompt?.trim()) {
    return c.json({ error: "prompt is required" }, 400);
  }

  let workflow;
  try {
    workflow = loadWorkflow(WORKFLOW_FILE);
  } catch (err) {
    return c.json({ error: `workflow load failed: ${err}` }, 500);
  }

  // Recall memories (unless memoryOff)
  let enriched = { positive: body.prompt, negative: "", memoriesUsed: [] as RecalledMemory[] };
  if (!body.memoryOff) {
    const memories = await recallMemories(body.prompt);
    enriched = buildEnrichedPrompt(body.prompt, memories);
  }

  // Clone and patch the workflow
  const patched = structuredClone(workflow.raw);

  const posNode = patched[workflow.nodes.positive]!;
  posNode.inputs.prompt = enriched.positive;
  if (enriched.negative && "negative_prompt" in posNode.inputs) {
    posNode.inputs.negative_prompt = enriched.negative;
  }

  const sampler = patched[workflow.nodes.sampler]!;
  // Seed policy:
  //   - explicitly pinned seed (before/after comparison) → use it verbatim,
  //     do NOT advance the rotation counter
  //   - otherwise → claim the next rotated seed (lastSeed + 1). Reusing one
  //     seed across many generations visibly degrades Qwen Image output, so
  //     every unpinned generation gets a fresh one.
  if (body.seed !== undefined) {
    sampler.inputs.seed = body.seed;
  } else {
    sampler.inputs.seed = nextSeed();
  }
  if (body.steps !== undefined) sampler.inputs.steps = body.steps;

  const latent = patched[workflow.nodes.latent]!;
  if (body.width !== undefined) latent.inputs.width = body.width;
  if (body.height !== undefined) latent.inputs.height = body.height;

  // Queue and wait
  let queueResult;
  try {
    queueResult = await queuePrompt(patched);
  } catch (err) {
    return c.json({ error: `comfyui queue failed: ${err}` }, 502);
  }

  let outputs: Record<string, unknown>;
  try {
    outputs = await waitForCompletion(queueResult.prompt_id);
  } catch (err) {
    return c.json({ error: `comfyui generation failed: ${err}` }, 502);
  }

  // Find image output
  let imageFile = "";
  for (const [, out] of Object.entries(outputs)) {
    const o = out as { images?: Array<{ filename: string; subfolder: string; type: string }> };
    if (o.images?.length) {
      imageFile = o.images[0]!.filename;
      break;
    }
  }
  if (!imageFile) {
    return c.json({ error: "no image in comfyui output" }, 502);
  }

  // Download and save to gallery
  const imgBuffer = await fetchImage(imageFile);
  const localName = `${randomUUID()}.png`;
  writeFileSync(join(IMAGES_DIR, localName), imgBuffer);

  // Record
  const record = {
    id: randomUUID(),
    createdAt: Date.now(),
    prompt: body.prompt,
    finalPrompt: enriched.positive,
    memoriesUsed: enriched.memoriesUsed.map((m) => m.id),
    seed: (sampler.inputs.seed as number) ?? 0,
    imageFile: localName,
    width: (latent.inputs.width as number) ?? 1024,
    height: (latent.inputs.height as number) ?? 1024,
    steps: (sampler.inputs.steps as number) ?? 25,
    cfg: (sampler.inputs.cfg as number) ?? 1,
    comfyuiPromptId: queueResult.prompt_id,
    feedback: null as "up" | "down" | null,
    feedbackNote: null as string | null,
  };
  appendGeneration(record);

  return c.json({
    id: record.id,
    prompt: record.prompt,
    imageFile: localName,
    imageUrl: `/images/${localName}`,
    finalPrompt: enriched.positive,
    negativePrompt: enriched.negative,
    memoriesUsed: enriched.memoriesUsed,
    seed: record.seed,
    width: record.width,
    height: record.height,
  });
});

// ─── Gallery ──────────────────────────────────────────────────────────────

app.get("/api/gallery", (c) => {
  const gens = loadGenerations();
  return c.json(gens.map((g) => ({ ...g, imageUrl: `/images/${g.imageFile}` })));
});

app.get("/images/:filename", async (c) => {
  const filename = c.req.param("filename");
  const path = join(IMAGES_DIR, filename);
  if (!existsSync(path)) return c.notFound();
  const buf = await readFile(path);
  return new Response(buf, {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" },
  });
});

// ─── Characters ───────────────────────────────────────────────────────────

app.get("/api/characters", async (c) => c.json(await listCharacters()));

app.post("/api/characters", async (c) => {
  const body = await c.req.json<{ name: string; description?: string; appearance?: string; personality?: string }>();
  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);
  const char = await storeCharacter({
    name: body.name,
    description: body.description ?? "",
    appearance: body.appearance ?? "",
    personality: body.personality ?? "",
  });
  return c.json(char, 201);
});

app.put("/api/characters/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<Partial<{ name: string; description: string; appearance: string; personality: string }>>();
  const chars = await listCharacters();
  const existing = chars.find((ch) => ch.id === id);
  if (!existing) return c.json({ error: "character not found" }, 404);
  const updated = await updateCharacter(existing, body);
  return c.json(updated);
});

// ─── Styles ───────────────────────────────────────────────────────────────

app.get("/api/styles", async (c) => c.json(await listStyles()));

app.post("/api/styles", async (c) => {
  const body = await c.req.json<{ name: string; description?: string; palette?: string[]; styleTags?: string[] }>();
  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);
  const style = await storeStyle({
    name: body.name,
    description: body.description ?? "",
    palette: body.palette ?? [],
    styleTags: body.styleTags ?? [],
  });
  return c.json(style, 201);
});

app.put("/api/styles/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<Partial<{ name: string; description: string; palette: string[]; styleTags: string[] }>>();
  const styles = await listStyles();
  const existing = styles.find((s) => s.id === id);
  if (!existing) return c.json({ error: "style not found" }, 404);
  const updated = await updateStyle(existing, body);
  return c.json(updated);
});

// ─── Traits ───────────────────────────────────────────────────────────────

app.get("/api/traits", async (c) => c.json(await listTraits()));

// ─── Feedback ─────────────────────────────────────────────────────────────

app.post("/api/generate/:id/feedback", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ feedback: "up" | "down"; note?: string }>();
  const ok = updateGeneration(id, {
    feedback: body.feedback,
    feedbackNote: body.note ?? null,
  });
  if (!ok) return c.json({ error: "generation not found" }, 404);
  return c.json({ ok: true });
});

const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3001) }, (info) => {
  console.log(`[api] listening on http://127.0.0.1:${info.port}`);
});

// Clean shutdown — close MemOS before exiting.
process.on("SIGINT", async () => {
  console.log("\n[api] SIGINT — shutting down");
  await closeMemOS();
  server.close();
  process.exit(0);
});
