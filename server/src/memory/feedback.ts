/**
 * Feedback → memory pipeline (M3).
 *
 * Thumbs up/down on a generation produces candidate learned traits. Not all
 * of them go straight into memory: a trait is only trustworthy if it is
 * consistent with what is already known. Contradictions and low-signal
 * candidates are routed to a quarantine list for the user to approve.
 *
 * Why quarantine instead of writing everything:
 *   - A thumbs-down with a vague note ("bad") carries no usable signal.
 *   - A thumbs-down that contradicts an explicit character attribute would
 *     corrupt the character's identity if written automatically.
 *   - Memory is high-trust (`source: "user_input"`, trust 1.0). Polluting it
 *     degrades every future generation, so unverified input is held back.
 *
 * Quarantine state lives in `data/quarantine.json` (gitignored).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../paths.js";
import { getMemOS, NAMESPACE } from "./memos.js";

const QUARANTINE_FILE = join(DATA_DIR, "quarantine.json");

export interface QuarantineItem {
  /** Our app UUID. */
  id: string;
  /** Unix ms when the candidate was created. */
  createdAt: number;
  /** "avoid" (from thumbs-down) or "prefer" (from thumbs-up). */
  kind: "avoid" | "prefer";
  /** The extracted trait text. */
  text: string;
  /** The user's raw feedback note, if any. */
  rawNote: string | null;
  /** The generation this came from. */
  generationId: string;
  /** The prompt of that generation, for context in the review UI. */
  generationPrompt: string;
  /** Why this was quarantined rather than stored directly. */
  reason: string;
  /** pending | approved | rejected */
  status: "pending" | "approved" | "rejected";
}

interface QuarantineState {
  items: QuarantineItem[];
}

function readState(): QuarantineState {
  if (!existsSync(QUARANTINE_FILE)) return { items: [] };
  try {
    const parsed = JSON.parse(readFileSync(QUARANTINE_FILE, "utf-8")) as QuarantineState;
    if (Array.isArray(parsed.items)) return parsed;
  } catch {
    // corrupt file — start clean rather than crash
  }
  return { items: [] };
}

