import { useEffect, useState } from "react";
import { fetchHealth, type HealthResponse } from "./api";

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-green-400" : "bg-red-500"}`}
      aria-label={ok ? "ok" : "down"}
    />
  );
}

function HealthRow({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail: string;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-neutral-800 py-2 last:border-0">
      <StatusDot ok={ok} />
      <span className="w-24 text-sm text-neutral-400">{label}</span>
      <span className="text-sm">{detail}</span>
    </div>
  );
}

function MilestoneBadge({ label, live }: { label: string; live: boolean }) {
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-medium ${
        live
          ? "bg-green-900/40 text-green-300 ring-1 ring-green-700/50"
          : "bg-neutral-800/60 text-neutral-500 ring-1 ring-neutral-700/50"
      }`}
    >
      {label}
    </span>
  );
}

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const h = await fetchHealth();
        if (!cancelled) {
          setHealth(h);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    poll();
    const id = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-white">StyleMemory</h1>
        <p className="mt-1 text-sm text-neutral-400">
          An image studio that remembers — memory-conditioned generation with ComfyUI + Qwen
          Image 2.1.
        </p>
      </header>

      {/* System health */}
      <section className="mb-8 rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          System Health
        </h2>
        {error && (
          <p className="text-sm text-red-400">
            API unreachable: {error}
          </p>
        )}
        {health && (
          <div>
            <HealthRow
              label="ComfyUI"
              ok={health.comfyui.reachable}
              detail={
                health.comfyui.reachable
                  ? `${health.comfyui.version} @ ${health.comfyui.url}`
                  : `unreachable${health.comfyui.error ? ` — ${health.comfyui.error}` : ""}`
              }
            />
            <HealthRow
              label="MemOS"
              ok={health.memos.ready}
              detail={`${health.memos.count} memories stored`}
            />
            <HealthRow
              label="Workflow"
              ok={health.workflow.loaded}
              detail={health.workflow.loaded ? "qwen-image.json loaded" : "not yet uploaded"}
            />
            <HealthRow
              label="supersede()"
              ok={health.supersedeSupport}
              detail={health.supersedeSupport ? "supported" : "missing — character edits need it"}
            />
            <p className="mt-3 text-xs text-neutral-500">
              milestone: {health.milestone} · status: {health.status}
            </p>
          </div>
        )}
      </section>

      {/* Roadmap */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Roadmap
        </h2>
        <div className="flex flex-wrap gap-2">
          <MilestoneBadge label="M0 scaffold ✓" live />
          <MilestoneBadge label="M1 generate" live={false} />
          <MilestoneBadge label="M2 characters" live={false} />
          <MilestoneBadge label="M3 feedback" live={false} />
          <MilestoneBadge label="M4 inspector" live={false} />
          <MilestoneBadge label="M5 polish" live={false} />
        </div>
      </section>

      {/* Prompt box — disabled until M1 */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Prompt
        </h2>
        <textarea
          disabled
          rows={3}
          placeholder="Generation arrives in M1 — scaffold only for now."
          className="w-full rounded border border-neutral-700 bg-neutral-900 p-3 text-sm text-neutral-500 placeholder:text-neutral-600 disabled:opacity-50"
        />
        <button
          disabled
          className="mt-2 rounded bg-neutral-700 px-4 py-1.5 text-sm font-medium text-neutral-400 disabled:opacity-40"
        >
          Generate
        </button>
        <p className="mt-2 text-xs text-neutral-600">
          Prompt box and gallery land in M1/M2.
        </p>
      </section>

      <footer className="mt-12 border-t border-neutral-800 pt-4 text-xs text-neutral-600">
        Banana Hacks 2026 · all local, no paid APIs
      </footer>
    </div>
  );
}
