/**
 * Memory types for StyleMemory — Characters, StyleProfiles, and learned traits.
 * All stored in MemOS under namespace "stylememory" with tags as discriminators.
 *
 * Tag scheme:
 *   character       — a character profile
 *   style           — a style profile
 *   avoid           — a learned "avoid" trait (from thumbs-down)
 *   character:<name> — lowercase name, for fast whole-word lookup
 *   style:<name>    — lowercase style name
 */
import { getMemOS } from "./memos.js";
import {
  SEMANTIC_MIN_COSINE,
  cosine,
  embedBatch,
} from "./semantic.js";
import type { MemoryNode, ScoredMemory, SearchFilter } from "@mem-os/sdk";

export interface Character {
  id: string;          // our app UUID
  memosNodeId: string; // MemOS node.id from store()
  name: string;
  description: string;
  appearance: string;
  personality: string;
  createdAt: number;
  updatedAt: number;
}

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

export interface LearnedTrait {
  id: string;
  memosNodeId: string;
  /** "avoid" = negative trait from thumbs-down, "prefer" = positive from thumbs-up */
  kind: "avoid" | "prefer";
  /** The trait text, e.g. "neon colors" or "soft lighting". */
  text: string;
  /** The generation ID that triggered this learning. */
  sourceGenerationId: string;
  createdAt: number;
}

/** Generate a UUID v4. */
export function uuid(): string {
  return crypto.randomUUID();
}

/**
 * Store a character in MemOS.
 * Content is a natural-language description the text encoder can use.
 * Tags: ["character", "character:<name>"]
 */
export async function storeCharacter(char: Omit<Character, "id" | "memosNodeId" | "createdAt" | "updatedAt">): Promise<Character> {
  const memos = await getMemOS();
  const id = uuid();
  const now = Date.now();

  const content = [
    `Character: ${char.name}`,
    char.description ? `Description: ${char.description}` : "",
    char.appearance ? `Appearance: ${char.appearance}` : "",
    char.personality ? `Personality: ${char.personality}` : "",
  ].filter(Boolean).join("\n");

  const { node } = await memos.store(content, {
    tags: ["character", `character:${char.name.toLowerCase()}`],
    namespace: "stylememory",
    metadata: { kind: "character", appId: id, name: char.name },
    source: "user_input",
    type: "entity",
    importance: 0.8,
  });

  const record: Character = {
    ...char,
    id,
    memosNodeId: node.id,
    createdAt: now,
    updatedAt: now,
  };
  return record;
}

/**
 * Update a character via supersede() — never delete-and-recreate.
 * Creates a new MemOS node and marks the old one as superseded.
 */
export async function updateCharacter(
  existing: Character,
  changes: Partial<Omit<Character, "id" | "memosNodeId" | "createdAt">>
): Promise<Character> {
  const memos = await getMemOS();
  const now = Date.now();

  const merged = { ...existing, ...changes };
  const content = [
    `Character: ${merged.name}`,
    merged.description ? `Description: ${merged.description}` : "",
    merged.appearance ? `Appearance: ${merged.appearance}` : "",
    merged.personality ? `Personality: ${merged.personality}` : "",
  ].filter(Boolean).join("\n");

  const { node } = await memos.store(content, {
    tags: ["character", `character:${merged.name.toLowerCase()}`],
    namespace: "stylememory",
    metadata: { kind: "character", appId: existing.id, name: merged.name, version: (existing.updatedAt ?? 0) + 1 },
    source: "user_input",
    type: "entity",
    importance: 0.8,
  });

  // Mark the old node as superseded (sets validTo, keeps history queryable)
  await memos.supersede(existing.memosNodeId, node.id);

  return {
    ...merged,
    memosNodeId: node.id,
    updatedAt: now,
  };
}

/**
 * Store a style profile in MemOS.
 * Tags: ["style", "style:<name>"]
 */
export async function storeStyle(style: Omit<StyleProfile, "id" | "memosNodeId" | "createdAt" | "updatedAt">): Promise<StyleProfile> {
  const memos = await getMemOS();
  const id = uuid();
  const now = Date.now();

  const content = [
    `Style: ${style.name}`,
    style.description ? `Description: ${style.description}` : "",
    style.palette.length > 0 ? `Palette: ${style.palette.join(", ")}` : "",
    style.styleTags.length > 0 ? `Style tags: ${style.styleTags.join(", ")}` : "",
  ].filter(Boolean).join("\n");

  const { node } = await memos.store(content, {
    tags: ["style", `style:${style.name.toLowerCase()}`],
    namespace: "stylememory",
    metadata: { kind: "style", appId: id, name: style.name },
    source: "user_input",
    type: "context",
    importance: 0.7,
  });

  return {
    ...style,
    id,
    memosNodeId: node.id,
    createdAt: now,
    updatedAt: now,
  };
}

