import type { ModelVariant } from "@/types/worker";

export interface ModelSpec {
  id: ModelVariant;
  label: "2B" | "4B";
  name: string;
  sizeLabel: string;
  approxBytes: number;
  fileName: string;
  urls: readonly string[];
  description: string;
}

const HUGGING_FACE = "https://huggingface.co/litert-community";

export const MODELS: Record<ModelVariant, ModelSpec> = {
  e2b: {
    id: "e2b",
    label: "2B",
    name: "Gemma 4 E2B",
    sizeLabel: "2.0 GB",
    approxBytes: 2_008 * 1024 * 1024,
    fileName: "gemma-4-E2B-it-web.litertlm",
    urls: [
      `${HUGGING_FACE}/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm`,
      `${HUGGING_FACE}/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-gpu.litertlm`,
    ],
    description: "Smaller model for phones and computers with under 8 GB of memory.",
  },
  e4b: {
    id: "e4b",
    label: "4B",
    name: "Gemma 4 E4B",
    sizeLabel: "2.9 GB",
    approxBytes: 2_969 * 1024 * 1024,
    fileName: "gemma-4-E4B-it-web.litertlm",
    urls: [
      `${HUGGING_FACE}/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it-web.litertlm`,
      `${HUGGING_FACE}/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it-gpu.litertlm`,
    ],
    description: "Larger model for computers with at least 8 GB of memory.",
  },
};

export const WASM_RUNTIME_URL = "/litertlm/";

export const SYSTEM_PROMPT = `You translate medical jargon into plain language a patient can read.
Rules:
- Explain the words accurately and briefly.
- Use short sentences and everyday words.
- Keep numbers, doses, and units exactly as written.
- Do not diagnose, prescribe, or give medical advice.
- Do not add facts that are not in the source text.
- If the text asks what to do, translate it and say a clinician has to interpret it.`;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 MB";
  }
  const gibibyte = 1024 * 1024 * 1024;
  const mebibyte = 1024 * 1024;
  if (bytes >= gibibyte) {
    return `${(bytes / gibibyte).toFixed(1)} GB`;
  }
  return `${Math.round(bytes / mebibyte)} MB`;
}
