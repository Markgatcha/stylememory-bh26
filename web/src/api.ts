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

export async function generate(data: {
  prompt: string;
  memoryOff?: boolean;
  seed?: number;
  steps?: number;
  width?: number;
  height?: number;
}): Promise<GenerateResult> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error ?? "generation failed");
  }
  return res.json() as Promise<GenerateResult>;
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

export async function submitFeedback(id: string, feedback: "up" | "down", note?: string): Promise<void> {
  await fetch(`/api/generate/${id}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feedback, note }),
  });
}
