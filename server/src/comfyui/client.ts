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
export async function queuePrompt(
  workflow: Record<string, unknown>,
  clientId?: string,
): Promise<QueueResult> {
  // `client_id` is what binds this job to a WebSocket subscriber. Without it
  // ComfyUI accepts the job but sends no progress events to our /ws
  // connection — verified by probing the raw WS with and without the field.
  const body: Record<string, unknown> = { prompt: workflow };
  if (clientId) body.client_id = clientId;

  const res = await fetch(`${COMFYUI_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
 *
 * `clientId` is ComfyUI's way of addressing a subscriber; on a local install
 * any unique string works, and the queued job must carry the same value as
 * `client_id` or no events are routed here.
 *
 * Events actually observed on ComfyUI 0.39.0 (verified by probe):
 *   status, execution_start, execution_cached, executing, executed,
 *   execution_success, progress_state, progress
 *
 * NOTE: `progress` is NOT reliably emitted — a run that completed
 * successfully delivered every other type but zero `progress` frames. It
 * appears when the sampler reports intermediate steps, which is not
 * guaranteed. `progress_state` IS always delivered and carries the same
 * {value, max} payload per node, so we derive progress from that instead and
 * treat `progress` as a bonus.
 *
 * Callbacks:
 *   onProgress(value, max) — sampler step for the KSampler node
 *   onStage(text)          — human-readable stage transitions
 *   onDone()               — execution finished
 */
export function streamProgress(
  clientId: string,
  callbacks: {
    onProgress?: (value: number, max: number) => void;
    onStage?: (msg: string) => void;
    onDone?: () => void;
    onError?: (err: string) => void;
  },
): WebSocket {
  const wsUrl = COMFYUI_URL.replace(/^http/, "ws");
  const ws = new WebSocket(`${wsUrl}/ws?clientId=${clientId}`);

  let finished = false;

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const data = msg.data ?? {};

      switch (msg.type) {
        case "progress": {
          // value/max are the sampler's own counters.
          if (typeof data.value === "number" && typeof data.max === "number") {
            callbacks.onProgress?.(data.value, data.max);
          }
          break;
        }
        case "progress_state": {
          // { nodes: { "<id>": { value, max, state } } }
          const nodes = data.nodes as Record<string, { value?: number; max?: number }> | undefined;
          if (nodes) {
            // The KSampler is the node with max > 1; loader/encode nodes
            // report max 1 and would otherwise show as a spurious "1/1 step".
            for (const n of Object.values(nodes)) {
              if (typeof n.max === "number" && n.max > 1 &&
                  typeof n.value === "number") {
                callbacks.onProgress?.(n.value, n.max);
              }
            }
          }
          break;
        }
        case "execution_start":
          callbacks.onStage?.("execution started");
          break;
        case "executing":
          callbacks.onStage?.(data.node === null ? "finished" : `node ${String(data.node)}`);
          // `node: null` is ComfyUI's end-of-execution signal.
          if (data.node === null && !finished) {
            finished = true;
            callbacks.onDone?.();
            ws.close();
          }
          break;
        case "execution_success":
          callbacks.onStage?.("complete");
          break;
        case "executed":
          callbacks.onStage?.("node done");
          break;
        case "status":
          break;
      }
    } catch {
      // ignore malformed messages
    }
  });

  ws.on("error", (err) => callbacks.onError?.(err.message));

  return ws;
}
