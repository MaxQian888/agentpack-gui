import {
  ALL_TIME,
  bucketKey,
  bucketKeysIn,
  bucketLabel,
  customRange,
  inRange,
  percentChange,
  previousRange,
  resolveRange,
  startOfMonth,
  startOfWeek,
} from "./range"

// A Wednesday, so week bucketing has something to snap backwards to.
const NOW = new Date(2026, 6, 15, 14, 30).getTime()
const day = (d: number, h = 0) => new Date(2026, 6, d, h).getTime()

describe("resolveRange", () => {
  it("ends today's range at tomorrow so activity minutes ago is included", () => {
    const r = resolveRange("today", NOW)
    expect(r.from).toBe(day(15))
    expect(r.to).toBe(day(16))
    expect(inRange(NOW, r)).toBe(true)
  })

  it("counts 7d as seven calendar days including today", () => {
    const r = resolveRange("7d", NOW)
    expect(r.from).toBe(day(9))
    expect(r.to).toBe(day(16))
  })

  it("counts 30d as thirty calendar days including today", () => {
    const r = resolveRange("30d", NOW)
    expect(r.from).toBe(new Date(2026, 5, 16).getTime())
  })

  it("counts 90d as ninety calendar days including today", () => {
    const r = resolveRange("90d", NOW)
    // 89 days back from 2026-07-15, and ending after today rather than on it.
    expect(r.from).toBe(new Date(2026, 3, 17).getTime())
    expect(r.to).toBe(day(16))
  })

  it("starts the month range at the first of the month", () => {
    expect(resolveRange("month", NOW).from).toBe(day(1))
  })

  it("leaves all-time unbounded", () => {
    expect(resolveRange("all", NOW)).toEqual(ALL_TIME)
  })
})

describe("customRange", () => {
  it("includes the whole of the last day picked", () => {
    const r = customRange(day(10, 9), day(12, 9))
    expect(r.from).toBe(day(10))
    expect(r.to).toBe(day(13))
    expect(inRange(day(12, 23), r)).toBe(true)
    expect(inRange(day(13), r)).toBe(false)
  })

  it("orders a reversed pair instead of matching nothing", () => {
    // A date picker hands back `to` before `from` mid-drag; taken literally
    // that range is empty, which reads as "you did nothing in this period".
    expect(customRange(day(12), day(10))).toEqual(customRange(day(10), day(12)))
  })

  it("supports a single-day selection", () => {
    const r = customRange(day(10), day(10))
    expect(inRange(day(10, 23), r)).toBe(true)
    expect(inRange(day(11), r)).toBe(false)
  })
})

describe("inRange", () => {
  it("treats the interval as half-open", () => {
    const r = customRange(day(10), day(10))
    expect(inRange(day(10), r)).toBe(true)
    expect(inRange(day(11), r)).toBe(false)
    expect(inRange(day(9, 23), r)).toBe(false)
  })

  it("accepts anything when unbounded", () => {
    expect(inRange(0, ALL_TIME)).toBe(true)
  })
})

describe("previousRange", () => {
  it("returns the equally long window immediately before", () => {
    const r = resolveRange("7d", NOW)
    const prev = previousRange(r)!
    expect(prev.to).toBe(r.from)
    expect(r.to! - r.from!).toBe(prev.to! - prev.from!)
  })

  it("has nothing to compare against for all-time", () => {
    expect(previousRange(ALL_TIME)).toBeNull()
  })
})

describe("percentChange", () => {
  it("computes relative change", () => {
    expect(percentChange(110, 100)).toBeCloseTo(10)
    expect(percentChange(50, 100)).toBeCloseTo(-50)
  })

  it("declines to divide by a zero baseline", () => {
    // Growth from nothing isn't "+∞%" — it's new activity, and the UI says so.
    expect(percentChange(100, 0)).toBeNull()
  })
})

describe("bucketing", () => {
  it("snaps weeks back to Monday", () => {
    // 2026-07-15 is a Wednesday.
    expect(startOfWeek(NOW)).toBe(day(13))
    // …and a Sunday belongs to the week that started six days earlier.
    expect(startOfWeek(day(19))).toBe(day(13))
  })

  it("snaps months to the first", () => {
    expect(startOfMonth(NOW)).toBe(day(1))
  })

  it("keys buckets by their start day", () => {
    expect(bucketKey(NOW, "day")).toBe("2026-07-15")
    expect(bucketKey(NOW, "week")).toBe("2026-07-13")
    expect(bucketKey(NOW, "month")).toBe("2026-07-01")
  })

  it("labels a month bucket by month, not by its first day", () => {
    expect(bucketLabel("2026-07-01", "day")).toBe("07-01")
    expect(bucketLabel("2026-07-01", "month")).toBe("2026-07")
  })
})

describe("bucketKeysIn", () => {
  it("enumerates every day so quiet days stay visible as gaps", () => {
    const keys = bucketKeysIn(customRange(day(10), day(12)), "day")
    expect(keys).toEqual(["2026-07-10", "2026-07-11", "2026-07-12"])
  })

  it("walks weeks from the Monday of the first week", () => {
    const keys = bucketKeysIn(customRange(day(15), day(27)), "week")
    expect(keys).toEqual(["2026-07-13", "2026-07-20", "2026-07-27"])
  })

  it("walks calendar months, not 30-day chunks", () => {
    const keys = bucketKeysIn(customRange(new Date(2026, 0, 15).getTime(), day(2)), "month")
    expect(keys).toHaveLength(7)
    expect(keys[0]).toBe("2026-01-01")
    expect(keys[6]).toBe("2026-07-01")
  })

  it("returns nothing for an unbounded range", () => {
    expect(bucketKeysIn(ALL_TIME, "day")).toEqual([])
  })
})
