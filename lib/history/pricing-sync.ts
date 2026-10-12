/**
 * Model prices synced from models.dev — the pure half.
 *
 * `fetch_model_catalog` (Rust) downloads `https://models.dev/api.json`; this
 * file turns that ~5 MB catalog into the small table `pricing.ts` consults
 * first, and reads and writes the cached copy at
 * `~/.agentpack/model-prices.json`. Browser-safe and unit-tested; the disk and
 * network half is `lib/tauri/pricing.ts`.
 *
 * Two rules:
 *
 * 1. **Only the vendor's own price.** The catalog lists one model under dozens
 *    of resellers at dozens of prices — `gpt-5.6-sol` appears 35 times, input
 *    from $1.5 to $5. A transcript from Claude Code or Codex was billed at the
 *    vendor's rate (or not at all, on a subscription), so a reseller's number
 *    is just a different wrong answer. A model no vendor lists stays unpriced:
 *    a missing number is honest, a plausible one is not.
 * 2. **The cache is a cache.** A file that won't parse, or was written by a
 *    future version, reads as "never synced" — the next sync replaces it — and
 *    never as an error the dashboard has to explain.
 */

import type { LongContextTier, ModelPrice } from "./pricing"

/**
 * The providers whose listing is the vendor's own price, in priority order:
 * the first one that lists an id wins. Hosts and resellers (Bedrock, Azure,
 * OpenRouter, …) are deliberately absent.
 */
export const VENDOR_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "deepseek",
  "zai",
  "zhipuai",
  "meta",
  "xai",
  "mistral",
  "moonshotai",
  "alibaba",
  "minimax",
  "cohere",
  "poolside",
  "llama",
] as const

export const PRICE_SOURCE = "models.dev"
export const SYNCED_PRICES_VERSION = 1
/** How old a sync may get before the startup check fetches a fresh one. */
export const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface SyncedPrices {
  version: number
  source: string
  /** When the catalog was fetched (epoch ms). */
  fetchedAt: number
  /** Lower-cased model id → USD per 1M tokens. */
  models: Record<string, ModelPrice>
}

export function syncedPricesPath(home: string): string {
  return `${home}/.agentpack/model-prices.json`
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined

/**
 * One catalog `cost` object as a `ModelPrice`, or null when it carries no
 * usable input/output rate (image models list `cost: null`).
 *
 * A context tier becomes the long-context surcharge: models.dev states the
 * tier's rates outright, `LongContextTier` as multipliers of the base, so they
 * are divided back out. Only the first `context` tier is kept — no vendor lists
 * more than one, and `estimateRequestCost` models exactly one threshold.
 */
export function priceFromCost(cost: unknown): ModelPrice | null {
  if (!cost || typeof cost !== "object") return null
  const c = cost as Record<string, unknown>
  const input = num(c.input)
  const output = num(c.output)
  if (input === undefined || output === undefined) return null
  const price: ModelPrice = {
    input,
    output,
    cacheRead: num(c.cache_read) ?? 0,
    cacheWrite: num(c.cache_write) ?? 0,
  }
  const tier = Array.isArray(c.tiers)
    ? (c.tiers as Record<string, unknown>[]).find(
        (t) => (t?.tier as Record<string, unknown> | undefined)?.type === "context"
      )
    : undefined
  const threshold = num((tier?.tier as Record<string, unknown> | undefined)?.size)
  const tierIn = num(tier?.input)
  const tierOut = num(tier?.output)
  if (threshold && tierIn !== undefined && tierOut !== undefined && input > 0 && output > 0) {
    const longContext: LongContextTier = {
      threshold,
      inputMultiplier: tierIn / input,
      outputMultiplier: tierOut / output,
    }
    price.longContext = longContext
  }
  return price
}

/**
 * The vendor prices out of a parsed models.dev catalog. Throws when the input
 * isn't a catalog at all, so a sync that fetched an error page doesn't replace
 * a good cache with an empty one.
 */
export function extractVendorPrices(catalog: unknown, fetchedAt: number): SyncedPrices {
  if (!catalog || typeof catalog !== "object") throw new Error("not a models.dev catalog")
  const providers = catalog as Record<string, { models?: Record<string, { cost?: unknown }> }>
  const models: Record<string, ModelPrice> = {}
  for (const vendor of VENDOR_PROVIDERS) {
    for (const [id, model] of Object.entries(providers[vendor]?.models ?? {})) {
      const key = id.toLowerCase()
      if (key in models) continue
      const price = priceFromCost(model?.cost)
      if (price) models[key] = price
    }
  }
  if (Object.keys(models).length === 0) throw new Error("no vendor prices in the catalog")
  return { version: SYNCED_PRICES_VERSION, source: PRICE_SOURCE, fetchedAt, models }
}

/** The cached copy, or null for anything that isn't one this version wrote. */
export function parseSyncedPrices(text: string): SyncedPrices | null {
  if (!text.trim()) return null
  try {
    const data = JSON.parse(text) as Partial<SyncedPrices>
    if (data.version !== SYNCED_PRICES_VERSION) return null
    if (typeof data.fetchedAt !== "number" || !data.models || typeof data.models !== "object") {
      return null
    }
    const models: Record<string, ModelPrice> = {}
    for (const [id, raw] of Object.entries(data.models)) {
      const p = raw as Partial<ModelPrice>
      if (num(p?.input) === undefined || num(p?.output) === undefined) continue
      models[id] = {
        input: p.input!,
        output: p.output!,
        cacheRead: num(p.cacheRead) ?? 0,
        cacheWrite: num(p.cacheWrite) ?? 0,
        ...(p.longContext ? { longContext: p.longContext } : {}),
      }
    }
    return {
      version: SYNCED_PRICES_VERSION,
      source: data.source ?? PRICE_SOURCE,
      fetchedAt: data.fetchedAt,
      models,
    }
  } catch {
    return null
  }
}

export function serializeSyncedPrices(prices: SyncedPrices): string {
  return JSON.stringify(prices)
}

/** Whether the startup check should fetch: never synced, or synced over a day ago. */
export function syncDue(fetchedAt: number | null, now: number): boolean {
  return fetchedAt === null || now - fetchedAt >= SYNC_INTERVAL_MS
}
