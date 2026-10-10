/**
 * Workflow introspection — reads node IDs and key inputs from the API-format
 * workflow JSON. Never hardcodes node IDs; everything comes from the file.
 */
import { readFileSync, existsSync } from "node:fs";

export interface WorkflowNodes {
  /** The KSampler node ID (has seed, steps, cfg, sampler_name, scheduler). */
  sampler: string;
  /** The positive text-encoding node ID (holds the prompt input). */
  positive: string;
  /**
   * The input name on the positive node that carries the prompt text.
   * Model-dependent: `prompt` for Qwen, `text` for stock CLIPTextEncode.
   * Callers must patch THIS field rather than assuming a name.
   */
  positivePromptInput: string;
  /** The negative text-encoding node ID, if separate from positive. */
  negative: string | null;
  /** The negative prompt input name, when a negative node exists. */
  negativePromptInput: string | null;
  /** The EmptyLatentImage node ID (has width, height, batch_size). */
  latent: string;
  /** The SaveImage node ID (has images input). */
  save: string;
  /** The UnetLoaderGGUF node ID (has unet_name). */
  unet: string;
  /** The CLIPLoader node ID (has clip_name). */
  clip: string;
  /** The VAELoader node ID (has vae_name). */
  vae: string;
  /** The LoadImage node ID (has image input), if present. */
  loadImage: string | null;
}

export interface LoadedWorkflow {
  nodes: WorkflowNodes;
  raw: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
}

const SAMPLER_TYPES = new Set(["KSampler", "KSamplerAdvanced", "SamplerCustom"]);
const ENCODE_TYPES = new Set(["CLIPTextEncode", "TextEncodeQwenImage21", "CLIPTextEncodeSDXL"]);
const LATENT_TYPES = new Set(["EmptyLatentImage", "EmptyLatentImagePresets"]);
const SAVE_TYPES = new Set(["SaveImage", "SaveImageWebsocket", "PreviewImage"]);
const UNET_TYPES = new Set(["UnetLoaderGGUF", "UNETLoader"]);
const CLIP_TYPES = new Set(["CLIPLoader", "DualCLIPLoader"]);
const VAE_TYPES = new Set(["VAELoader"]);
const LOAD_IMG_TYPES = new Set(["LoadImage", "LoadImageMask"]);

/**
 * Input names that hold the text prompt, in the order we prefer them.
 *
 * Model-specific schemas differ: Qwen's TextEncodeQwenImage21 uses `prompt`,
 * stock SD/SDXL/Flux CLIPTextEncode uses `text`. Rather than branching on
 * node class, look for whichever of these the node actually declares — that
 * keeps the introspector working for models it has never seen.
 */
const PROMPT_INPUT_NAMES = ["prompt", "text"] as const;

/** Input names that hold the negative prompt. */
const NEGATIVE_INPUT_NAMES = ["negative_prompt", "negative"] as const;

/**
 * Load and introspect the API-format workflow JSON.
 * Throws if the file doesn't exist or is missing required nodes.
 */
