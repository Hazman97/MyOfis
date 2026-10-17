import type { ProviderKind } from "./entities.ts";

export interface ProviderPreset {
  id: string;
  name: string;
  kind: ProviderKind;
  base_url: string | null;
  needs_api_key: boolean;
  /** Suggested model ids; the owner can type any model id. */
  models: string[];
  hint?: string;
}

/** Shown in this order in the UI. "Custom" is always last. */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    kind: "anthropic",
    base_url: null,
    needs_api_key: true,
    models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"],
  },
  { id: "openai", name: "OpenAI", kind: "openai", base_url: null, needs_api_key: true, models: [] },
  { id: "google", name: "Google Gemini", kind: "google", base_url: null, needs_api_key: true, models: [] },
  {
    id: "openrouter",
    name: "OpenRouter",
    kind: "openai_compatible",
    base_url: "https://openrouter.ai/api/v1",
    needs_api_key: true,
    models: [],
  },
  {
    id: "groq",
    name: "Groq",
    kind: "openai_compatible",
    base_url: "https://api.groq.com/openai/v1",
    needs_api_key: true,
    models: [],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    kind: "openai_compatible",
    base_url: "https://api.deepseek.com/v1",
    needs_api_key: true,
    models: [],
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    kind: "openai_compatible",
    base_url: "http://127.0.0.1:11434/v1",
    needs_api_key: false,
    models: [],
    hint: "Run `ollama pull <model>` first. The base URL is resolved on the runner's machine.",
  },
  {
    id: "lmstudio",
    name: "LM Studio (local)",
    kind: "openai_compatible",
    base_url: "http://127.0.0.1:1234/v1",
    needs_api_key: false,
    models: [],
    hint: "Start the LM Studio local server first.",
  },
  {
    id: "custom",
    name: "Custom (OpenAI-compatible)",
    kind: "openai_compatible",
    base_url: null,
    needs_api_key: false,
    models: [],
    hint: "Any endpoint that speaks the OpenAI chat completions API.",
  },
];
