import {
  BLOCK_MS,
  burnRate,
  floorToHour,
  identifyBlocks,
  p90BlockTokens,
  projectBlock,
  type TimelineEntry,
} from "./blocks"
import type { TokenUsage } from "./types"

const usage = (total: number): TokenUsage => ({
  input: total,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  total,
})

const at = (h: number, m = 0) => new Date(2026, 2, 10, h, m).getTime()
const entry = (ts: number, total = 100, model = "claude-opus-4-8", cost = 1): TimelineEntry => ({
  ts,
  model,
  usage: usage(total),
  cost,
  unpriced: false,
})

const HOUR = 3_600_000

describe("floorToHour", () => {
  it("drops minutes, seconds and milliseconds", () => {
    expect(floorToHour(at(9, 47) + 12_345)).toBe(at(9))
  })
})

describe("identifyBlocks", () => {
  it("floors the block start to the hour, not to the first message", () => {
    const blocks = identifyBlocks([entry(at(9, 47))], at(10))
    expect(blocks[0].start).toBe(at(9))
    expect(blocks[0].end).toBe(at(9) + BLOCK_MS)
    expect(blocks[0].firstActivity).toBe(at(9, 47))
  })

  it("keeps steady activity inside one five-hour window", () => {
    const blocks = identifyBlocks([entry(at(9, 30)), entry(at(11)), entry(at(13, 45))], at(23))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].entries).toBe(3)
    expect(blocks[0].usage.total).toBe(300)
    expect(blocks[0].cost).toBe(3)
  })

  it("opens a new block once the window itself lapses", () => {
    // 09:00 start → lapses 14:00. 14:30 is still under the 5h idle gap from
    // 13:00, so only the window rule can split these.
    const blocks = identifyBlocks([entry(at(9)), entry(at(13)), entry(at(14, 30))], at(23))
    expect(blocks).toHaveLength(2)
    expect(blocks[0].start).toBe(at(9))
    expect(blocks[1].start).toBe(at(14))
  })

  it("opens a new block after five hours of silence", () => {
    const blocks = identifyBlocks([entry(at(9)), entry(at(9) + 5 * HOUR + 60_000)], at(23))
    expect(blocks).toHaveLength(2)
  })

  it("sorts an out-of-order timeline before cutting it", () => {
    const blocks = identifyBlocks([entry(at(13)), entry(at(9))], at(23))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].firstActivity).toBe(at(9))
    expect(blocks[0].lastActivity).toBe(at(13))
  })

  it("collects the distinct models used in a window", () => {
    const blocks = identifyBlocks(
      [
        entry(at(9), 1, "claude-opus-4-8"),
        entry(at(10), 1, "claude-haiku-4-5"),
        entry(at(11), 1, "claude-opus-4-8"),
      ],
      at(23)
    )
    expect(blocks[0].models).toEqual(["claude-opus-4-8", "claude-haiku-4-5"])
  })

  it("marks only the window containing `now` as active", () => {
    const blocks = identifyBlocks([entry(at(9)), entry(at(15))], at(16))
    expect(blocks[0].active).toBe(false)
    expect(blocks[1].active).toBe(true)
  })
})

describe("burnRate", () => {
  it("measures from first activity, not from the floored start", () => {
    // Floored start 09:00, first activity 09:30, now 10:30 → 60 minutes, not 90.
    const blocks = identifyBlocks([entry(at(9, 30), 6000)], at(10, 30))
    const rate = burnRate(blocks[0], at(10, 30))
    expect(rate?.tokensPerMinute).toBeCloseTo(100)
    expect(rate?.elapsedMs).toBe(HOUR)
  })

  it("uses last activity for a finished block", () => {
    const blocks = identifyBlocks([entry(at(9), 60), entry(at(10), 60)], at(23))
    expect(burnRate(blocks[0], at(23))?.tokensPerMinute).toBeCloseTo(2)
  })

  it("returns null rather than dividing by zero for an instantaneous block", () => {
    const blocks = identifyBlocks([entry(at(9))], at(23))
    expect(burnRate(blocks[0], at(23))).toBeNull()
  })

  it("does not run the clock past the end of a lapsed window", () => {
    const blocks = identifyBlocks([entry(at(9, 30), 100)], at(9, 40))
    const rate = burnRate(blocks[0], at(9, 40))
    expect(rate?.elapsedMs).toBe(10 * 60_000)
  })
})

