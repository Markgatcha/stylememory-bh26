/**
 * Job registry for streamed progress (M5).
 *
 * `POST /api/generate` now returns a jobId immediately instead of blocking
 * for the full generation (~50s). The browser opens an SSE connection to
 * `/api/progress/:jobId` and receives live step-by-step updates relayed from
 * ComfyUI's WebSocket, then the final result.
 *
 * Jobs live in memory only — a server restart loses in-flight jobs, which is
 * acceptable because the gallery record is written on completion and a
 * restart mid-generation just means re-running it.
 */
import { randomUUID } from "node:crypto";

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
  /** Current step, when known. */
  value?: number;
  /** Total steps, when known. */
  max?: number;
  /** 0–100, when computable. */
  pct?: number;
  message?: string;
}

export interface Job<T> {
  id: string;
  status: "running" | "done" | "error";
  /** Every update emitted so far, replayed to late SSE subscribers. */
  updates: JobUpdate[];
  result?: T;
  error?: string;
  listeners: Set<(u: JobUpdate) => void>;
}

const jobs = new Map<string, Job<unknown>>();

/** Jobs are retained briefly after finishing so a reconnecting client can read the result. */
const RESULT_TTL_MS = 5 * 60 * 1000;

export function createJob<T>(): Job<T> {
  const job: Job<T> = {
    id: randomUUID(),
    status: "running",
    updates: [],
    listeners: new Set(),
  };
  jobs.set(job.id, job as Job<unknown>);
  return job;
}

export function getJob<T>(id: string): Job<T> | undefined {
  return jobs.get(id) as Job<T> | undefined;
}

export function pushUpdate(id: string, update: JobUpdate): void {
  const job = jobs.get(id);
  if (!job || job.status !== "running") return;
  job.updates.push(update);
  for (const listener of job.listeners) listener(update);
}

export function finishJob<T>(id: string, result: T): void {
  const job = jobs.get(id);
  if (!job || job.status !== "running") return;
  job.status = "done";
  job.result = result;
  const done: JobUpdate = { stage: "done", pct: 100, message: "complete" };
  job.updates.push(done);
  for (const listener of job.listeners) listener(done);
  scheduleCleanup(id);
}

export function failJob(id: string, message: string): void {
  const job = jobs.get(id);
  if (!job || job.status !== "running") return;
  job.status = "error";
  job.error = message;
  const err: JobUpdate = { stage: "error", message };
  job.updates.push(err);
  for (const listener of job.listeners) listener(err);
  scheduleCleanup(id);
}

/** Subscribe to live updates. Returns an unsubscribe function. */
export function subscribeJob(id: string, listener: (u: JobUpdate) => void): () => void {
  const job = jobs.get(id);
  if (!job) return () => {};
  job.listeners.add(listener);
  return () => job.listeners.delete(listener);
}

function scheduleCleanup(id: string): void {
  setTimeout(() => jobs.delete(id), RESULT_TTL_MS).unref?.();
}
