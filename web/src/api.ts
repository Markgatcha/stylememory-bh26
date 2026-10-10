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
