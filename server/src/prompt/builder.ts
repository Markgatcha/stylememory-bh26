/**
 * Prompt builder — merges the user's prompt with recalled memories into
 * an enriched prompt for ComfyUI.
 *
 * CFG 1 correction: Qwen Image 2.1 Turbo runs at CFG 1, where negative
 * prompts are ignored. So learned "avoid" traits are rewritten as
 * positive-prompt phrasing (e.g. "avoid neon colors" → "muted, desaturated
 * color palette, no neon").
 */
import type { RecalledMemory } from "../memory/records.js";

/** Map of trait keywords to their positive-prompt counter-phrasings. */
const TRAIT_COUNTERS: Record<string, string> = {
  neon: "muted, desaturated colors, no neon",
  blurry: "sharp, crisp details",
  "low quality": "high quality, detailed",
  watermark: "clean, no watermark or text",
  deformed: "well-formed anatomy",
  "extra limbs": "correct anatomy, proper limb count",
  "bad anatomy": "anatomically correct",
  oversaturated: "natural, balanced colors",
  dark: "bright, well-lit",
  cluttered: "clean composition, uncluttered",
  flat: "rich depth, dimensional lighting",
};

export interface EnrichedPrompt {
  /** The final positive prompt sent to ComfyUI. */
  positive: string;
  /** The negative prompt (only effective when CFG > 1; still filled for completeness). */
  negative: string;
  /** Memories that contributed to the enrichment. */
  memoriesUsed: RecalledMemory[];
}

/**
 * Build an enriched prompt from the user's prompt and recalled memories.
 *
 * Strategy:
 * 1. Start with the user's raw prompt.
 * 2. Append character descriptions (name + appearance + personality).
 * 3. Append style descriptions (palette, style tags).
 * 4. Rewrite "avoid" traits as positive-prompt counter-phrasings.
 * 5. Collect "prefer" traits as positive additions.
 */
export function buildEnrichedPrompt(
  userPrompt: string,
  memories: RecalledMemory[],
): EnrichedPrompt {
  const parts: string[] = [userPrompt.trim()];
  const negativeParts: string[] = [];

  // Sort memories: characters and styles first, then traits
  const characters = memories.filter((m) => m.kind === "character");
  const styles = memories.filter((m) => m.kind === "style");
  const avoids = memories.filter((m) => m.kind === "avoid");
  const prefers = memories.filter((m) => m.kind === "prefer");
  const others = memories.filter(
    (m) => !["character", "style", "avoid", "prefer"].includes(m.kind)
  );

  // Characters
  for (const mem of characters) {
    // Strip the "Character: <name>" prefix, keep the description
    const desc = mem.content.replace(/^Character:\s*\S+\s*\n?/, "").trim();
    if (desc) parts.push(desc);
  }

  // Styles
  for (const mem of styles) {
    const desc = mem.content.replace(/^Style:\s*\S+\s*\n?/, "").trim();
    if (desc) parts.push(desc);
  }

  // Prefer traits — positive additions
  for (const mem of prefers) {
    parts.push(mem.content);
  }

  // Avoid traits — rewrite as positive counter-phrasings (CFG 1 workaround)
  for (const mem of avoids) {
    const traitText = mem.content.toLowerCase().trim();
    let countered = false;
    for (const [keyword, counter] of Object.entries(TRAIT_COUNTERS)) {
      if (traitText.includes(keyword)) {
        parts.push(counter);
        countered = true;
        break;
      }
    }
    // If no known counter, phrase it as a positive instruction
    if (!countered) {
      parts.push(`free of ${mem.content}, without ${mem.content}`);
    }
    // Also add to negative for when CFG > 1
    negativeParts.push(mem.content);
  }

  // Other recalled memories (context, etc.)
  for (const mem of others) {
    parts.push(mem.content);
  }

  return {
    positive: parts.join(", "),
    negative: negativeParts.length > 0 ? negativeParts.join(", ") : "",
    memoriesUsed: memories,
  };
}
