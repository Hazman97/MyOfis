import type { ModelPricing, ProviderKind } from "./entities.ts";

/**
 * Built-in USD prices per 1M tokens. Only models whose price we know for sure
 * are listed; everything else must be priced per provider in Settings, or it
 * is recorded as cost 0 with `cost_unknown = true`.
 *
 * Anthropic first-party rates, cached 2026-10-06.
 */
export const BUILTIN_PRICING: Record<string, ModelPricing> = {
  "claude-fable-5-1": { input_per_mtok: 10, output_per_mtok: 50 },
  "claude-opus-5-5": { input_per_mtok: 4, output_per_mtok: 20 },
  "claude-opus-5": { input_per_mtok: 5, output_per_mtok: 25 },
  "claude-sonnet-5-5": { input_per_mtok: 2, output_per_mtok: 10 },
  "claude-sonnet-5": { input_per_mtok: 2, output_per_mtok: 10 },
  // Haiku 5.5: prompts up to 100K tokens. Longer prompts cost more; Phase 1 jobs stay well under.
  "claude-haiku-5-5": { input_per_mtok: 0.1, output_per_mtok: 0.5 },
  "claude-haiku-4-5": { input_per_mtok: 1, output_per_mtok: 5 },
};

export interface CostResult {
  cost_usd: number;
  cost_unknown: boolean;
}

export function computeCost(opts: {
  kind: ProviderKind;
  base_url: string | null;
  model: string;
  tokens_in: number;
  tokens_out: number;
  overrides?: Record<string, ModelPricing>;
}): CostResult {
  const price = opts.overrides?.[opts.model] ?? BUILTIN_PRICING[opts.model];
  if (price) {
    const cost = (opts.tokens_in * price.input_per_mtok + opts.tokens_out * price.output_per_mtok) / 1_000_000;
    return { cost_usd: Math.round(cost * 1e6) / 1e6, cost_unknown: false };
  }
  if (opts.kind === "mock" || isLocalUrl(opts.base_url)) return { cost_usd: 0, cost_unknown: false };
  return { cost_usd: 0, cost_unknown: opts.tokens_in + opts.tokens_out > 0 };
}

function isLocalUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}
