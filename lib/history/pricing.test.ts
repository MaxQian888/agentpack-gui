import { estimateCost, priceForModel } from "./pricing"
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
