import {
  bucketSessions,
  byBranch,
  costBucketLabel,
  costHistogram,
  percentile,
  sessionsInRange,
  topSessionsByCost,
} from "./insights"
import { ALL_TIME, customRange } from "./range"
import type { SessionSummary, TokenUsage } from "./types"

const usage = (total: number): TokenUsage => ({
  input: total,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  total,
})

const day = (d: number) => new Date(2026, 6, d, 12).getTime()

const session = (over: Partial<SessionSummary> = {}): SessionSummary => ({
  id: "s",
  source: "opencode",
  title: "t",
  cwd: "/proj",
  projectName: "proj",
  model: "m",
  models: ["m"],
  messageCount: 1,
  usage: usage(0),
  cost: 0,
  startedAt: day(10),
  updatedAt: day(10),
  path: "p",
  gitBranch: null,
  parentId: null,
  agentName: null,
  durationMs: null,
  ...over,
})

describe("sessionsInRange", () => {
  it("filters on last activity", () => {
    const kept = sessionsInRange(
      [session({ id: "a", updatedAt: day(10) }), session({ id: "b", updatedAt: day(30) })],
      customRange(day(9), day(11))
    )
    expect(kept.map((s) => s.id)).toEqual(["a"])
  })
})

describe("bucketSessions", () => {
  it("emits a zero row for a bucket the range covers but nothing landed in", () => {
    const buckets = bucketSessions(
      [session({ updatedAt: day(10), usage: usage(5), cost: 1 })],
      customRange(day(10), day(12)),
      "day"
    )
    expect(buckets.map((b) => b.key)).toEqual(["2026-07-10", "2026-07-11", "2026-07-12"])
    expect(buckets[0]).toMatchObject({ sessions: 1, tokens: 5, cost: 1 })
    expect(buckets[1]).toMatchObject({ sessions: 0, tokens: 0, cost: 0 })
  })

  it("counts sub-agent tokens without counting them as sessions", () => {
    const buckets = bucketSessions(
      [
        session({ id: "root", updatedAt: day(10), usage: usage(10), cost: 1 }),
        session({ id: "kid", parentId: "root", updatedAt: day(10), usage: usage(90), cost: 9 }),
      ],
      ALL_TIME,
      "day"
    )
    expect(buckets[0].sessions).toBe(1)
    expect(buckets[0].tokens).toBe(100)
    expect(buckets[0].cost).toBe(10)
  })

  it("promotes an orphan, matching computeUsageStats", () => {
    const buckets = bucketSessions(
      [session({ id: "kid", parentId: "gone", updatedAt: day(10), usage: usage(1) })],
      ALL_TIME,
      "day"
    )
    expect(buckets[0].sessions).toBe(1)
  })

  it("rolls days up into weeks", () => {
    const buckets = bucketSessions(
      [
        session({ updatedAt: day(13), usage: usage(1) }), // Monday
        session({ updatedAt: day(17), usage: usage(2) }), // Friday, same week
        session({ updatedAt: day(20), usage: usage(4) }), // next Monday
      ],
      ALL_TIME,
      "week"
    )
    expect(buckets.map((b) => [b.key, b.tokens])).toEqual([
      ["2026-07-13", 3],
      ["2026-07-20", 4],
    ])
  })
})

describe("costHistogram", () => {
  it("spreads sessions across brackets that span orders of magnitude", () => {
    const h = costHistogram([
      session({ cost: 0.004 }),
      session({ cost: 0.02 }),
      session({ cost: 0.3 }),
      session({ cost: 42 }),
    ])
    expect(h.buckets.map((b) => b.sessions)).toEqual([1, 1, 0, 1, 0, 0, 1])
    expect(h.buckets[h.buckets.length - 1].to).toBe(Infinity)
    expect(h.unpriced).toBe(0)
  })

  it("puts a free session in the first bracket rather than dropping it", () => {
    expect(costHistogram([session({ cost: 0 })]).buckets[0].sessions).toBe(1)
  })

  it("reports an unpriced session apart instead of bucketing it as near-free", () => {
    // A model with no rate at all — `cost: null` and a model outside the table.
    const h = costHistogram([session({ cost: null, model: "mystery-model-9" })])
    expect(h.unpriced).toBe(1)
    // The crux: it must NOT land in the `<$0.01` bracket, which would report an
    // unknown cost as a measured near-zero one.
    expect(h.buckets.every((b) => b.sessions === 0)).toBe(true)
  })
})

