import type { HistorySource, TokenUsage } from "./types"

/**
 * Model pricing table — USD per 1,000,000 tokens.
 *
 * OpenCode records real per-session cost, so its sessions never need this. But
 * Claude Code and Codex only persist token counts, so we estimate their cost
 * from these rates. Keep this table current — prices as of **2026-07**:
 *
 * - Anthropic Claude — from the claude-api reference. Cache read ≈ 0.1× input,
 *   5-minute cache write ≈ 1.25× input.
 *   Sources: platform.claude.com/docs/en/about-claude/models/overview,
 *   platform.claude.com/docs/en/build-with-claude/prompt-caching
 * - OpenAI / Codex — cached input ≈ 0.1× input; OpenAI has no cache-write fee.
 *   Sources: developers.openai.com/api/docs/pricing, pricepertoken.com
 * - DeepSeek (OpenCode proxies) — api-docs.deepseek.com/quick_start/pricing
 *
 * Rates change; treat non-OpenCode costs as estimates.
 */
export interface ModelPrice {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

const p = (input: number, output: number, cacheRead: number, cacheWrite: number): ModelPrice => ({
  input,
  output,
  cacheRead,
  cacheWrite,
})

/** Ordered most-specific-first; a model id matches the first entry it contains. */
const TABLE: { keys: string[]; price: ModelPrice }[] = [
  // ── Anthropic Claude ──
  { keys: ["claude-fable-5", "claude-mythos-5"], price: p(10, 50, 1.0, 12.5) },
  {
    keys: ["claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5"],
    price: p(5, 25, 0.5, 6.25),
  },
  { keys: ["claude-opus-4-1", "claude-opus-4-0"], price: p(15, 75, 1.5, 18.75) },
  {
    keys: ["claude-sonnet-5", "claude-sonnet-4-6", "claude-sonnet-4-5", "claude-sonnet-4-0"],
    price: p(3, 15, 0.3, 3.75),
  },
  { keys: ["claude-haiku-4-5"], price: p(1, 5, 0.1, 1.25) },
  { keys: ["claude-3-5-haiku", "claude-haiku-3-5"], price: p(0.8, 4, 0.08, 1.0) },
  { keys: ["claude-3-haiku"], price: p(0.25, 1.25, 0.03, 0.3) },
  // ── OpenAI / Codex ── (no cache-write fee)
  { keys: ["gpt-5.3-codex", "gpt-5-3-codex", "gpt-5.2-codex"], price: p(1.75, 14, 0.175, 0) },
  { keys: ["gpt-5.1-codex", "gpt-5-1-codex", "gpt-5-codex"], price: p(1.25, 10, 0.125, 0) },
  { keys: ["gpt-5"], price: p(1.25, 10, 0.125, 0) },
  { keys: ["o4-mini"], price: p(1.1, 4.4, 0.275, 0) },
  { keys: ["o3"], price: p(2, 8, 0.5, 0) },
  { keys: ["gpt-4.1"], price: p(2, 8, 0.5, 0) },
  { keys: ["gpt-4o"], price: p(2.5, 10, 1.25, 0) },
  // ── DeepSeek (OpenCode proxies; here for transparency) ──
  { keys: ["deepseek-v4-pro"], price: p(1.74, 3.48, 0.0145, 0) },
  {
    keys: ["deepseek-v4-flash", "deepseek-chat", "deepseek-reasoner", "deepseek-v3", "deepseek"],
    price: p(0.14, 0.28, 0.0028, 0),
  },
]

/** The pricing for a model id, or null when the model isn't in the table. */
export function priceForModel(model: string): ModelPrice | null {
  const id = model.toLowerCase()
  for (const entry of TABLE) {
    if (entry.keys.some((k) => id.includes(k))) return entry.price
  }
  return null
}

/**
 * Estimate a session's USD cost from token usage and current pricing. Returns
 * null when the model has no known rate. Codex reports cached tokens as a subset
 * of `input` (so non-cached input is `input − cacheRead`); Claude reports the
 * four token buckets as disjoint, so they're priced independently.
 */
export function estimateCost(
  source: HistorySource,
  model: string,
  usage: TokenUsage
): number | null {
  const price = priceForModel(model)
  if (!price) return null
  const M = 1_000_000
  if (source === "codex") {
    const nonCachedInput = Math.max(0, usage.input - usage.cacheRead)
    const cacheReadPrice = price.cacheRead || price.input * 0.1
    return (
      (nonCachedInput * price.input +
        usage.cacheRead * cacheReadPrice +
        usage.output * price.output) /
      M
    )
  }
  // Claude (and any other source we estimate): disjoint token buckets.
  return (
    (usage.input * price.input +
      usage.output * price.output +
      usage.cacheRead * price.cacheRead +
      usage.cacheWrite * price.cacheWrite) /
    M
  )
}
