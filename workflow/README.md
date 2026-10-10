# Qwen Image 2.1 Turbo — ComfyUI Workflow (API format)

Export this from ComfyUI after the opening ceremony: **menu → Export (API)**.

Save the exported JSON as `qwen-image.json` in this folder.

The server introspects the JSON to find:
- Positive conditioning node (CLIPTextEncode or TextEncodeQwenImage)
- Negative conditioning node
- KSampler node (seed, steps, cfg, sampler_name, scheduler)
- EmptyLatentImage node (width, height)
- LoadImage node (image input, if editing)

Node IDs are read from the exported JSON — never hardcoded.
