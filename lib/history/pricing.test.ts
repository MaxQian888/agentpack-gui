import {
  estimateCost,
  estimateRequestCost,
  idCandidates,
  lookupPrice,
  priceForModel,
  setSyncedPrices,
} from "./pricing"
import type { TokenUsage } from "./types"

const usage = (over: Partial<TokenUsage> = {}): TokenUsage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  total: 0,
  ...over,
})

describe("priceForModel", () => {
  it("prices current Claude models", () => {
    expect(priceForModel("claude-opus-4-8")).toEqual({
      input: 5,
      output: 25,
      cacheRead: 0.5,
      cacheWrite: 6.25,
    })
    expect(priceForModel("claude-sonnet-5")?.input).toBe(3)
    expect(priceForModel("claude-haiku-4-5")?.output).toBe(5)
  })

  it("prices Codex / OpenAI models with no cache-write fee", () => {
    const codex = priceForModel("gpt-5.3-codex")
    expect(codex).toEqual({ input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 })
    expect(priceForModel("gpt-5-codex")?.input).toBe(1.25)
  })

  it("prefers the more specific codex entry over the generic gpt-5 entry", () => {
    // gpt-5.3-codex must not fall through to the plain "gpt-5" row.
    expect(priceForModel("gpt-5.3-codex")?.output).toBe(14)
    expect(priceForModel("gpt-5")?.output).toBe(10)
  })

  it("returns null for an unknown model", () => {
    expect(priceForModel("totally-made-up")).toBeNull()
    expect(priceForModel("")).toBeNull()
  })
})

describe("estimateCost", () => {
  it("prices Claude usage as disjoint buckets", () => {
    // input 1M, output 1M, cacheRead 1M, cacheWrite 1M on Opus 4.8.
    const c = estimateCost(
      "claude",
      "claude-opus-4-8",
      usage({ input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6, total: 4e6 })
    )
    expect(c).toBeCloseTo(5 + 25 + 0.5 + 6.25)
  })

  it("subtracts cached tokens from input for Codex", () => {
    // Codex input includes cached: 1M input of which 0.5M cached, on gpt-5-codex.
    const c = estimateCost(
      "codex",
      "gpt-5-codex",
      usage({ input: 1e6, cacheRead: 0.5e6, output: 1e6, total: 2e6 })
    )
    // 0.5M non-cached × $1.25 + 0.5M cached × $0.125 + 1M output × $10
    expect(c).toBeCloseTo(0.5 * 1.25 + 0.5 * 0.125 + 1 * 10)
  })

  it("returns null when the model is unknown", () => {
    expect(estimateCost("claude", "mystery-model", usage({ input: 1e6 }))).toBeNull()
  })
})

describe("long-context pricing", () => {
  it("marks only the models that actually surcharge oversized prompts", () => {
    // Sonnet 4.5 / 4 carry the 1M-beta surcharge; Sonnet 4.6 and Opus 4.6+
    // dropped it, so their full window is flat-rate.
    expect(priceForModel("claude-sonnet-4-5")?.longContext).toEqual({
      threshold: 200_000,
      inputMultiplier: 2,
      outputMultiplier: 1.5,
    })
    expect(priceForModel("claude-sonnet-4-6")?.longContext).toBeUndefined()
    expect(priceForModel("claude-opus-4-8")?.longContext).toBeUndefined()
  })

  it("bills the whole request at the raised rate once the prompt crosses over", () => {
    const over = estimateRequestCost(
      "claude",
      "claude-sonnet-4-5",
      usage({ input: 250_000, output: 10_000 })
    )
    // 250K × $6/M + 10K × $22.50/M — the surcharge applies to every token in
    // the request, not just the 50K above the threshold.
    expect(over).toBeCloseTo(0.25 * 6 + 0.01 * 22.5)
  })

  it("leaves a request under the threshold at base rates", () => {
    const under = estimateRequestCost(
      "claude",
      "claude-sonnet-4-5",
      usage({ input: 150_000, output: 10_000 })
    )
    expect(under).toBeCloseTo(0.15 * 3 + 0.01 * 15)
  })

  it("counts cached tokens towards the prompt size", () => {
    // 150K fresh + 100K read from cache is a 250K prompt and is billed as one.
    const c = estimateRequestCost(
      "claude",
      "claude-sonnet-4-5",
      usage({ input: 150_000, cacheRead: 100_000 })
    )
    expect(c).toBeCloseTo(0.15 * 6 + 0.1 * 0.6)
  })

  it("keeps session-level estimates on base rates", () => {
    // A session total is many prompts added up; it carries no evidence that any
    // single one was oversized, so it must not be surcharged.
    expect(estimateCost("claude", "claude-sonnet-4-5", usage({ input: 1e6 }))).toBeCloseTo(3)
  })
})

describe("matching the built-in table", () => {
  it("does not price a newer generation as an older one", () => {
    // `gpt-5` used to match `gpt-5.6-sol` by substring and price it at a third
    // of its real rate, shown as a normal figure rather than as unpriced.
    expect(priceForModel("gpt-5.6-sol")).toBeNull()
    expect(priceForModel("gpt-5-3-something")).toBeNull()
    // Same family, a new word after it, still matches.
    expect(priceForModel("gpt-5-codex")?.input).toBe(1.25)
    expect(priceForModel("deepseek-flash")?.input).toBe(0.14)
  })

  it("reads through route prefixes and release dates", () => {
    expect(idCandidates("Z-AI/GLM-5.3-Flash")).toEqual(["z-ai/glm-5.3-flash", "glm-5.3-flash"])
    expect(idCandidates("claude-haiku-4-5-20251001")).toEqual([
      "claude-haiku-4-5-20251001",
      "claude-haiku-4-5",
    ])
    expect(priceForModel("anthropic/claude-haiku-4-5-20251001")?.output).toBe(5)
  })
})

describe("synced prices", () => {
  afterEach(() => setSyncedPrices(null))
  const opus = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }

  it("are consulted first, by exact id, and say where they came from", () => {
    setSyncedPrices({ "claude-opus-5-5": opus, "claude-opus-4-8": { ...opus, input: 9 } })
    expect(lookupPrice("claude-opus-5-5")).toEqual({ price: opus, source: "synced" })
    // A synced id overrides the table's own entry.
    expect(priceForModel("claude-opus-4-8")?.input).toBe(9)
    // An id the sync doesn't know still falls back to the table.
    expect(lookupPrice("claude-haiku-4-5")?.source).toBe("builtin")
  })

  it("match a dated or routed id", () => {
    setSyncedPrices({ "glm-5.3-flash": opus })
    expect(priceForModel("z-ai/glm-5.3-flash")).toEqual(opus)
  })

  it("are forgotten on null", () => {
    setSyncedPrices({ "claude-opus-5-5": opus })
    setSyncedPrices(null)
    expect(priceForModel("claude-opus-5-5")).toBeNull()
  })

  it("size a Codex prompt by its input alone, which already holds the cached part", () => {
    setSyncedPrices({
      "gpt-x": {
        input: 4,
        output: 20,
        cacheRead: 0.4,
        cacheWrite: 0,
        longContext: { threshold: 272_000, inputMultiplier: 2, outputMultiplier: 1.5 },
      },
    })
    // 200K input of which 150K cached: a 200K prompt, under the threshold.
    const c = estimateRequestCost("codex", "gpt-x", usage({ input: 200_000, cacheRead: 150_000 }))
    expect(c).toBeCloseTo((50_000 * 4 + 150_000 * 0.4) / 1e6)
  })
})
