/**
 * ComfyUI API client — queues workflows, streams progress, fetches results.
 *
 * Endpoints used:
 *   POST /prompt              — queue a workflow
 *   GET  /history/{id}        — poll for completion
 *   GET  /view?filename=...   — download a generated image
 *   WS   /ws?clientId=...     — real-time progress events
 */
import WebSocket from "ws";

const COMFYUI_URL = process.env.COMFYUI_URL ?? "http://127.0.0.1:8188";

export interface QueueResult {
  prompt_id: string;
  number: number;
}

export interface ProgressEvent {
  type: "progress" | "executing" | "executed" | "error" | "status";
  data: Record<string, unknown>;
}

/** Queue a workflow and return the prompt_id. */
export async function queuePrompt(workflow: Record<string, unknown>): Promise<QueueResult> {
  const res = await fetch(`${COMFYUI_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ComfyUI /prompt failed (${res.status}): ${err}`);
  }
  return (await res.json()) as QueueResult;
}

/** Poll history until the prompt is done. Returns the outputs dict. */
export async function waitForCompletion(
  promptId: string,
  timeoutMs = 600_000,
  pollMs = 2000,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${COMFYUI_URL}/history/${promptId}`);
    if (!res.ok) throw new Error(`history ${res.status}`);
    const hist = (await res.json()) as Record<string, { outputs?: Record<string, unknown>; status?: Record<string, unknown> }>;
    const entry = hist[promptId];
    if (entry?.outputs) return entry.outputs;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`ComfyUI generation timed out after ${timeoutMs / 1000}s`);
}

/** Download an image from ComfyUI's output. */
export async function fetchImage(filename: string, subfolder = "", type = "output"): Promise<Buffer> {
  const params = new URLSearchParams({ filename, subfolder, type });
  const res = await fetch(`${COMFYUI_URL}/view?${params}`);
  if (!res.ok) throw new Error(`view ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Stream progress over WebSocket.
 * Calls onProgress with {value, max} for each step, onDone when finished.
 */
export function streamProgress(
  clientId: string,
  promptId: string,
  callbacks: {
    onProgress?: (value: number, max: number) => void;
    onStatus?: (msg: string) => void;
    onDone?: () => void;
    onError?: (err: string) => void;
  },
): WebSocket {
  const wsUrl = COMFYUI_URL.replace(/^http/, "ws");
  const ws = new WebSocket(`${wsUrl}/ws?clientId=${clientId}`);

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "progress") {
        callbacks.onProgress?.(msg.data.value, msg.data.max);
      } else if (msg.type === "executing") {
        if (msg.data.node === null) {
          callbacks.onDone?.();
          ws.close();
        }
      } else if (msg.type === "executed") {
        if (msg.data.prompt_id === promptId) {
          callbacks.onStatus?.(`executed node ${msg.data.node}`);
        }
      } else if (msg.type === "status") {
        callbacks.onStatus?.(JSON.stringify(msg.data));
      }
    } catch {
      // ignore malformed messages
    }
  });

  ws.on("error", (err) => callbacks.onError?.(err.message));

  return ws;
}
