import {
  extractVendorPrices,
  parseSyncedPrices,
  priceFromCost,
  serializeSyncedPrices,
  SYNC_INTERVAL_MS,
  syncDue,
  syncedPricesPath,
  SYNCED_PRICES_VERSION,
} from "./pricing-sync"

const catalog = {
  // A reseller listed first in the file must not win.
  "nano-gpt": { models: { "gpt-6-astra": { cost: { input: 1, output: 2 } } } },
  openai: {
    models: {
      "gpt-6-astra": {
        cost: {
          input: 10,
          output: 50,
          cache_read: 1,
          cache_write: 12.5,
          tiers: [
            { input: 20, output: 75, cache_read: 2, tier: { type: "context", size: 272000 } },
          ],
        },
      },
      "chatgpt-image-latest": { cost: null },
    },
  },
  anthropic: { models: { "Claude-Opus-5-5": { cost: { input: 4, output: 20, cache_read: 0.2 } } } },
  "amazon-bedrock": { models: { "only-on-bedrock": { cost: { input: 1, output: 1 } } } },
}

describe("extractVendorPrices", () => {
  const out = extractVendorPrices(catalog, 123)

  it("takes the vendor's own price, never a reseller's or a host's", () => {
    expect(out.models["gpt-6-astra"]).toMatchObject({ input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 }) // prettier-ignore
    expect(out.models["only-on-bedrock"]).toBeUndefined()
  })

  it("keys by lower-cased id, defaults a missing cache rate to zero, skips unpriced models", () => {
    expect(out.models["claude-opus-5-5"]).toEqual({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 0 }) // prettier-ignore
    expect(out.models["chatgpt-image-latest"]).toBeUndefined()
  })

  it("turns a context tier into the long-context surcharge", () => {
    expect(out.models["gpt-6-astra"].longContext).toEqual({
      threshold: 272000,
      inputMultiplier: 2,
      outputMultiplier: 1.5,
    })
  })

  it("stamps the fetch and the source", () => {
    expect(out).toMatchObject({
      version: SYNCED_PRICES_VERSION,
      source: "models.dev",
      fetchedAt: 123,
    })
  })

  it("refuses something that isn't a catalog, so a bad fetch can't empty the cache", () => {
    expect(() => extractVendorPrices(null, 1)).toThrow()
    expect(() => extractVendorPrices({ "nano-gpt": catalog["nano-gpt"] }, 1)).toThrow()
  })
})

it("priceFromCost ignores a tier of another type and a negative rate", () => {
  expect(priceFromCost({ input: 1, output: 2, tiers: [{ input: 2, output: 4, tier: { type: "time" } }] })).toEqual({ input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }) // prettier-ignore
  expect(priceFromCost({ input: -1, output: 2 })).toBeNull()
  expect(priceFromCost("free")).toBeNull()
})

describe("the cached copy", () => {
  it("round-trips", () => {
    const prices = extractVendorPrices(catalog, 99)
    expect(parseSyncedPrices(serializeSyncedPrices(prices))).toEqual(prices)
  })

  it("reads anything it didn't write as never synced", () => {
    expect(parseSyncedPrices("")).toBeNull()
    expect(parseSyncedPrices("{not json")).toBeNull()
    expect(parseSyncedPrices(JSON.stringify({ version: 99, fetchedAt: 1, models: {} }))).toBeNull()
    expect(parseSyncedPrices(JSON.stringify({ version: 1, models: {} }))).toBeNull()
  })

  it("drops a malformed entry and keeps the rest", () => {
    const text = JSON.stringify({
      version: 1,
      fetchedAt: 5,
      models: { good: { input: 1, output: 2 }, bad: { input: "x" } },
    })
    expect(parseSyncedPrices(text)?.models).toEqual({
      good: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    })
  })

  it("lives in ~/.agentpack", () => {
    expect(syncedPricesPath("/h")).toBe("/h/.agentpack/model-prices.json")
  })
})

it("is due when never synced or a day old", () => {
  expect(syncDue(null, 0)).toBe(true)
  expect(syncDue(1000, 1000 + SYNC_INTERVAL_MS - 1)).toBe(false)
  expect(syncDue(1000, 1000 + SYNC_INTERVAL_MS)).toBe(true)
})
