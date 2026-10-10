export interface HealthResponse {
  status: "ok" | "degraded";
  milestone: string;
  comfyui: { reachable: boolean; version?: string; url: string; error?: string };
  memos: { ready: boolean; count: number; dbPath: string; error?: string };
  workflow: { loaded: boolean; file: string; error?: string };
  supersedeSupport: boolean;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error(`health check failed: ${res.status}`);
  return res.json() as Promise<HealthResponse>;
}

// ─── Characters ───────────────────────────────────────────────────────────

export interface Character {
  id: string;
  memosNodeId: string;
  name: string;
  description: string;
  appearance: string;
  personality: string;
  createdAt: number;
  updatedAt: number;
}

export async function fetchCharacters(): Promise<Character[]> {
  const res = await fetch("/api/characters");
  return res.json() as Promise<Character[]>;
}

export async function createCharacter(data: { name: string; description?: string; appearance?: string; personality?: string }): Promise<Character> {
  const res = await fetch("/api/characters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json() as Promise<Character>;
}

export async function updateCharacter(id: string, data: Partial<Character>): Promise<Character> {
  const res = await fetch(`/api/characters/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json() as Promise<Character>;
}

// ─── Styles ───────────────────────────────────────────────────────────────

export interface StyleProfile {
  id: string;
  memosNodeId: string;
  name: string;
  description: string;
  palette: string[];
  styleTags: string[];
  createdAt: number;
  updatedAt: number;
}

export async function fetchStyles(): Promise<StyleProfile[]> {
  const res = await fetch("/api/styles");
  return res.json() as Promise<StyleProfile[]>;
}

export async function createStyle(data: { name: string; description?: string; palette?: string[]; styleTags?: string[] }): Promise<StyleProfile> {
  const res = await fetch("/api/styles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json() as Promise<StyleProfile>;
}

export async function updateStyle(id: string, data: Partial<StyleProfile>): Promise<StyleProfile> {
  const res = await fetch(`/api/styles/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json() as Promise<StyleProfile>;
}

export async function deleteCharacter(id: string): Promise<void> {
  await fetch(`/api/characters/${id}`, { method: "DELETE" });
}

export async function deleteStyle(id: string): Promise<void> {
  await fetch(`/api/styles/${id}`, { method: "DELETE" });
}

// ─── Generate ─────────────────────────────────────────────────────────────

export interface RecalledMemory {
  id: string;
  content: string;
  tags: string[];
  kind: string;
  reason: string;
  score: number;
}

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
}

/** What POST /api/generate returns: a handle, not the image. */
export interface GenerateTicket {
  jobId: string;
  streamUrl: string;
}

export type JobStage =
  | "queued"
  | "loading-model"
  | "sampling"
  | "decoding"
  | "saving"
  | "done"
  | "error";

export interface JobUpdate {
  stage: JobStage;
  value?: number;
  max?: number;
  pct?: number;
  message?: string;
}

/** Queue a generation. Resolves immediately with a job handle. */
export async function startGenerate(data: {
  prompt: string;
  memoryOff?: boolean;
  seed?: number;
  steps?: number;
  width?: number;
  height?: number;
}): Promise<GenerateTicket> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error ?? "generation failed");
  }
  return res.json() as Promise<GenerateTicket>;
}

/**
 * Subscribe to a job's progress over SSE.
 *
 * `onUpdate` fires for every stage transition and every sampler step.
 * `onResult` fires once with the finished generation; `onError` on failure.
 * Returns an unsubscribe function.
 */
export function subscribeJob(
  ticket: GenerateTicket,
  handlers: {
    onUpdate?: (u: JobUpdate) => void;
    onResult?: (r: GenerateResult) => void;
    onError?: (msg: string) => void;
  },
): () => void {
  const es = new EventSource(ticket.streamUrl);
  let closed = false;

  const stages: JobStage[] = ["queued", "loading-model", "sampling", "decoding", "saving", "done", "error"];
  for (const stage of stages) {
    es.addEventListener(stage, (ev) => {
      if (closed) return;
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        if (stage === "done") {
          handlers.onUpdate?.({ stage: "done", pct: 100 });
        } else {
          handlers.onUpdate?.(data as JobUpdate);
        }
      } catch {
        // malformed frame — ignore
      }
    });
  }

  // The terminal events are emitted with their own names too; listen for both
  // spellings so a reconnect that misses the stage frame still resolves.
  es.addEventListener("result", (ev) => {
    if (closed) return;
    try {
      handlers.onResult?.(JSON.parse((ev as MessageEvent).data) as GenerateResult);
    } catch { /* ignore */ }
  });

  es.addEventListener("failed", (ev) => {
    if (closed) return;
    try {
      handlers.onError?.((JSON.parse((ev as MessageEvent).data) as { error?: string }).error ?? "generation failed");
    } catch { /* ignore */ }
  });

  es.onerror = () => {
    // EventSource auto-reconnects; only surface an error if it gave up.
    if (es.readyState === EventSource.CLOSED) {
      handlers.onError?.("progress stream closed");
    }
  };

  return () => {
    closed = true;
    es.close();
  };
}

