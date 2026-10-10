import { useEffect, useState, useCallback } from "react";
import {
  fetchHealth, fetchCharacters, fetchStyles, fetchGallery,
  createCharacter, updateCharacter, createStyle, updateStyle,
  generate, submitFeedback,
  type HealthResponse, type Character, type StyleProfile,
  type GenerationRecord, type GenerateResult,
} from "./api";

type Tab = "generate" | "characters" | "styles" | "gallery";

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-green-400" : "bg-red-500"}`}
      aria-label={ok ? "ok" : "down"}
    />
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("generate");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [styles, setStyles] = useState<StyleProfile[]>([]);
  const [gallery, setGallery] = useState<GenerationRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const h = await fetchHealth();
        if (!cancelled) setHealth(h);
      } catch { /* API down */ }
    }
    poll();
    const id = setInterval(poll, 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const reload = useCallback(async () => {
    const [c, s, g] = await Promise.all([
      fetchCharacters().catch(() => []),
      fetchStyles().catch(() => []),
      fetchGallery().catch(() => []),
    ]);
    setCharacters(c);
    setStyles(s);
    setGallery(g);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "generate", label: "Generate" },
    { key: "characters", label: `Characters (${characters.length})` },
    { key: "styles", label: `Styles (${styles.length})` },
    { key: "gallery", label: `Gallery (${gallery.length})` },
  ];

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-white">StyleMemory</h1>
        <p className="mt-1 text-sm text-neutral-400">
          An image studio that remembers — memory-conditioned generation with ComfyUI + Qwen Image 2.1 Turbo.
        </p>
      </header>

      {health && (
        <section className="mb-6 rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span className="flex items-center gap-2"><StatusDot ok={health.comfyui.reachable} /> ComfyUI {health.comfyui.version}</span>
            <span className="flex items-center gap-2"><StatusDot ok={health.memos.ready} /> MemOS {health.memos.count} memories</span>
            <span className="flex items-center gap-2"><StatusDot ok={health.workflow.loaded} /> Workflow</span>
            <span className="text-neutral-500">{health.milestone}</span>
          </div>
        </section>
      )}

      <nav className="mb-6 flex gap-1 border-b border-neutral-800">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-b-2 border-white text-white"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "generate" && <GenerateTab characters={characters} styles={styles} onGenerated={reload} />}
      {tab === "characters" && <CharactersTab characters={characters} onChanged={reload} />}
      {tab === "styles" && <StylesTab styles={styles} onChanged={reload} />}
      {tab === "gallery" && <GalleryTab gallery={gallery} onFeedback={reload} />}

      <footer className="mt-12 border-t border-neutral-800 pt-4 text-xs text-neutral-600">
        Banana Hacks 2026 · all local, no paid APIs
      </footer>
    </div>
  );
}

// ─── Generate Tab ─────────────────────────────────────────────────────────

