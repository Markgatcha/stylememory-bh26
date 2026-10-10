import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { COMFYUI_URL, ensureDirs, WORKFLOW_FILE } from "./paths.js";
import { closeMemOS, getMemOS, NAMESPACE } from "./memory/memos.js";
import type { HealthResponse } from "./types.js";
import { existsSync } from "node:fs";

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
    milestone: "M0",
    comfyui: { reachable: comfyui.reachable, version: comfyui.version, url: COMFYUI_URL, error: comfyui.error },
    memos: { ready: true, count: memosCount, dbPath: NAMESPACE },
    workflow: { loaded: workflowLoaded, file: WORKFLOW_FILE },
    supersedeSupport,
  };

  return c.json(payload);
});

app.get("/", (c) => c.text("StyleMemory API — Banana Hacks 2026 — M0 scaffold"));

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