function writeState(state: QuarantineState): void {
  writeFileSync(QUARANTINE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

/** Notes too short or too generic to carry signal. */
const LOW_SIGNAL_PATTERNS: RegExp[] = [
  /^(bad|good|nice|cool|ok|okay|meh|great|terrible|awful|ugly)\.?$/i,
  /^(no|yes|nope|yep)\.?$/i,
  /^(idk|dunno|whatever|fix it|redo|again)\.?$/i,
];

/** Minimum useful note length. Below this there is nothing to learn. */
const MIN_NOTE_LENGTH = 4;

/**
 * Words that indicate the user is rejecting a defining attribute rather than
 * a rendering flaw. A thumbs-down containing one of these is a contradiction
 * risk and must be reviewed before it touches memory.
 */
const IDENTITY_WORDS = [
  "hair", "eyes", "eye", "skin", "face", "outfit", "jacket", "shirt",
  "jeans", "pants", "dress", "haircolor", "hair color", "age", "build",
  "height", "species", "character", "design",
];

function isLowSignal(note: string): boolean {
  const trimmed = note.trim();
  if (trimmed.length < MIN_NOTE_LENGTH) return true;
  return LOW_SIGNAL_PATTERNS.some((re) => re.test(trimmed));
}

function touchesIdentity(note: string): boolean {
  const lower = note.toLowerCase();
  return IDENTITY_WORDS.some((w) => lower.includes(w));
}

export interface FeedbackInput {
  generationId: string;
  generationPrompt: string;
  feedback: "up" | "down";
  note?: string | null;
}

export interface FeedbackResult {
  /** What happened to this feedback. */
  outcome: "stored" | "quarantined" | "ignored";
  /** The trait text, if one was derived. */
  trait?: string;
  /** Quarantine item id, when outcome is "quarantined". */
  quarantineId?: string;
  /** Human-readable explanation, shown in the UI. */
  message: string;
}

/**
 * Turn a feedback event into either a stored memory trait or a quarantined
 * candidate. Never throws — a bad note should not break the request.
 */
export async function processFeedback(input: FeedbackInput): Promise<FeedbackResult> {
  const note = (input.note ?? "").trim();

  // Thumbs-up with no note: the user liked it. Per approved correction #8
  // this is an importance signal on the memories that shaped it, not a new
  // trait. Nothing to store as text.
  if (input.feedback === "up" && !note) {
    return {
      outcome: "ignored",
      message: "Thumbs-up recorded. No note, so nothing new was learned.",
    };
  }

  // Thumbs-up WITH a note: an explicit preference. Safe to store.
  if (input.feedback === "up" && note) {
    if (isLowSignal(note)) {
      return {
        outcome: "ignored",
        message: "Note was too generic to learn from.",
      };
    }
    await storeTraitDirectly("prefer", note, input.generationId);
    return {
      outcome: "stored",
      trait: note,
      message: `Learned preference: "${note}"`,
    };
  }

  // Thumbs-down with no note: no signal at all.
  if (input.feedback === "down" && !note) {
    return {
      outcome: "ignored",
      message: "Thumbs-down recorded, but without a note there is nothing specific to learn.",
    };
  }

  // Thumbs-down with a note → candidate "avoid" trait.
  if (isLowSignal(note)) {
    return {
      outcome: "ignored",
      message: "Note was too generic to learn from.",
    };
  }

  // Contradiction risk: the user is rejecting a defining attribute.
  // This is the weakest kind of trait to auto-store — "hair color is wrong"
  // is a complaint about a specific character, not a general rendering
  // preference, and rewriting it as "free of hair color is wrong" produces
  // a meaningless prompt fragment. Hold it so the user can reword it.
  if (touchesIdentity(note)) {
    const item = addToQuarantine({
      kind: "avoid",
      text: note,
      rawNote: note,
      generationId: input.generationId,
      generationPrompt: input.generationPrompt,
      reason:
        "References a defining attribute (appearance/identity). This is usually a complaint about a specific character rather than a general preference — approving it as-is would add a confusing phrase to future prompts. Approve only if you reword it into a general trait.",
    });
    return {
      outcome: "quarantined",
      quarantineId: item.id,
      trait: note,
      message: `Held for review — this references a defining attribute. Check it in the Quarantine tab.`,
    };
  }

  // Otherwise it is a rendering complaint, which is exactly what "avoid"
  // traits are for. Store it.
  await storeTraitDirectly("avoid", note, input.generationId);
  return {
    outcome: "stored",
    trait: note,
    message: `Learned to avoid: "${note}"`,
  };
}

/** Write a trait straight into MemOS. */
async function storeTraitDirectly(
  kind: "avoid" | "prefer",
  text: string,
  generationId: string,
): Promise<void> {
  const memos = await getMemOS();

  // Guard against duplicates. A double-click on the feedback button, or a
  // retried request, would otherwise write the same trait twice — and avoid
  // traits are injected into EVERY future prompt, so a duplicate both wastes
  // prompt budget and biases generation. MemOS has no unique constraint, so
  // the check has to happen here.
  const existing = await memos.search({
    namespace: NAMESPACE,
    tags: [kind],
    limit: 200,
  });
  const normalise = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const target = normalise(text);
  if (existing.some((sm) => normalise(sm.node.content) === target)) {
    return; // already known — nothing to learn
  }

  await memos.store(text, {
    tags: [kind],
    namespace: NAMESPACE,
    metadata: { kind, sourceGenerationId: generationId, learnedFrom: "feedback" },
    source: "user_input",
    type: "preference",
    importance: kind === "avoid" ? 0.9 : 0.6,
  });
}

function addToQuarantine(
  item: Omit<QuarantineItem, "id" | "createdAt" | "status">,
): QuarantineItem {
  const state = readState();
  const record: QuarantineItem = {
    ...item,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    status: "pending",
  };
  state.items.unshift(record);
  writeState(state);
  return record;
}

export function listQuarantine(status?: QuarantineItem["status"]): QuarantineItem[] {
  const items = readState().items;
  return status ? items.filter((i) => i.status === status) : items;
}

/** Approve a quarantined item → writes the trait into MemOS. */
export async function approveQuarantine(id: string): Promise<QuarantineItem | null> {
  const state = readState();
  const item = state.items.find((i) => i.id === id);
  if (!item || item.status !== "pending") return null;

  await storeTraitDirectly(item.kind, item.text, item.generationId);
  item.status = "approved";
  writeState(state);
  return item;
}

/** Reject a quarantined item → discarded, never written to memory. */
export function rejectQuarantine(id: string): QuarantineItem | null {
  const state = readState();
  const item = state.items.find((i) => i.id === id);
  if (!item || item.status !== "pending") return null;
  item.status = "rejected";
  writeState(state);
  return item;
}
