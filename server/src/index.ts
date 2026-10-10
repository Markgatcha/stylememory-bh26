import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { COMFYUI_URL, ensureDirs, WORKFLOW_FILE, IMAGES_DIR } from "./paths.js";
import { closeMemOS, getMemOS, NAMESPACE } from "./memory/memos.js";
import type { HealthResponse } from "./types.js";
import { loadGenerations, updateGeneration } from "./generations.js";
import {
  storeCharacter, updateCharacter, storeStyle, updateStyle,
  recallMemories, listCharacters, listStyles, listTraits, deleteTrait, deleteRecord,
  type RecalledMemory,
} from "./memory/records.js";
import { nextSeed } from "./seed-state.js";
import { processFeedback, listQuarantine, approveQuarantine, rejectQuarantine } from "./memory/feedback.js";
import { inspectAll, inspectHistory, inspectGraph } from "./memory/inspect.js";
import { runComparison } from "./compare.js";
import { runConsistencySuite, type ConsistencyReport, type ConsistencyOptions } from "./consistency.js";
import { startGeneration, type GenerateRequest, type GenerateResult } from "./generate-async.js";
import { getJob, subscribeJob, createJob, pushUpdate, finishJob, failJob } from "./jobs.js";
import { streamSSE } from "hono/streaming";

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
    milestone: "M4",
    comfyui: { reachable: comfyui.reachable, version: comfyui.version, url: COMFYUI_URL, error: comfyui.error },
    memos: { ready: true, count: memosCount, dbPath: NAMESPACE },
    workflow: { loaded: workflowLoaded, file: WORKFLOW_FILE },
    supersedeSupport,
  };

  return c.json(payload);
});

app.get("/", (c) => c.text("StyleMemory API — Banana Hacks 2026 — M2"));

// ─── Generate (async + SSE progress) ──────────────────────────────────────

app.post("/api/generate", async (c) => {
  const body = await c.req.json<GenerateRequest>();
  if (!body.prompt?.trim()) return c.json({ error: "prompt is required" }, 400);

  // Non-blocking: return the jobId, then stream progress over SSE.
  const jobId = startGeneration(body);
  return c.json({ jobId, streamUrl: `/api/progress/${jobId}` }, 202);
});

app.get("/api/progress/:jobId", (c) => {
  const jobId = c.req.param("jobId");
  const job = getJob<GenerateResult>(jobId);
  if (!job) return c.json({ error: "job not found" }, 404);

  return streamSSE(c, async (stream) => {
    // Replay everything emitted before this subscriber connected, so a late
    // or reconnecting client still sees the full history.
    for (const update of job.updates) {
      await stream.writeSSE({ data: JSON.stringify(update), event: update.stage });
    }

    if (job.status !== "running") {
      await stream.writeSSE({
        data: JSON.stringify(job.status === "done" ? job.result : { error: job.error }),
        event: job.status === "done" ? "result" : "failed",
      });
      await stream.close();
      return;
    }

    // Live updates are pushed by the job registry via this listener.
    const unsubscribe = subscribeJob(jobId, (update) => {
      void stream.writeSSE({ data: JSON.stringify(update), event: update.stage });
    });

    // Wait for terminal state. A keepalive comment is written every 15s so
    // proxies and the browser do not consider the connection idle and drop
    // it — without this the stream silently ends mid-generation.
    let aborted = false;
    stream.onAbort(() => {
      aborted = true;
    });

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        const j = getJob<GenerateResult>(jobId);
        if (aborted || !j || j.status !== "running") {
          clearInterval(check);
          clearInterval(keepalive);
          resolve();
        }
      }, 500);

      const keepalive = setInterval(() => {
        void stream.writeSSE({ data: "{}", event: "ping" });
      }, 15000);
    });

    unsubscribe();

    const final = getJob<GenerateResult>(jobId);
    if (final?.status === "done") {
      await stream.writeSSE({ data: JSON.stringify(final.result), event: "result" });
    } else if (final?.status === "error") {
      await stream.writeSSE({ data: JSON.stringify({ error: final.error }), event: "failed" });
    }
    await stream.close();
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

