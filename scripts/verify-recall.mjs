/**
 * Recall verification for the word-overlap prose leg (fix-prompt BLOCKER 3).
 *
 * Runs the real records.ts recallMemories() against a scratch DB that
 * mirrors the app's data shape, and checks the behaviors that matter:
 *   1. named prompt still recalls the character (the suite's headline metric)
 *   2. a prose prompt with NO name recalls the character by content words
 *   3. an unrelated prompt does NOT recall anything (no contamination)
 *   4. style recall still works by name
 *
 * Run: node --import tsx scripts/verify-recall.mjs   (from project root)
 */
import { rmSync } from "node:fs";

const DB = "C:/Users/marki/stylememory-bh26/data/_recall_test.db";
for (const suffix of ["", "-wal", "-shm"]) {
  rmSync(DB + suffix, { force: true });
}
// Must be set BEFORE importing anything that reads paths.ts.
process.env.STYLEMEMORY_DB = DB;

const { recallMemories, storeCharacter, storeStyle } = await import(
  "../server/src/memory/records.ts"
);
const { getMemOS } = await import("../server/src/memory/memos.ts");
const memos = await getMemOS();

await storeCharacter({
  name: "Kai",
  description: "A skateboarder",
  appearance: "blue hair, red jacket, worn jeans, scar on left cheek",
  personality: "bold",
});
await storeStyle({
  name: "Neon Sunset",
  description: "high-contrast sunset palette",
  palette: ["#ff5e00", "#ffb800", "#2b0a3d"],
  styleTags: ["vibrant", "warm", "cinematic"],
});

let failures = 0;
const check = async (label, prompt, expect) => {
  const results = await recallMemories(prompt);
  const ok = expect(results);
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  for (const r of results) {
    console.log(
      `      [${r.reason}/${r.kind}] score=${r.score.toFixed(3)} ${r.content
        .slice(0, 48)
        .replace(/\n/g, " ")}`,
    );
  }
};

// 1. The suite's headline prompt — name match must still fire (100% recall rate).
await check(
  "named prompt recalls Kai",
  "Kai skateboarding at sunset",
  (r) => r.some((m) => m.kind === "character" && m.reason === "character-name"),
);

// 2. NEW: prose prompt with no name recalls Kai by content words.
await check(
  "prose prompt (no name) recalls Kai",
  "a skateboarder with a scar on his cheek",
  (r) =>
    r.some((m) => m.kind === "character" && m.reason === "text-search"),
);

// 3. Contamination guard: one shared word must NOT recall.
await check(
  "unrelated prompt recalls nothing",
  "a red fox in a forest",
  (r) => r.filter((m) => m.kind !== "avoid").length === 0,
);

// 4. Style recall by name.
await check(
  "named style prompt recalls the style",
  "Neon Sunset city skyline",
  (r) => r.some((m) => m.kind === "style"),
);

// 5. Two shared words recall even when neither is the name.
await check(
  "two-word prose overlap recalls",
  "blue hair by the ocean",
  (r) =>
    r.some((m) => m.kind === "character" && m.reason === "text-search"),
);

// 6. Semantic leg: paraphrase with ZERO shared content words recalls Kai.
await check(
  "semantic: zero-overlap paraphrase recalls Kai",
  "a boy doing tricks on a board at golden hour",
  (r) =>
    r.some((m) => m.kind === "character" && m.reason === "semantic-search"),
);

// 7. Hybrid recall: red + jacket are shared words here, so ANY leg firing
//    is correct — this asserts the outcome, not the mechanism.
await check(
  "paraphrase-ish prompt recalls Kai",
  "kid in a red jacket cruising the sidewalk",
  (r) => r.some((m) => m.kind === "character"),
);

// 8. Semantic leg must NOT fire for unrelated subjects (the guard that
//    keeps the contamination bug dead).
await check(
  "semantic: unrelated prompt stays silent",
  "a dog playing in the park",
  (r) => r.filter((m) => m.kind !== "avoid").length === 0,
);

// 9. Style recalled by description (word leg fires first here —
//    high/contrast/sunset are shared — so assert the outcome).
await check(
  "style recalled by description",
  "high contrast orange and purple sunset colors",
  (r) => r.some((m) => m.kind === "style"),
);

// 10. Genuinely zero-overlap semantic recall for a STYLE (measured:
//     cosine 0.633 — "dusk" never appears in the style content).
await check(
  "semantic: style zero-overlap paraphrase",
  "deep orange dusk over the city skyline",
  (r) => r.some((m) => m.kind === "style" && m.reason === "semantic-search"),
);

await memos.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
