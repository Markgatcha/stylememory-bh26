/** Health response shape returned by GET /api/health. */
export interface HealthResponse {
  status: "ok" | "degraded";
  milestone: string;
  comfyui: { reachable: boolean; version?: string; url: string; error?: string };
  memos: { ready: boolean; count: number; dbPath: string; error?: string };
  workflow: { loaded: boolean; file: string; error?: string };
  supersedeSupport: boolean;
}
