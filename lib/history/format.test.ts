import { addUsage, dayKey, emptyUsage, formatCost, formatNumber, formatTokens } from "./format"
import type { TokenUsage } from "./types"

const u = (over: Partial<TokenUsage>): TokenUsage => ({ ...emptyUsage(), ...over })

describe("emptyUsage / addUsage", () => {
  it("emptyUsage is all zeros", () => {
    expect(emptyUsage()).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      total: 0,
    })
  })

  it("addUsage folds field-by-field and mutates the accumulator", () => {
    const acc = emptyUsage()
    const ret = addUsage(
      acc,
      u({ input: 2, output: 3, cacheRead: 1, cacheWrite: 4, reasoning: 5, total: 10 })
    )
    expect(ret).toBe(acc)
    addUsage(acc, u({ input: 1, total: 1 }))
    expect(acc).toEqual({
      input: 3,
      output: 3,
      cacheRead: 1,
      cacheWrite: 4,
      reasoning: 5,
      total: 11,
    })
  })
})

describe("formatTokens", () => {
  it("handles zero / negative / non-finite", () => {
    expect(formatTokens(0)).toBe("0")
    expect(formatTokens(-5)).toBe("0")
    expect(formatTokens(NaN)).toBe("0")
  })
  it("scales K / M / B and trims trailing .0", () => {
    expect(formatTokens(940)).toBe("940")
    expect(formatTokens(12_300)).toBe("12.3K")
    expect(formatTokens(2_000)).toBe("2K")
    expect(formatTokens(4_500_000)).toBe("4.5M")
    expect(formatTokens(3_000_000_000)).toBe("3B")
  })
})

describe("formatNumber", () => {
  it("groups thousands", () => {
    expect(formatNumber(0)).toBe("0")
    expect(formatNumber(1234)).toBe("1,234")
    expect(formatNumber(1234567)).toBe("1,234,567")
  })
})

describe("formatCost", () => {
  it("renders — for null / non-finite", () => {
    expect(formatCost(null)).toBe("—")
    expect(formatCost(undefined)).toBe("—")
    expect(formatCost(Infinity)).toBe("—")
  })
  it("formats zero, sub-dollar (4dp) and dollar+ (2dp)", () => {
    expect(formatCost(0)).toBe("$0.00")
    expect(formatCost(0.0123)).toBe("$0.0123")
    expect(formatCost(3.4)).toBe("$3.40")
  })
})

describe("dayKey", () => {
  it("returns a local YYYY-MM-DD key", () => {
    const key = dayKey(new Date(2026, 5, 15, 10, 30).getTime())
    expect(key).toBe("2026-06-15")
  })
  it("zero-pads month and day", () => {
    const key = dayKey(new Date(2026, 0, 3, 1, 1).getTime())
    expect(key).toBe("2026-01-03")
  })
})