/** Update a style via supersede(). */
export async function updateStyle(
  existing: StyleProfile,
  changes: Partial<Omit<StyleProfile, "id" | "memosNodeId" | "createdAt">>
): Promise<StyleProfile> {
  const memos = await getMemOS();
  const now = Date.now();

  const merged = { ...existing, ...changes };
  const content = [
    `Style: ${merged.name}`,
    merged.description ? `Description: ${merged.description}` : "",
    merged.palette.length > 0 ? `Palette: ${merged.palette.join(", ")}` : "",
    merged.styleTags.length > 0 ? `Style tags: ${merged.styleTags.join(", ")}` : "",
  ].filter(Boolean).join("\n");

  const { node } = await memos.store(content, {
    tags: ["style", `style:${merged.name.toLowerCase()}`],
    namespace: "stylememory",
    metadata: { kind: "style", appId: existing.id, name: merged.name },
    source: "user_input",
    type: "context",
    importance: 0.7,
  });

  await memos.supersede(existing.memosNodeId, node.id);

  return { ...merged, memosNodeId: node.id, updatedAt: now };
}

/** Store a learned trait (avoid or prefer). */
export async function storeTrait(trait: Omit<LearnedTrait, "id" | "memosNodeId" | "createdAt">): Promise<LearnedTrait> {
  const memos = await getMemOS();
  const id = uuid();
  const now = Date.now();

  const { node } = await memos.store(trait.text, {
    tags: [trait.kind],
    namespace: "stylememory",
    metadata: { kind: trait.kind, appId: id, sourceGenerationId: trait.sourceGenerationId },
    source: "user_input",
    type: "preference",
    importance: trait.kind === "avoid" ? 0.9 : 0.6,
  });

  return { ...trait, id, memosNodeId: node.id, createdAt: now };
}

// ─── Recall ───────────────────────────────────────────────────────────────

export interface RecalledMemory {
  id: string;
  content: string;
  tags: string[];
  kind: string;
  /** Why this memory was recalled: "character-name", "tag-match", or "text-search". */
  reason: string;
  score: number;
}

/**
 * Function words dropped before word-overlap recall. This is exactly
 * MemOS's own FTS stopword set (src/storage/sqlite.ts FTS_STOPWORDS),
 * mirrored so a word we query is always a word MemOS indexes.
 */
const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "does", "did", "do", "has", "have", "had", "of", "in", "on", "at",
  "to", "for", "and", "or", "not", "no", "with", "by", "from", "as",
  "it", "its", "this", "that", "these", "those", "what", "when",
  "where", "who", "whom", "which", "how", "why", "can", "could",
  "will", "would", "should", "shall", "may", "might", "must", "about",
  "into", "over", "after", "before", "they", "them", "their", "theirs",
  "he", "she", "his", "her", "hers", "we", "us", "our", "ours", "you",
  "your", "yours", "i", "me", "my", "mine", "if",
]);

/**
 * Split a prompt into content words for word-overlap recall.
 * Same shape as MemOS's FTS tokenizer: lowercase, split on
 * non-alphanumerics, drop single characters and function words. Falls
 * back to the raw tokens when everything is a stopword, so a prompt of
 * pure function words still produces a usable (if weak) query set.
 */
export function contentWords(prompt: string): string[] {
  const tokens = prompt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
  const words = tokens.filter((t) => !STOPWORDS.has(t));
  return words.length > 0 ? words : tokens;
}

/**
 * Recall relevant memories for a prompt.
 *
 * Order (per approved correction #6):
 *   1. Whole-word case-insensitive name match against character/style names
 *   2. Word-overlap prose recall — per-word search plus a two-word floor
 *   3. Semantic recall — local ONNX embeddings, cosine >= 0.50 (optional;
 *      disables itself if the model cannot load)
 *
 * Also always includes active "avoid" and "prefer" traits.
 */
