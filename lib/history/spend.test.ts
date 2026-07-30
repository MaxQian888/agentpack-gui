import { computeSpend, dailyCostSeries } from "./spend"
import { resolveRange, ALL_TIME } from "./range"
import type { SessionSummary, TokenUsage } from "./types"

const usage = (over: Partial<TokenUsage> = {}): TokenUsage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  total: 0,
  ...over,
})

const session = (over: Partial<SessionSummary> = {}): SessionSummary => ({
  id: "s",
  source: "claude",
  title: "A session",
  cwd: "/proj",
  projectName: "proj",
  model: "claude-opus-4-8",
  models: ["claude-opus-4-8"],
  messageCount: 4,
  usage: usage({ input: 1_000_000, total: 1_000_000 }),
  cost: null,
  startedAt: 0,
  updatedAt: 0,
  path: "p",
  gitBranch: null,
  parentId: null,
  agentName: null,
  durationMs: null,
  ...over,
})

// 2026-07-20, comfortably inside a month with a full prior window available.
const NOW = new Date(2026, 6, 20, 12).getTime()
const day = (d: number, month = 6) => new Date(2026, month, d, 9).getTime()

describe("computeSpend", () => {
  it("reports no activity for an empty history", () => {
    const spend = computeSpend([], NOW)
    expect(spend.hasActivity).toBe(false)
    expect(spend.cost).toBe(0)
    expect(spend.sessions).toBe(0)
  })

  it("distinguishes a real zero from no history at all", () => {
    // A session inside the window whose model has no rate: spend is 0 but there
    // *is* activity, and the card must not show the new-user empty state.
    const spend = computeSpend(
      [
        session({
          updatedAt: day(10),
          model: "some-unlisted-model",
          models: ["some-unlisted-model"],
        }),
      ],
      NOW
    )
    expect(spend.hasActivity).toBe(true)
    expect(spend.cost).toBe(0)
    expect(spend.unpricedTranscripts).toBe(1)
  })

  it("keys the window off updatedAt and excludes last month", () => {
    const spend = computeSpend(
      [
        session({ id: "in", updatedAt: day(10) }),
        session({ id: "out", updatedAt: day(28, 5) }), // June
      ],
      NOW
    )
    expect(spend.sessions).toBe(1)
    expect(spend.range).toEqual(resolveRange("month", NOW))
  })

  it("counts sub-agent cost but not sub-agent sessions", () => {
    const spend = computeSpend(
      [
        session({ id: "parent", updatedAt: day(10) }),
        session({ id: "child", parentId: "parent", updatedAt: day(10) }),
      ],
      NOW
    )
    expect(spend.sessions).toBe(1)
    // Both transcripts are priced, so the cost is that of two.
    const single = computeSpend([session({ id: "parent", updatedAt: day(10) })], NOW)
    expect(spend.cost).toBeCloseTo(single.cost * 2, 10)
  })

  it("splits estimated from source-recorded cost", () => {
    const spend = computeSpend(
      [
        session({ id: "est", updatedAt: day(10) }),
        session({ id: "real", source: "opencode", cost: 4.5, updatedAt: day(11) }),
      ],
      NOW
    )
    expect(spend.actualCost).toBeCloseTo(4.5, 10)
    expect(spend.estimatedCost).toBeGreaterThan(0)
    expect(spend.cost).toBeCloseTo(spend.actualCost + spend.estimatedCost, 10)
  })

  it("sorts sources by cost, descending", () => {
    const spend = computeSpend(
      [
        session({ id: "a", source: "claude", updatedAt: day(10) }),
        session({ id: "b", source: "opencode", cost: 99, updatedAt: day(11) }),
      ],
      NOW
    )
    expect(spend.bySource.map((s) => s.source)).toEqual(["opencode", "claude"])
  })

  it("compares against the equally long window before this one", () => {
    // Month-to-date on the 20th spans 20 days, so the baseline is the 20 days
    // before the 1st — i.e. mid-June.
    const spend = computeSpend(
      [session({ id: "now", updatedAt: day(10) }), session({ id: "then", updatedAt: day(20, 5) })],
      NOW
    )
    expect(spend.deltaPct).toBeCloseTo(0, 6)
  })

  it("has no delta when the baseline window is empty", () => {
    const spend = computeSpend([session({ updatedAt: day(10) })], NOW)
    expect(spend.deltaPct).toBeNull()
  })
})

describe("dailyCostSeries", () => {
  it("zero-fills idle days and runs oldest first", () => {
    const range = resolveRange("7d", NOW)
    const series = dailyCostSeries([session({ updatedAt: day(18) })], range)
    expect(series).toHaveLength(7)
    expect(series[0].day).toBe("2026-07-14")
    expect(series[series.length - 1].day).toBe("2026-07-20")
    expect(series.filter((d) => d.cost > 0).map((d) => d.day)).toEqual(["2026-07-18"])
  })

  it("returns nothing for an unbounded range", () => {
    expect(dailyCostSeries([session({ updatedAt: day(18) })], ALL_TIME)).toEqual([])
  })
})
