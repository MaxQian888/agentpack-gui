import {
  addUsage,
  dayKey,
  emptyUsage,
  formatCost,
  formatCostFigure,
  formatDuration,
  formatNumber,
  formatTokens,
  parseUsd,
} from "./format"
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
  it("formats in cents, keeping 4dp only where cents would round to nothing", () => {
    expect(formatCost(0)).toBe("$0.00")
    expect(formatCost(0.0042)).toBe("$0.0042")
    expect(formatCost(0.0123)).toBe("$0.01")
    expect(formatCost(0.9143)).toBe("$0.91")
    expect(formatCost(3.4)).toBe("$3.40")
  })
  it("groups thousands like the counts beside it", () => {
    expect(formatCost(1105.51)).toBe("$1,105.51")
    expect(formatCost(1234567.891)).toBe("$1,234,567.89")
  })
})

describe("formatCostFigure", () => {
  const figure = (over: Partial<Parameters<typeof formatCostFigure>[0]>) =>
    formatCostFigure({ value: 3.4, estimated: false, unpriced: 0, transcripts: 2, ...over })

  it("writes a recorded figure plainly", () => {
    expect(figure({})).toBe("$3.40")
  })
  it("marks an estimate with ~", () => {
    expect(figure({ estimated: true })).toBe("~$3.40")
  })
  it("marks a figure that left unpriced transcripts out as a lower bound", () => {
    expect(figure({ estimated: true, unpriced: 1 })).toBe("≥$3.40")
  })
  it("says — rather than $0.00 when nothing in it could be priced", () => {
    expect(figure({ value: 0, unpriced: 2 })).toBe("—")
  })
  it("keeps a real zero over an empty set", () => {
    expect(figure({ value: 0, transcripts: 0 })).toBe("$0.00")
  })
})

describe("parseUsd", () => {
  it("reads plain numbers", () => {
    expect(parseUsd("200")).toBe(200)
    expect(parseUsd(" 19.5 ")).toBe(19.5)
  })
  it("accepts a dollar sign and thousands separators", () => {
    expect(parseUsd("$200")).toBe(200)
    expect(parseUsd("1,000")).toBe(1000)
    expect(parseUsd("$1,250.50")).toBe(1250.5)
  })
  it("treats an empty field as not set", () => {
    expect(parseUsd("")).toBeNull()
    expect(parseUsd("   ")).toBeNull()
  })
  it("refuses what isn't a non-negative number instead of saving nothing", () => {
    expect(parseUsd("abc")).toBeUndefined()
    expect(parseUsd("-5")).toBeUndefined()
    expect(parseUsd("$")).toBeUndefined()
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

describe("formatDuration", () => {
  it("treats missing, zero and non-finite durations as absent, not instant", () => {
    expect(formatDuration(null)).toBe("—")
    expect(formatDuration(undefined)).toBe("—")
    expect(formatDuration(0)).toBe("—")
    expect(formatDuration(Infinity)).toBe("—")
  })
  it("picks the coarsest unit that still carries information", () => {
    expect(formatDuration(45_000)).toBe("45s")
    expect(formatDuration(12 * 60_000)).toBe("12m")
    expect(formatDuration(3 * 3_600_000 + 20 * 60_000)).toBe("3h 20m")
    // A whole number of hours drops the empty minutes part.
    expect(formatDuration(2 * 3_600_000)).toBe("2h")
  })
})