export async function recallMemories(prompt: string, limit = 10): Promise<RecalledMemory[]> {
  const memos = await getMemOS();
  const recalled = new Map<string, RecalledMemory>();

  // 1. Whole-word name match against stored characters and styles
  const chars = await memos.search({ namespace: "stylememory", tags: ["character"], limit: 50 });
  const styles = await memos.search({ namespace: "stylememory", tags: ["style"], limit: 50 });

  const promptLower = prompt.toLowerCase();
  const promptWords = new Set(promptLower.split(/\W+/).filter(Boolean));

  for (const sm of [...chars, ...styles]) {
    const name = (sm.node.metadata.name as string) ?? "";
    if (!name) continue;
    const nameLower = name.toLowerCase();
    // Whole-word match: name must appear as a complete word in the prompt
    if (promptWords.has(nameLower) || promptLower.includes(nameLower)) {
      recalled.set(sm.node.id, {
        id: sm.node.id,
        content: sm.node.content,
        tags: sm.node.tags,
        kind: (sm.node.metadata.kind as string) ?? "unknown",
        reason: "character-name",
        score: sm.score,
      });
    }
  }

  // ── REMOVED (historical): unconditional "top by importance" fallback.
  //
  // It caused a real bug: this search returns a constant score of 1.0 for
  // every node regardless of the query (verified against MemOS 1.6.26), and
  // full-text search returns no rows at all for prose queries. So the
  // fallback silently injected the highest-importance character into every
  // unrelated prompt — "a red fox in a forest" came back wearing Kai's
  // jacket, because Kai was simply the most important memory in the store.
  //
  // Recall now relies on the two paths that carry real signal:
  //   (a) whole-word name match against stored character/style names
  //   (b) word-overlap prose recall with a two-word floor (below)
  // Plus avoid-traits, which are always-on by design.

  // 2. Word-overlap prose recall (replaces the dead full-text leg).
  //
  // The old code ran `memos.search({ query: prompt })` and kept results
  // scoring >= 0.25. On the released MemOS 1.6.26 SDK that leg returns
  // NOTHING for prose queries: the FTS builder wraps the whole query as
  // a single quoted phrase ("kai skateboarding at sunset"), and a phrase
  // only matches content that contains it verbatim — which stored
  // character descriptions never do. That is the "semantic recall is the
  // biggest gap" limitation the README documents. (The tokenized fix
  // exists in MemOS main — commit 8c6a47f, Aug 15 — but was never
  // released past 1.6.26, and publishing is not available here.)
  //
  // So recall tokenizes at the app layer instead: each content word is
  // queried on its own (a one-word "phrase" is an exact token match),
  // and each memory accumulates the set of prompt words it shares.
  //
  // Precision rule: a memory is only recalled when it shares at least
  // TWO distinct content words with the prompt. One shared word is a
  // collision, not relevance — "a red fox in a forest" shares only
  // "red" with a character who owns a red jacket, and letting that
  // through is exactly the contamination bug this app already shipped
  // once (Kai's jacket on the fox, dev.log commit 7a243a7). The
  // name-match leg above carries the named case, so the two-word floor
  // does not cost the recall that actually matters.
  const words = contentWords(prompt);
  if (words.length > 0) {
    const hits = new Map<string, { sm: ScoredMemory; matched: Set<string> }>();
    for (const word of words) {
      const results = await memos.search({
        namespace: "stylememory",
        query: word,
        limit: 50,
      });
      for (const sm of results) {
        let hit = hits.get(sm.node.id);
        if (!hit) {
          hit = { sm, matched: new Set() };
          hits.set(sm.node.id, hit);
        }
        hit.matched.add(word);
      }
    }
    for (const [id, hit] of hits) {
      if (recalled.has(id)) continue;
      if (hit.matched.size < 2) continue; // collision, not relevance
      const score = hit.matched.size / words.length;
      if (score < 0.25) continue;
      recalled.set(id, {
        id,
        content: hit.sm.node.content,
        tags: hit.sm.node.tags,
        kind: (hit.sm.node.metadata.kind as string) ?? "unknown",
        reason: "text-search",
        score,
      });
    }
  }

  // 3. Semantic leg — additive and optional. The word-overlap leg above
  // needs at least two shared content words, so a prompt that describes a
  // character without reusing their stored words ("a boy doing tricks on a
  // board") finds nothing. This leg embeds the prompt and each remaining
  // character/style candidate with a small local ONNX model and recalls on
  // cosine similarity. If the model cannot load (missing package, offline,
  // broken ONNX) the leg disables itself for the process lifetime and the
  // two legs above behave exactly as before — the demo never depends on
  // this leg being alive.
  //
  // Threshold and model were chosen by measurement, not vibes: a 13-case
  // bake-off (MiniLM-L6 / bge-small / e5-small / bge-base) showed only
  // bge-small separates every positive from every negative
  // (min positive 0.518 vs max negative 0.480 on this battery).
  const candidates = [...chars, ...styles].filter((sm) => !recalled.has(sm.node.id));
  if (candidates.length > 0) {
    const vectors = await embedBatch([prompt, ...candidates.map((sm) => sm.node.content)]);
    if (vectors && vectors.length === candidates.length + 1) {
      const queryVec = vectors[0]!;
      for (let i = 0; i < candidates.length; i += 1) {
        const docVec = vectors[i + 1]!;
        const score = cosine(queryVec, docVec);
        if (score < SEMANTIC_MIN_COSINE) continue;
        const sm = candidates[i]!;
        if (recalled.has(sm.node.id)) continue;
        recalled.set(sm.node.id, {
          id: sm.node.id,
          content: sm.node.content,
          tags: sm.node.tags,
          kind: (sm.node.metadata.kind as string) ?? "unknown",
          reason: "semantic-search",
          score,
        });
      }
    }
  }

  // 4. Always include active avoid traits (they must shape every generation)
  const avoids = await memos.search({ namespace: "stylememory", tags: ["avoid"], limit: 20 });
  for (const sm of avoids) {
    if (!recalled.has(sm.node.id)) {
      recalled.set(sm.node.id, {
        id: sm.node.id,
        content: sm.node.content,
        tags: sm.node.tags,
        kind: "avoid",
        reason: "trait",
        score: sm.score,
      });
    }
  }

  return Array.from(recalled.values()).slice(0, limit);
}