app.delete("/api/characters/:id", async (c) => {
  const id = c.req.param("id");
  const chars = await listCharacters();
  const existing = chars.find((ch) => ch.id === id);
  if (!existing) return c.json({ error: "character not found" }, 404);
  const ok = await deleteRecord(existing.memosNodeId);
  if (!ok) return c.json({ error: "delete failed" }, 500);
  return c.json({ ok: true });
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

app.delete("/api/styles/:id", async (c) => {
  const id = c.req.param("id");
  const styles = await listStyles();
  const existing = styles.find((s) => s.id === id);
  if (!existing) return c.json({ error: "style not found" }, 404);
  const ok = await deleteRecord(existing.memosNodeId);
  if (!ok) return c.json({ error: "delete failed" }, 500);
  return c.json({ ok: true });
});

// ─── Traits ───────────────────────────────────────────────────────────────

app.get("/api/traits", async (c) => c.json(await listTraits()));

app.delete("/api/traits/:nodeId", async (c) => {
  const ok = await deleteTrait(c.req.param("nodeId"));
  if (!ok) return c.json({ error: "trait not found" }, 404);
  return c.json({ ok: true });
});

// ─── Feedback (M3) ─────────────────────────────────────────────────────────

app.post("/api/generate/:id/feedback", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ feedback: "up" | "down"; note?: string }>();

  const gens = loadGenerations();
  const gen = gens.find((g) => g.id === id);
  if (!gen) return c.json({ error: "generation not found" }, 404);

  // Record the raw vote on the generation regardless of what we learn from it.
  updateGeneration(id, {
    feedback: body.feedback,
    feedbackNote: body.note ?? null,
  });

  // Derive a trait — stored directly, quarantined, or ignored as low-signal.
  const result = await processFeedback({
    generationId: id,
    generationPrompt: gen.prompt,
    feedback: body.feedback,
    note: body.note ?? null,
  });

  return c.json({ ok: true, ...result });
});

// ─── Quarantine (M3) ───────────────────────────────────────────────────────

app.get("/api/quarantine", (c) => {
  const status = c.req.query("status") as "pending" | "approved" | "rejected" | undefined;
  return c.json(listQuarantine(status));
});

app.post("/api/quarantine/:id/approve", async (c) => {
  const item = await approveQuarantine(c.req.param("id"));
  if (!item) return c.json({ error: "quarantine item not found or already resolved" }, 404);
  return c.json(item);
});

app.post("/api/quarantine/:id/reject", (c) => {
  const item = rejectQuarantine(c.req.param("id"));
  if (!item) return c.json({ error: "quarantine item not found or already resolved" }, 404);
  return c.json(item);
});

// ─── Memory inspector (M4) ────────────────────────────────────────────────

app.get("/api/inspect", async (c) => c.json(await inspectAll()));

app.get("/api/inspect/history/:appId", async (c) => {
  const chain = await inspectHistory(c.req.param("appId"));
  return c.json(chain);
});

app.get("/api/inspect/graph", async (c) => c.json(await inspectGraph()));

// ─── A/B comparison (M4) ──────────────────────────────────────────────────

app.post("/api/compare", async (c) => {
  const body = await c.req.json<{ prompt: string }>();
  if (!body.prompt?.trim()) return c.json({ error: "prompt is required" }, 400);
  try {
    const result = await runComparison(body.prompt);
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

// ─── Consistency suite (M5) ───────────────────────────────────────────────

app.post("/api/consistency", async (c) => {
  const body = await c.req.json<ConsistencyOptions>();
  if (!body.prompt?.trim()) return c.json({ error: "prompt is required" }, 400);

  // Long-running: N pairs of full generations. Run as a job so the browser
  // can stream progress instead of hanging on one request.
  const job = createJob<ConsistencyReport>();
  void (async () => {
    try {
      pushUpdate(job.id, { stage: "queued", message: "starting consistency suite" });
      const report = await runConsistencySuite({ ...body, jobId: job.id });
      finishJob(job.id, report);
    } catch (err) {
      failJob(job.id, err instanceof Error ? err.message : String(err));
    }
  })();

  return c.json({ jobId: job.id, streamUrl: `/api/progress/${job.id}` }, 202);
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
