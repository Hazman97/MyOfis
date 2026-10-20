/**
 * Model choice helpers (owner, 2026-10-20: "auto first, then fall back when a model hits its limit").
 * An agent whose model is "auto" uses its provider's model list, best first; when a model fails
 * before saying anything (limit, payment, unavailable), the runner tries the next one.
 */
export const AUTO_MODEL = "auto";
/** At most this many models are tried for one run. */
export const AUTO_TRIES = 5;

/** How capable a model is likely to be for agent work (tools, long instructions). Higher is better. */
export function modelRank(id: string): number {
  const m = id.toLowerCase();
  const rules: [RegExp, number][] = [
    [/claude[-_. ]?opus/, 100],
    [/claude[-_. ]?sonnet/, 95],
    [/gpt-5(?!.*(mini|nano))/, 92],
    [/gemini-3[\w.-]*-pro|gemini-3[.\d]*-pro/, 90],
    [/codex/, 86],
    [/claude[-_. ]?haiku/, 80],
    [/kimi-k[23]|deepseek-v4|glm-5|qwen3[.\d]*-(max|coder|plus)/, 78],
    [/nemotron-3-ultra|nemotron.*550b/, 74],
    [/minimax-m3/, 70],
    [/kilo-auto|openrouter\/free|beam/, 62],
    [/nemotron-3[.\d]*-super/, 60],
    [/gemini.*flash|gpt-.*mini/, 58],
    [/laguna-s|north-mini|dots-3/, 50],
    [/lightning|nano|lite|xs-|2\.6b|-mini|small/, 25],
  ];
  for (const [re, score] of rules) if (re.test(m)) return score;
  return 40;
}

/** Best first; equal ranks keep their order. */
export const rankModels = (ids: string[]): string[] =>
  ids
    .map((id, i) => ({ id, i, r: modelRank(id) }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .map((x) => x.id);

/** The models a run may use, in order: one fixed model, or for "auto" the provider's best few. */
export function modelCandidates(model: string, providerModels: string[] = []): string[] {
  if (model !== AUTO_MODEL) return [model];
  return rankModels([...new Set(providerModels.filter((m) => m && m !== AUTO_MODEL))]).slice(0, AUTO_TRIES);
}