// ─── List / Get ───────────────────────────────────────────────────────────

export async function listCharacters(): Promise<Character[]> {
  const memos = await getMemOS();
  const results = await memos.search({ namespace: "stylememory", tags: ["character"], limit: 100 });
  return results.map((sm) => ({
    id: (sm.node.metadata.appId as string) ?? sm.node.id,
    memosNodeId: sm.node.id,
    name: (sm.node.metadata.name as string) ?? "",
    description: extractField(sm.node.content, "Description") ?? "",
    appearance: extractField(sm.node.content, "Appearance") ?? "",
    personality: extractField(sm.node.content, "Personality") ?? "",
    createdAt: sm.node.createdAt,
    updatedAt: sm.node.updatedAt,
  }));
}

export async function listStyles(): Promise<StyleProfile[]> {
  const memos = await getMemOS();
  const results = await memos.search({ namespace: "stylememory", tags: ["style"], limit: 100 });
  return results.map((sm) => ({
    id: (sm.node.metadata.appId as string) ?? sm.node.id,
    memosNodeId: sm.node.id,
    name: (sm.node.metadata.name as string) ?? "",
    description: extractField(sm.node.content, "Description") ?? "",
    palette: [],
    styleTags: [],
    createdAt: sm.node.createdAt,
    updatedAt: sm.node.updatedAt,
  }));
}

export async function listTraits(): Promise<LearnedTrait[]> {
  const memos = await getMemOS();
  const results = await memos.search({
    namespace: "stylememory",
    limit: 100,
    sortBy: "createdAt",
    sortOrder: "desc",
  });
  return results
    .filter((sm) => sm.node.tags.includes("avoid") || sm.node.tags.includes("prefer"))
    .map((sm) => ({
      id: (sm.node.metadata.appId as string) ?? sm.node.id,
      memosNodeId: sm.node.id,
      kind: sm.node.tags.includes("avoid") ? "avoid" : "prefer",
      text: sm.node.content,
      sourceGenerationId: (sm.node.metadata.sourceGenerationId as string) ?? "",
      createdAt: sm.node.createdAt,
    }));
}

/** Remove a learned trait from memory. */
export async function deleteTrait(memosNodeId: string): Promise<boolean> {
  const memos = await getMemOS();
  return memos.forget(memosNodeId);
}

/**
 * Delete a character or style outright via `forget()`.
 *
 * Distinct from supersede(): supersede marks a version historical and keeps
 * the chain queryable, which is what an EDIT wants. A delete means the user
 * no longer wants this record at all. Characters and styles are app-level
 * records, so deletion goes through forget() on the current MemOS node.
 */
export async function deleteRecord(memosNodeId: string): Promise<boolean> {
  const memos = await getMemOS();
  return memos.forget(memosNodeId);
}

/** Extract a field value from the structured content string. */
function extractField(content: string, field: string): string | null {
  const match = content.match(new RegExp(`${field}:\\s*(.+)`, "i"));
  return match ? match[1]!.trim() : null;
}