describe("costBucketLabel", () => {
  const { buckets } = costHistogram([])

  it("labels brackets as an upper-bound ladder", () => {
    expect(costBucketLabel(buckets[0])).toBe("<$0.01")
    expect(costBucketLabel(buckets[1])).toBe("<$0.05")
    expect(costBucketLabel(buckets[3])).toBe("<$1")
  })

  it("labels the open-ended top bracket by its floor", () => {
    expect(costBucketLabel(buckets[buckets.length - 1])).toBe("≥$20")
  })

  it("keeps edges short where formatCost would pad them to four decimals", () => {
    // `formatCost(0.05)` is "$0.0500" — fine in a table cell, unreadable on an axis.
    expect(costBucketLabel(buckets[1])).not.toContain("0500")
  })
})

describe("percentile", () => {
  it("returns a value that actually occurred", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5)
  })

  it("handles an empty set without blowing up", () => {
    expect(percentile([], 0.95)).toBe(0)
  })
})

describe("topSessionsByCost", () => {
  it("ranks by cost and caps the list", () => {
    const sessions = [1, 5, 3].map((c, i) => session({ id: `s${i}`, cost: c }))
    const top = topSessionsByCost(sessions, 2)
    expect(top.map((t) => t.cost)).toEqual([5, 3])
  })

  it("flags outliers against the set's own P95, not a fixed dollar figure", () => {
    // Nineteen routine sessions and one runaway: $50 is only "expensive"
    // relative to how this user usually works.
    const sessions = [
      ...Array.from({ length: 19 }, (_, i) => session({ id: `c${i}`, cost: 0.1 })),
      session({ id: "big", cost: 50 }),
    ]
    const top = topSessionsByCost(sessions, 3)
    expect(top[0].session.id).toBe("big")
    expect(top[0].outlier).toBe(true)
    expect(top[1].outlier).toBe(false)
  })

  it("flags nothing when every session costs the same", () => {
    // A uniform set has no runaway, and a fixed threshold would invent one.
    const sessions = Array.from({ length: 20 }, (_, i) => session({ id: `c${i}`, cost: 2 }))
    expect(topSessionsByCost(sessions, 3).every((t) => !t.outlier)).toBe(true)
  })

  it("marks an unpriced session rather than ranking it as a $0 one", () => {
    const top = topSessionsByCost([
      session({ id: "priced", cost: 3 }),
      session({ id: "unpriced", cost: null, model: "mystery-model-9" }),
    ])
    const unpriced = top.find((t) => t.session.id === "unpriced")
    expect(unpriced?.unpriced).toBe(true)
    expect(top.find((t) => t.session.id === "priced")?.unpriced).toBe(false)
  })

  it("draws the outlier threshold from priced sessions only", () => {
    // Nineteen unpriced sessions sit at a placeholder 0. Letting them into the
    // sample would drag the P95 to 0 and make every priced session an outlier.
    const sessions = [
      ...Array.from({ length: 19 }, (_, i) =>
        session({ id: `u${i}`, cost: null, model: "mystery-model-9" })
      ),
      session({ id: "a", cost: 1 }),
      session({ id: "b", cost: 1 }),
    ]
    const top = topSessionsByCost(sessions, 5)
    expect(top.filter((t) => t.outlier)).toHaveLength(0)
  })
})

describe("byBranch", () => {
  it("groups usage by branch, busiest first", () => {
    const stats = byBranch([
      session({ gitBranch: "main", usage: usage(10), cost: 1 }),
      session({ gitBranch: "feat/x", usage: usage(50), cost: 2 }),
      session({ gitBranch: "main", usage: usage(5), cost: 0.5 }),
    ])
    expect(stats[0]).toEqual({
      branch: "feat/x",
      sessions: 1,
      tokens: 50,
      cost: 2,
      unpricedSessions: 0,
    })
    expect(stats[1]).toEqual({
      branch: "main",
      sessions: 2,
      tokens: 15,
      cost: 1.5,
      unpricedSessions: 0,
    })
  })

  it("counts an unpriced session apart rather than adding $0 to the branch", () => {
    const stats = byBranch([
      session({ gitBranch: "main", usage: usage(10), cost: 2 }),
      session({ gitBranch: "main", usage: usage(5), cost: null, model: "mystery-model-9" }),
    ])
    expect(stats[0].sessions).toBe(2)
    expect(stats[0].cost).toBe(2)
    expect(stats[0].unpricedSessions).toBe(1)
  })

  it("leaves branchless sessions out instead of inventing a bucket for them", () => {
    // Only Claude records a branch; a "—" row would read as a real branch.
    expect(byBranch([session({ gitBranch: null }), session({ gitBranch: "  " })])).toEqual([])
  })
})
