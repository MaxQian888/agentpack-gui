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
  /** Set only on models that surcharge oversized prompts — see below. */
  longContext?: LongContextTier
}

/**
 * Long-context surcharge. Anthropic bills a request whose prompt crosses
 * `threshold` at a raised rate **for the whole request**, not just the excess.
 *
 * It applies to Sonnet 4.5 / Sonnet 4 on the 1M-token beta (2× input, 1.5×
 * output above 200K). Sonnet 4.6 and Opus 4.6+ dropped it: their full 1M window
 * is flat-rate, which is why those ids can't share a table entry with 4.5.
 *
 * Only `estimateRequestCost` can honour it — a session total says nothing about
 * how large any single prompt was.
 * Source: docs.claude.com/en/docs/about-claude/pricing (long-context pricing)
 */
export interface LongContextTier {
  threshold: number
  inputMultiplier: number
  outputMultiplier: number
}

/** Anthropic's 1M-beta surcharge, as it stands for Sonnet 4.5 / Sonnet 4. */
const SONNET_1M_TIER: LongContextTier = {
  threshold: 200_000,
  inputMultiplier: 2,
  outputMultiplier: 1.5,
}

const p = (
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
  longContext?: LongContextTier
): ModelPrice => ({
  input,
  output,
  cacheRead,
  cacheWrite,
  ...(longContext ? { longContext } : {}),
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
  // Flat-rate across the full 1M window.
  { keys: ["claude-sonnet-5", "claude-sonnet-4-6"], price: p(3, 15, 0.3, 3.75) },
  // Same base rate, but surcharged past 200K on the 1M beta.
  {
    keys: ["claude-sonnet-4-5", "claude-sonnet-4-0"],
    price: p(3, 15, 0.3, 3.75, SONNET_1M_TIER),
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
 *
 * Always uses base rates: a session total is the sum of many prompts, so it
 * carries no evidence about whether any single one crossed a long-context
 * threshold. Use {@link estimateRequestCost} where per-request usage is known.
 */
export function estimateCost(
  source: HistorySource,
  model: string,
  usage: TokenUsage
): number | null {
  const price = priceForModel(model)
  if (!price) return null
  return priceUsage(source, price, usage)
}

/**
 * Cost of a *single* request. Same rates, except that a prompt over the model's
 * long-context threshold is billed at the raised rate in full — which only a
 * per-request view can tell.
 */
export function estimateRequestCost(
  source: HistorySource,
  model: string,
  usage: TokenUsage
): number | null {
  const base = priceForModel(model)
  if (!base) return null
  return priceUsage(source, applyLongContext(base, usage), usage)
}

/**
 * `price` with the long-context surcharge folded in when this request's prompt
 * crosses the threshold, else `price` unchanged. Cache rates scale with input:
 * a cache read is a fixed fraction of the input rate, so doubling one doubles
 * the other.
 */
function applyLongContext(price: ModelPrice, usage: TokenUsage): ModelPrice {
  const tier = price.longContext
  if (!tier) return price
  // Claude's buckets are disjoint, so the prompt is all three input-side ones;
  // for Codex `input` already subsumes the cached part, and no Codex model in
  // the table carries a tier anyway.
  const prompt = usage.input + usage.cacheRead + usage.cacheWrite
  if (prompt <= tier.threshold) return price
  return {
    input: price.input * tier.inputMultiplier,
    output: price.output * tier.outputMultiplier,
    cacheRead: price.cacheRead * tier.inputMultiplier,
    cacheWrite: price.cacheWrite * tier.inputMultiplier,
  }
}

function priceUsage(source: HistorySource, price: ModelPrice, usage: TokenUsage): number {
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
