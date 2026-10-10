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
 * Recall relevant memories for a prompt.
 *
 * Order (per approved correction #6):
 *   1. Whole-word case-insensitive name match against character/style names
 *   2. Tag-based search for characters and styles
 *   3. Full-text search across all memories
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

  // 2. Tag-based search for characters and styles (if not already recalled)
  if (recalled.size < 3) {
    const byTag = await memos.search({
      namespace: "stylememory",
      limit: 10,
      sortBy: "importance",
      sortOrder: "desc",
    });
    for (const sm of byTag) {
      if (!recalled.has(sm.node.id)) {
        recalled.set(sm.node.id, {
          id: sm.node.id,
          content: sm.node.content,
          tags: sm.node.tags,
          kind: (sm.node.metadata.kind as string) ?? "unknown",
          reason: "tag-match",
          score: sm.score,
        });
      }
    }
  }

  // 3. Full-text search
  const textResults = await memos.search({
    namespace: "stylememory",
    query: prompt,
    limit,
  });
  for (const sm of textResults) {
    if (!recalled.has(sm.node.id)) {
      recalled.set(sm.node.id, {
        id: sm.node.id,
        content: sm.node.content,
        tags: sm.node.tags,
        kind: (sm.node.metadata.kind as string) ?? "unknown",
        reason: "text-search",
        score: sm.score,
      });
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

/** Extract a field value from the structured content string. */
function extractField(content: string, field: string): string | null {
  const match = content.match(new RegExp(`${field}:\\s*(.+)`, "i"));
  return match ? match[1]!.trim() : null;
}