describe("projectBlock", () => {
  it("extrapolates an active block to its close at the current rate", () => {
    // 09:00–14:00 window; 6000 tokens and $2 over the first hour → 100 tok/min
    // and $2/h, with four hours still to run.
    const blocks = identifyBlocks([entry(at(9), 3000, "m", 1), entry(at(10), 3000, "m", 1)], at(10))
    const p = projectBlock(blocks[0], at(10))
    expect(p?.remainingMs).toBe(4 * HOUR)
    expect(p?.totalTokens).toBeCloseTo(30000)
    expect(p?.totalCost).toBeCloseTo(10)
  })

  it("falls back to the current totals when the block has no elapsed time", () => {
    // One entry, and `now` is that very instant: there is no rate to project.
    const blocks = identifyBlocks([entry(at(9), 6000, "m", 2)], at(9))
    expect(projectBlock(blocks[0], at(9))).toEqual({
      totalTokens: 6000,
      totalCost: 2,
      remainingMs: 5 * HOUR,
    })
  })

  it("returns null for a finished block", () => {
    const blocks = identifyBlocks([entry(at(9)), entry(at(10))], at(23))
    expect(projectBlock(blocks[0], at(23))).toBeNull()
  })
})

describe("p90BlockTokens", () => {
  it("stays silent until there are enough completed blocks", () => {
    const timeline = [0, 6, 12, 18].map((h) => entry(at(0) + h * HOUR, 100))
    expect(p90BlockTokens(identifyBlocks(timeline, at(23)))).toBe(0)
  })

  it("returns a value that actually occurred", () => {
    // Ten blocks six hours apart, sizes 100…1000.
    const timeline = Array.from({ length: 10 }, (_, i) =>
      entry(new Date(2026, 2, 10).getTime() + i * 6 * HOUR, (i + 1) * 100)
    )
    const blocks = identifyBlocks(timeline, new Date(2026, 2, 20).getTime())
    expect(blocks).toHaveLength(10)
    expect(p90BlockTokens(blocks)).toBe(900)
  })

  it("ignores the in-flight block, which is only partly spent", () => {
    const start = new Date(2026, 2, 10).getTime()
    const timeline = Array.from({ length: 6 }, (_, i) => entry(start + i * 6 * HOUR, 1000))
    // `now` inside the last window → that block is active and excluded.
    const blocks = identifyBlocks(timeline, start + 5 * 6 * HOUR + HOUR)
    expect(blocks.filter((b) => b.active)).toHaveLength(1)
    expect(p90BlockTokens(blocks)).toBe(1000)
  })
})

describe("unpriced entries", () => {
  it("counts them so a block's cost can declare itself a lower bound", () => {
    const blocks = identifyBlocks(
      [
        { ...entry(at(9), 100, "claude-opus-4-8", 2) },
        { ...entry(at(10), 100, "some-unknown-model", 0), unpriced: true },
      ],
      at(20)
    )
    expect(blocks).toHaveLength(1)
    // The priced entry's $2 stands; the unpriced one adds nothing and is
    // counted instead, so the cost is never mistaken for the window's total.
    expect(blocks[0].cost).toBe(2)
    expect(blocks[0].entries).toBe(2)
    expect(blocks[0].unpricedEntries).toBe(1)
  })

  it("leaves the counter at zero when every entry priced", () => {
    const blocks = identifyBlocks([entry(at(9)), entry(at(10))], at(20))
    expect(blocks[0].unpricedEntries).toBe(0)
  })
})
