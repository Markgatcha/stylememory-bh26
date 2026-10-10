/**
 * Workflow introspection — reads node IDs and key inputs from the API-format
 * workflow JSON. Never hardcodes node IDs; everything comes from the file.
 */
import { readFileSync, existsSync } from "node:fs";

export interface WorkflowNodes {
  /** The KSampler node ID (has seed, steps, cfg, sampler_name, scheduler). */
  sampler: string;
  /** The positive text-encoding node ID (has prompt input). */
  positive: string;
  /** The negative text-encoding node ID, if separate from positive. */
  negative: string | null;
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
  // The positive node's output feeds the sampler's "positive" input.
  // The negative node's output feeds the sampler's "negative" input.
  let positive: string | null = null;
  let negative: string | null = null;
  if (nodes.sampler) {
    const samplerInputs = raw[nodes.sampler]!.inputs;
    for (const encId of encodeNodes) {
      const nodeInputs = raw[encId]!.inputs;
      // Check if this node's input name hints at negative
      const negHint = typeof nodeInputs.negative_prompt === "string" || (nodeInputs.text ?? "").toString().startsWith("bad");
      if (negHint && !negative) negative = encId;
    }
    // If we couldn't distinguish by hint, use the first encode node as positive
    // and the second (if any) as negative.
    if (!positive) {
      positive = encodeNodes.find((id) => id !== negative) ?? encodeNodes[0] ?? null;
    }
  }

  if (!positive) positive = encodeNodes[0] ?? null;

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
      negative,
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
