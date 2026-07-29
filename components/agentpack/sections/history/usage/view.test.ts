import { buildView } from "./view"
import { ALL_TIME, customRange, resolveRange } from "@/lib/history/range"
import { ev, series, session, usage } from "./fixtures"

const day = (d: number, h = 12) => new Date(2026, 6, d, h).getTime()
const NOW = day(20, 10)

describe("buildView", () => {
  it("narrows every summary-derived figure to the range", () => {
    const view = buildView({
      sessions: [
        session({ id: "in", updatedAt: day(10), usage: usage({ total: 100 }) }),
        session({ id: "out", updatedAt: day(1), usage: usage({ total: 999 }) }),
      ],
      series: null,
      range: customRange(day(9), day(11)),
      granularity: "day",
      now: NOW,
    })
    expect(view.sessions.map((s) => s.id)).toEqual(["in"])
    expect(view.stats.totals.usage.total).toBe(100)
    expect(view.buckets.map((b) => b.key)).toEqual(["2026-07-09", "2026-07-10", "2026-07-11"])
  })

  it("computes the previous period for comparison, and none for all-time", () => {
    const ranged = buildView({
      sessions: [
        session({ id: "now", updatedAt: day(19), usage: usage({ total: 100 }) }),
        // Seven days earlier: inside the immediately preceding window.
        session({ id: "before", updatedAt: day(12), usage: usage({ total: 50 }) }),
      ],
      series: null,
      range: resolveRange("7d", NOW),
      granularity: "day",
      now: NOW,
    })
    expect(ranged.stats.totals.usage.total).toBe(100)
    expect(ranged.previous?.totals.usage.total).toBe(50)

    const all = buildView({
      sessions: [],
      series: null,
      range: ALL_TIME,
      granularity: "day",
      now: NOW,
    })
    expect(all.previous).toBeNull()
  })

  it("reports the series as not ready until it has been fetched", () => {
    const pending = buildView({
      sessions: [session({})],
      series: null,
      range: ALL_TIME,
      granularity: "day",
      now: NOW,
    })
    expect(pending.seriesReady).toBe(false)
    expect(pending.blocks).toEqual([])
    expect(pending.tools).toEqual([])

    // An empty array is a *loaded* series with nothing in it — a different state
    // from "not fetched", and the panels say different things about each.
    const loaded = buildView({
      sessions: [session({})],
      series: [],
      range: ALL_TIME,
      granularity: "day",
      now: NOW,
    })
    expect(loaded.seriesReady).toBe(true)
  })

  it("cuts blocks from the series and marks the one containing `now`", () => {
    const view = buildView({
      sessions: [session({ updatedAt: day(20) })],
      series: [
        series({
          events: [
            ev(day(10, 9), 0, 1000, 100),
            // Same day but eleven hours later: a separate window.
            ev(day(10, 20), 0, 1000, 100),
            // Inside the five hours before `now` (10:00 on the 20th).
            ev(day(20, 9), 0, 500, 50),
          ],
        }),
      ],
      range: ALL_TIME,
      granularity: "day",
      now: NOW,
    })
    expect(view.blocks).toHaveLength(3)
    expect(view.activeBlock?.start).toBe(new Date(2026, 6, 20, 9).getTime())
    expect(view.blocks.filter((b) => b.active)).toHaveLength(1)
  })

  it("aggregates tools once, sharing the result with the origin split", () => {
    const view = buildView({
      sessions: [session({})],
      series: [
        series({
          events: [ev(day(10), 0, 10, 1)],
          tools: [
            { name: "Read", calls: 4, errors: 1 },
            { name: "mcp__x__y", calls: 3, errors: 0 },
          ],
        }),
      ],
      range: ALL_TIME,
      granularity: "day",
      now: NOW,
    })
    expect(view.tools.map((t) => t.name)).toEqual(["Read", "mcp__x__y"])
    expect(view.toolSplit).toEqual({ builtinCalls: 4, mcpCalls: 3 })
  })

  it("keeps the sub-agent share out of the session count but in the tokens", () => {
    const view = buildView({
      sessions: [
        session({ id: "root", updatedAt: day(10), usage: usage({ total: 100 }) }),
        session({
          id: "kid",
          parentId: "root",
          updatedAt: day(10),
          usage: usage({ total: 400 }),
        }),
      ],
      series: null,
      range: ALL_TIME,
      granularity: "day",
      now: NOW,
    })
    expect(view.stats.totals.sessions).toBe(1)
    expect(view.stats.totals.usage.total).toBe(500)
    expect(view.stats.subagents.tokens).toBe(400)
    expect(view.buckets[0].sessions).toBe(1)
    expect(view.buckets[0].tokens).toBe(500)
  })
})