// ─── Gallery ──────────────────────────────────────────────────────────────

export interface GenerationRecord {
  id: string;
  createdAt: number;
  prompt: string;
  finalPrompt: string;
  memoriesUsed: string[];
  seed: number;
  imageFile: string;
  imageUrl: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  feedback: "up" | "down" | null;
  feedbackNote: string | null;
}

export async function fetchGallery(): Promise<GenerationRecord[]> {
  const res = await fetch("/api/gallery");
  return res.json() as Promise<GenerationRecord[]>;
}

/** What the server decided to do with a feedback submission. */
export interface FeedbackOutcome {
  ok: boolean;
  outcome: "stored" | "quarantined" | "ignored";
  trait?: string;
  quarantineId?: string;
  message: string;
}

export async function submitFeedback(id: string, feedback: "up" | "down", note?: string): Promise<FeedbackOutcome> {
  const res = await fetch(`/api/generate/${id}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feedback, note }),
  });
  return res.json() as Promise<FeedbackOutcome>;
}

// ─── Quarantine (M3) ──────────────────────────────────────────────────────

export interface QuarantineItem {
  id: string;
  createdAt: number;
  kind: "avoid" | "prefer";
  text: string;
  rawNote: string | null;
  generationId: string;
  generationPrompt: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
}

export async function fetchQuarantine(): Promise<QuarantineItem[]> {
  const res = await fetch("/api/quarantine");
  return res.json() as Promise<QuarantineItem[]>;
}

export async function approveQuarantine(id: string): Promise<void> {
  await fetch(`/api/quarantine/${id}/approve`, { method: "POST" });
}

export async function rejectQuarantine(id: string): Promise<void> {
  await fetch(`/api/quarantine/${id}/reject`, { method: "POST" });
}

// ─── Traits (M3) ──────────────────────────────────────────────────────────

export interface LearnedTrait {
  id: string;
  memosNodeId: string;
  kind: "avoid" | "prefer";
  text: string;
  sourceGenerationId: string;
  createdAt: number;
}

export async function fetchTraits(): Promise<LearnedTrait[]> {
  const res = await fetch("/api/traits");
  return res.json() as Promise<LearnedTrait[]>;
}

export async function deleteTrait(memosNodeId: string): Promise<void> {
  await fetch(`/api/traits/${memosNodeId}`, { method: "DELETE" });
}

// ─── Memory inspector (M4) ────────────────────────────────────────────────

export interface InspectedMemory {
  id: string;
  memosNodeId: string;
  kind: string;
  content: string;
  summary: string;
  tags: string[];
  importance: number;
  trustScore: number;
  source: string;
  createdAt: number;
  updatedAt: number;
  accessCount: number;
  superseded: boolean;
}

export async function fetchInspect(): Promise<InspectedMemory[]> {
  const res = await fetch("/api/inspect");
  return res.json() as Promise<InspectedMemory[]>;
}

export async function fetchHistory(appId: string): Promise<InspectedMemory[]> {
  const res = await fetch(`/api/inspect/history/${appId}`);
  return res.json() as Promise<InspectedMemory[]>;
}

// ─── A/B comparison (M4) ──────────────────────────────────────────────────

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
  seed: number;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  arms: [AbArm, AbArm];
}

export async function runCompare(prompt: string): Promise<AbResult> {
  const res = await fetch("/api/compare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error ?? "comparison failed");
  }
  return res.json() as Promise<AbResult>;
}

// ─── Consistency suite (M5) ───────────────────────────────────────────────

export interface ConsistencyRun {
  index: number;
  seed: number;
  pixelDelta: number;
  normalisedDelta: number;
  changedFraction: number;
  recalled: boolean;
  memoriesUsedCount: number;
  offImage: string;
  onImage: string;
}

export interface ConsistencyReport {
  id: string;
  prompt: string;
  runs: number;
  width: number;
  height: number;
  steps: number;
  createdAt: number;
  results: ConsistencyRun[];
  meanNormalisedDelta: number;
  meanChangedFraction: number;
  recallRate: number;
  elapsedSeconds: number;
}

export interface GenerateTicket {
  jobId: string;
  streamUrl: string;
}

export async function startConsistency(data: { prompt: string; runs?: number }): Promise<GenerateTicket> {
  const res = await fetch("/api/consistency", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error ?? "consistency suite failed");
  }
  return res.json() as Promise<GenerateTicket>;
}

/** Subscribe to a consistency job; the result arrives as a `result` event. */
export function subscribeConsistency(
  ticket: GenerateTicket,
  handlers: {
    onUpdate?: (u: JobUpdate) => void;
    onResult?: (r: ConsistencyReport) => void;
    onError?: (msg: string) => void;
  },
): () => void {
  const es = new EventSource(ticket.streamUrl);
  let closed = false;

  const stages: JobStage[] = ["queued", "loading-model", "sampling", "decoding", "saving", "done", "error"];
  for (const stage of stages) {
    es.addEventListener(stage, (ev) => {
      if (closed) return;
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        if (stage === "error") handlers.onError?.((data as { error?: string }).error ?? "failed");
        else handlers.onUpdate?.(data as JobUpdate);
      } catch { /* ignore */ }
    });
  }

  es.addEventListener("result", (ev) => {
    if (closed) return;
    try {
      handlers.onResult?.(JSON.parse((ev as MessageEvent).data) as ConsistencyReport);
    } catch { /* ignore */ }
  });

  es.addEventListener("failed", (ev) => {
    if (closed) return;
    try {
      handlers.onError?.((JSON.parse((ev as MessageEvent).data) as { error?: string }).error ?? "failed");
    } catch { /* ignore */ }
  });

  return () => {
    closed = true;
    es.close();
  };
}

// ─── Consistency sheet / 4-panel mode (M5) ────────────────────────────────

export interface SheetPanel {
  index: number;
  seed: number;
  imageFile: string | null;
  imageUrl: string | null;
  finalPrompt: string;
  memoriesUsedCount: number;
  error?: string;
}

export interface SheetResult {
  id: string;
  prompt: string;
  width: number;
  height: number;
  steps: number;
  memoryOn: boolean;
  panels: SheetPanel[];
  completed: number;
  createdAt: number;
  elapsedSeconds: number;
}

export async function startSheet(data: {
  prompt: string;
  panels?: number;
  memoryOn?: boolean;
  seeds?: number[];
}): Promise<GenerateTicket> {
  const res = await fetch("/api/sheet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error ?? "sheet failed");
  }
  return res.json() as Promise<GenerateTicket>;
}

/** Subscribe to a sheet job; the result arrives as a `result` event. */
export function subscribeSheet(
  ticket: GenerateTicket,
  handlers: {
    onUpdate?: (u: JobUpdate) => void;
    onResult?: (r: SheetResult) => void;
    onError?: (msg: string) => void;
  },
): () => void {
  const es = new EventSource(ticket.streamUrl);
  let closed = false;

  const stages: JobStage[] = ["queued", "loading-model", "sampling", "decoding", "saving", "done", "error"];
  for (const stage of stages) {
    es.addEventListener(stage, (ev) => {
      if (closed) return;
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        if (stage === "error") handlers.onError?.((data as { error?: string }).error ?? "failed");
        else handlers.onUpdate?.(data as JobUpdate);
      } catch { /* ignore */ }
    });
  }

  es.addEventListener("result", (ev) => {
    if (closed) return;
    try {
      handlers.onResult?.(JSON.parse((ev as MessageEvent).data) as SheetResult);
    } catch { /* ignore */ }
  });

  es.addEventListener("failed", (ev) => {
    if (closed) return;
    try {
      handlers.onError?.((JSON.parse((ev as MessageEvent).data) as { error?: string }).error ?? "failed");
    } catch { /* ignore */ }
  });

  return () => {
    closed = true;
    es.close();
  };
}