function GenerateTab({
  characters,
  styles,
  onGenerated,
}: {
  characters: Character[];
  styles: StyleProfile[];
  onGenerated: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [memoryOff, setMemoryOff] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  async function handleGenerate() {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setElapsed(0);
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    try {
      const r = await generate({ prompt, memoryOff });
      setResult(r);
      onGenerated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      clearInterval(timer);
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
        <label className="mb-2 block text-sm font-medium text-neutral-300">Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="Kai skateboarding at sunset"
          className="w-full rounded border border-neutral-700 bg-neutral-900 p-3 text-sm text-white placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
        />
        <div className="mt-3 flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-neutral-400">
            <input
              type="checkbox"
              checked={memoryOff}
              onChange={(e) => setMemoryOff(e.target.checked)}
              className="rounded"
            />
            Memory OFF (for before/after comparison)
          </label>
          <button
            onClick={handleGenerate}
            disabled={loading || !prompt.trim()}
            className="rounded bg-white px-5 py-2 text-sm font-semibold text-black hover:bg-neutral-200 disabled:opacity-40"
          >
            {loading ? `Generating... ${elapsed}s` : "Generate"}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </section>

      {result && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
          <h3 className="mb-3 text-sm font-semibold text-neutral-300">Result</h3>
          <img
            src={result.imageUrl}
            alt={result.prompt}
            className="mb-4 max-w-full rounded border border-neutral-700"
            style={{ maxHeight: "512px" }}
          />
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-neutral-500">Final prompt: </span>
              <span className="text-neutral-300">{result.finalPrompt}</span>
            </div>
            {result.negativePrompt && (
              <div>
                <span className="text-neutral-500">Negative: </span>
                <span className="text-neutral-300">{result.negativePrompt}</span>
              </div>
            )}
            <div>
              <span className="text-neutral-500">Seed: </span>
              <span className="text-neutral-300">{result.seed}</span>
              <span className="ml-4 text-neutral-500">Size: </span>
              <span className="text-neutral-300">{result.width}×{result.height}</span>
            </div>
            {result.memoriesUsed.length > 0 && (
              <div>
                <span className="text-neutral-500">Memories used ({result.memoriesUsed.length}):</span>
                <ul className="mt-1 space-y-1">
                  {result.memoriesUsed.map((m) => (
                    <li key={m.id} className="rounded bg-neutral-800/50 px-3 py-1.5 text-xs text-neutral-400">
                      <span className="mr-2 rounded bg-neutral-700 px-1.5 py-0.5 text-[10px] uppercase">{m.kind}</span>
                      <span className="mr-2 text-neutral-600">[{m.reason}]</span>
                      {m.content.slice(0, 120)}{m.content.length > 120 ? "..." : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.memoriesUsed.length === 0 && (
              <p className="text-xs text-neutral-600">No memories recalled (memory OFF or empty store).</p>
            )}
          </div>
        </section>
      )}

      {(characters.length > 0 || styles.length > 0) && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
          <h3 className="mb-2 text-sm font-semibold text-neutral-300">Stored Memories</h3>
          <div className="flex flex-wrap gap-2">
            {characters.map((c) => (
              <span key={c.id} className="rounded-full bg-blue-900/30 px-3 py-1 text-xs text-blue-300 ring-1 ring-blue-700/40">
                {c.name}
              </span>
            ))}
            {styles.map((s) => (
              <span key={s.id} className="rounded-full bg-purple-900/30 px-3 py-1 text-xs text-purple-300 ring-1 ring-purple-700/40">
                {s.name}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Characters Tab ───────────────────────────────────────────────────────

function CharactersTab({ characters, onChanged }: { characters: Character[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<Character | null>(null);
  const [form, setForm] = useState({ name: "", description: "", appearance: "", personality: "" });
  const [saving, setSaving] = useState(false);

  function startEdit(c: Character) {
    setEditing(c);
    setForm({ name: c.name, description: c.description, appearance: c.appearance, personality: c.personality });
  }

  function startNew() {
    setEditing(null);
    setForm({ name: "", description: "", appearance: "", personality: "" });
  }

  async function handleSave() {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    try {
      if (editing) {
        await updateCharacter(editing.id, form);
      } else {
        await createCharacter(form);
      }
      startNew();
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-300">Characters</h3>
          <button onClick={startNew} className="text-xs text-neutral-400 hover:text-white">+ New</button>
        </div>
        {characters.length === 0 && <p className="text-sm text-neutral-600">No characters yet.</p>}
        {characters.map((c) => (
          <div key={c.id} className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
            <div className="flex items-start justify-between">
              <h4 className="font-medium text-white">{c.name}</h4>
              <button onClick={() => startEdit(c)} className="text-xs text-neutral-500 hover:text-white">Edit</button>
            </div>
            {c.description && <p className="mt-1 text-sm text-neutral-400">{c.description}</p>}
            {c.appearance && <p className="mt-1 text-xs text-neutral-500">Appearance: {c.appearance}</p>}
            {c.personality && <p className="mt-1 text-xs text-neutral-500">Personality: {c.personality}</p>}
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
        <h3 className="mb-4 text-sm font-semibold text-neutral-300">
          {editing ? `Edit: ${editing.name}` : "New Character"}
        </h3>
        <div className="space-y-3">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Name"
            className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none"
          />
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Description"
            rows={2}
            className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none"
          />
          <textarea
            value={form.appearance}
            onChange={(e) => setForm({ ...form, appearance: e.target.value })}
            placeholder="Appearance (hair, eyes, clothing...)"
            rows={2}
            className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none"
          />
          <textarea
            value={form.personality}
            onChange={(e) => setForm({ ...form, personality: e.target.value })}
            placeholder="Personality"
            rows={2}
            className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none"
          />
          <button
            onClick={handleSave}
            disabled={saving || !form.name.trim()}
            className="w-full rounded bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-neutral-200 disabled:opacity-40"
          >
            {saving ? "Saving..." : editing ? "Update (supersede)" : "Create"}
          </button>
          {editing && (
            <p className="text-xs text-neutral-600">Editing creates a new memory version via supersede() — history is preserved.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Styles Tab ───────────────────────────────────────────────────────────

function StylesTab({ styles, onChanged }: { styles: StyleProfile[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<StyleProfile | null>(null);
  const [form, setForm] = useState({ name: "", description: "", palette: "", styleTags: "" });
  const [saving, setSaving] = useState(false);

  function startEdit(s: StyleProfile) {
    setEditing(s);
    setForm({
      name: s.name,
      description: s.description,
      palette: s.palette.join(", "),
      styleTags: s.styleTags.join(", "),
    });
  }

  function startNew() {
    setEditing(null);
    setForm({ name: "", description: "", palette: "", styleTags: "" });
  }

  async function handleSave() {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    try {
      const data = {
        name: form.name,
        description: form.description,
        palette: form.palette.split(",").map((s) => s.trim()).filter(Boolean),
        styleTags: form.styleTags.split(",").map((s) => s.trim()).filter(Boolean),
      };
      if (editing) {
        await updateStyle(editing.id, data);
      } else {
        await createStyle(data);
      }
      startNew();
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-300">Style Profiles</h3>
          <button onClick={startNew} className="text-xs text-neutral-400 hover:text-white">+ New</button>
        </div>
        {styles.length === 0 && <p className="text-sm text-neutral-600">No styles yet.</p>}
        {styles.map((s) => (
          <div key={s.id} className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
            <div className="flex items-start justify-between">
              <h4 className="font-medium text-white">{s.name}</h4>
              <button onClick={() => startEdit(s)} className="text-xs text-neutral-500 hover:text-white">Edit</button>
            </div>
            {s.description && <p className="mt-1 text-sm text-neutral-400">{s.description}</p>}
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
        <h3 className="mb-4 text-sm font-semibold text-neutral-300">
          {editing ? `Edit: ${editing.name}` : "New Style"}
        </h3>
        <div className="space-y-3">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Style name"
            className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none"
          />
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Description"
            rows={2}
            className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none"
          />
          <input
            value={form.palette}
            onChange={(e) => setForm({ ...form, palette: e.target.value })}
            placeholder="Palette (comma-separated: warm, muted, earth tones)"
            className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none"
          />
          <input
            value={form.styleTags}
            onChange={(e) => setForm({ ...form, styleTags: e.target.value })}
            placeholder="Style tags (comma-separated: watercolor, soft lighting)"
            className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none"
          />
          <button
            onClick={handleSave}
            disabled={saving || !form.name.trim()}
            className="w-full rounded bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-neutral-200 disabled:opacity-40"
          >
            {saving ? "Saving..." : editing ? "Update (supersede)" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Gallery Tab ──────────────────────────────────────────────────────────

function GalleryTab({ gallery, onFeedback }: { gallery: GenerationRecord[]; onFeedback: () => void }) {
  async function handleFeedback(id: string, feedback: "up" | "down") {
    await submitFeedback(id, feedback);
    onFeedback();
  }

  if (gallery.length === 0) {
    return <p className="text-sm text-neutral-600">No generations yet. Go to the Generate tab to create one.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {gallery.map((g) => (
        <div key={g.id} className="rounded-lg border border-neutral-800 bg-neutral-900/50 overflow-hidden">
          <img src={g.imageUrl} alt={g.prompt} className="w-full" />
          <div className="p-3">
            <p className="text-sm text-neutral-300 line-clamp-2">{g.prompt}</p>
            <p className="mt-1 text-xs text-neutral-600">seed: {g.seed} · {g.width}×{g.height}</p>
            {g.finalPrompt !== g.prompt && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-neutral-500">Final prompt</summary>
                <p className="mt-1 text-xs text-neutral-400">{g.finalPrompt}</p>
              </details>
            )}
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => handleFeedback(g.id, "up")}
                className={`rounded px-3 py-1 text-xs ${g.feedback === "up" ? "bg-green-900/50 text-green-300" : "bg-neutral-800 text-neutral-400 hover:text-white"}`}
              >
                👍
              </button>
              <button
                onClick={() => handleFeedback(g.id, "down")}
                className={`rounded px-3 py-1 text-xs ${g.feedback === "down" ? "bg-red-900/50 text-red-300" : "bg-neutral-800 text-neutral-400 hover:text-white"}`}
              >
                👎
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
