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
    id: "9router",
    name: "9Router (local, free models)",
    kind: "openai_compatible",
    base_url: "http://localhost:20128/v1",
    needs_api_key: false,
    models: [],
    hint: "Run `9router` on this PC, open http://localhost:20128/dashboard and connect a provider (e.g. Kiro or Gemini CLI, free with a login). Then press Load models and Test.",
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
    id: "hermes-agent",
    name: "Hermes Agent (Nous Research)",
    kind: "openai_compatible",
    base_url: "http://192.168.1.50:8642/v1",
    needs_api_key: true,
    models: ["hermes-agent"],
    hint: "Change the IP to the PC running `hermes gateway` (API_SERVER_ENABLED=true, API_SERVER_HOST=0.0.0.0). The key is its API_SERVER_KEY. Hermes uses its own tools there; see docs/hermes-agent.md.",
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