export function loadWorkflow(filePath: string): LoadedWorkflow {
  if (!existsSync(filePath)) {
    throw new Error(`Workflow file not found: ${filePath}`);
  }
  const raw = JSON.parse(readFileSync(filePath, "utf-8")) as Record<
    string,
    { class_type: string; inputs: Record<string, unknown> }
  >;

  const nodes: Partial<WorkflowNodes> = {};
  const encodeNodes: string[] = [];

  for (const [id, node] of Object.entries(raw)) {
    const ct = node.class_type;
    if (SAMPLER_TYPES.has(ct) && !nodes.sampler) nodes.sampler = id;
    if (ENCODE_TYPES.has(ct)) encodeNodes.push(id);
    if (LATENT_TYPES.has(ct) && !nodes.latent) nodes.latent = id;
    if (SAVE_TYPES.has(ct) && !nodes.save) nodes.save = id;
    if (UNET_TYPES.has(ct) && !nodes.unet) nodes.unet = id;
    if (CLIP_TYPES.has(ct) && !nodes.clip) nodes.clip = id;
    if (VAE_TYPES.has(ct) && !nodes.vae) nodes.vae = id;
    if (LOAD_IMG_TYPES.has(ct) && !nodes.loadImage) nodes.loadImage = id;
  }

  // Distinguish positive from negative encoding nodes.
  //
  // Preferred signal: the sampler's `positive`/`negative` inputs point at
  // specific node ids. That is authoritative and works for any model, so use
  // it first and only fall back to heuristics when the sampler's inputs are
  // links we cannot resolve.
  let positive: string | null = null;
  let negative: string | null = null;

  const samplerInputs = nodes.sampler ? raw[nodes.sampler]!.inputs : null;
  const linkTarget = (v: unknown): string | null =>
    Array.isArray(v) && typeof v[0] === "string" ? v[0] : null;

  if (samplerInputs) {
    const pos = linkTarget(samplerInputs.positive);
    const neg = linkTarget(samplerInputs.negative);
    // Only trust the link if it actually points at an encode node.
    if (pos && encodeNodes.includes(pos)) positive = pos;
    if (neg && encodeNodes.includes(neg)) negative = neg;
  }

  if (!positive || !negative) {
    // Fallback heuristics for graphs where the sampler's conditioning inputs
    // are not simple links. Both checks are shape-based, not model-specific.
    for (const encId of encodeNodes) {
      const nodeInputs = raw[encId]!.inputs;
      const declaresNegative =
        NEGATIVE_INPUT_NAMES.some((n) => n in nodeInputs) ||
        (typeof nodeInputs.text === "string" && /^(bad|blurry|deformed|ugly|low quality)/i.test(nodeInputs.text));
      if (declaresNegative && !negative) negative = encId;
    }
    if (!positive) {
      positive = encodeNodes.find((id) => id !== negative) ?? encodeNodes[0] ?? null;
    }
  }

  if (!positive) positive = encodeNodes[0] ?? null;

  // Resolve which input field actually carries the prompt text on each node.
  // This is the model-portable part: a Qwen node declares `prompt`, a stock
  // CLIPTextEncode declares `text`. Reading it from the node rather than
  // assuming it means swapping models needs no code change.
  const promptInputFor = (nodeId: string | null): string => {
    if (!nodeId) return PROMPT_INPUT_NAMES[0];
    const inputs = raw[nodeId]!.inputs;
    for (const name of PROMPT_INPUT_NAMES) {
      if (name in inputs) return name;
    }
    return PROMPT_INPUT_NAMES[0];
  };

  const negativeInputFor = (nodeId: string | null): string | null => {
    if (!nodeId) return null;
    const inputs = raw[nodeId]!.inputs;
    for (const name of NEGATIVE_INPUT_NAMES) {
      if (name in inputs) return name;
    }
    return null;
  };

  // Validate required nodes
  const missing: string[] = [];
  if (!nodes.sampler) missing.push("sampler (KSampler)");
  if (!positive) missing.push("positive (text encode)");
  if (!nodes.latent) missing.push("latent (EmptyLatentImage)");
  if (!nodes.save) missing.push("save (SaveImage)");
  if (missing.length > 0) {
    throw new Error(`Workflow missing required nodes: ${missing.join(", ")}`);
  }

  return {
    nodes: {
      sampler: nodes.sampler!,
      positive: positive!,
      positivePromptInput: promptInputFor(positive),
      negative,
      negativePromptInput: negativeInputFor(negative),
      latent: nodes.latent!,
      save: nodes.save!,
      unet: nodes.unet!,
      clip: nodes.clip!,
      vae: nodes.vae!,
      loadImage: nodes.loadImage ?? null,
    },
    raw,
  };
}
