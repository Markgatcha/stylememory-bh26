/**
 * Progress estimation that does not depend on ComfyUI's WebSocket.
 *
 * Why this exists (measured, not assumed):
 *   Two identical back-to-back runs on ComfyUI 0.39.0 produced
 *     run 1: 8 `progress` frames, 16 `progress_state` frames
 *     run 2: 0 `progress` frames,  1 `progress_state` frame
 *   So the WS path is intermittent — a progress bar fed only by the socket
 *   would sometimes sit at 0% for the entire generation. Unacceptable for a
 *   live demo.
 *
 * Strategy: the socket drives the bar when it has data (smooth, per-step).
 * When it is silent, a monotonic clock-based estimate keeps the bar moving so
 * the UI is never frozen. The estimate is deliberately conservative: it
 * advances toward a ceiling and never claims completion — only the history
 * poll (which is authoritative) does that.
 */
import type { JobUpdate } from "./jobs.js";

export interface ProgressModel {
  /** Feed a real sampler step in. Returns the update to emit, if any. */
  onStep: (value: number, max: number) => JobUpdate | null;
  /** Feed a coarse stage name in. */
  onStage: (stage: "starting" | "decoding" | "saving") => JobUpdate | null;
  /** Tick the estimator. Call on an interval. */
  tick: () => JobUpdate | null;
  /** Stop the internal timer. */
  stop: () => void;
}

/**
 * Typical phase timings at 1024x1024 / 8 steps on an RTX 5050, measured over
 * several runs. Used only to shape the fallback curve.
 */
const MODEL_LOAD_S = 20;
const SAMPLE_S = 30;
const DECODE_SAVE_S = 4;

export function createProgressModel(opts: {
  startedAt: number;
  totalSteps: number;
  emit: (u: JobUpdate) => void;
}): ProgressModel {
  const { startedAt, totalSteps, emit } = opts;

  let lastEmittedPct = -1;
  let sawRealStep = false;
  let done = false;

  function emitIfChanged(u: JobUpdate): JobUpdate | null {
    const pct = u.pct ?? 0;
    // Throttle: only emit on a meaningful change, or a stage transition.
    if (u.pct !== undefined && Math.abs(pct - lastEmittedPct) < 2 && u.stage === "sampling") {
      return null;
    }
    if (u.pct !== undefined) lastEmittedPct = pct;
    emit(u);
    return u;
  }

  return {
    onStep(value, max) {
      sawRealStep = true;
      if (done) return null;
      // Real sampler data: model load is behind us, so anchor the curve to
      // the sampling phase rather than counting from t=0.
      const samplingPct = max > 0 ? value / max : 0;
      const loadShare = MODEL_LOAD_S / (MODEL_LOAD_S + SAMPLE_S + DECODE_SAVE_S);
      const sampleShare = SAMPLE_S / (MODEL_LOAD_S + SAMPLE_S + DECODE_SAVE_S);
      const pct = Math.round((loadShare + samplingPct * sampleShare) * 100);
      return emitIfChanged({
        stage: "sampling",
        value,
        max,
        pct: Math.min(97, Math.max(2, pct)),
      });
    },

    onStage(stage) {
      if (done) return null;
      if (stage === "starting") {
        return emitIfChanged({
          stage: "sampling",
          value: 0,
          max: totalSteps,
          pct: Math.round((MODEL_LOAD_S * 0.5 / (MODEL_LOAD_S + SAMPLE_S + DECODE_SAVE_S)) * 100),
          message: "starting",
        });
      }
      if (stage === "decoding") {
        done = true;
        return emitIfChanged({ stage: "decoding", pct: 98, message: "decoding" });
      }
      if (stage === "saving") {
        done = true;
        return emitIfChanged({ stage: "saving", pct: 99, message: "saving" });
      }
      return null;
    },

    tick() {
      if (done || sawRealStep) return null;
      // No socket data: advance on the clock so the bar is never frozen.
      const elapsed = (Date.now() - startedAt) / 1000;
      const total = MODEL_LOAD_S + SAMPLE_S + DECODE_SAVE_S;
      // Ease toward 90% asymptotically so we never appear "nearly done"
      // before the sampler actually reports.
      const raw = Math.min(0.9, elapsed / total);
      const pct = Math.round(raw * 100);
      if (pct <= lastEmittedPct) return null;
      const stage = elapsed < MODEL_LOAD_S ? "loading-model" : "sampling";
      return emitIfChanged({
        stage,
        pct: Math.max(2, pct),
        value: 0,
        max: totalSteps,
        message: stage === "loading-model" ? "loading model" : "sampling",
      });
    },

    stop() {
      done = true;
    },
  };
}
