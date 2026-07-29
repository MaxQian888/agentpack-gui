import { bucketsCsv, buildExport, exportFilename, toCsv, type ExportBucket } from "./export"
import { customRange, resolveRange } from "./range"
import { computeUsageStats } from "./stats"
import { identifyBlocks } from "./blocks"

const day = (d: number, h = 12) => new Date(2026, 6, d, h).getTime()

const bucket = (over: Partial<ExportBucket> = {}): ExportBucket => ({
  key: "2026-07-10",
  tokens: 100,
  input: 60,
  output: 40,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 1.5,
  sessions: 2,
  unpricedSessions: 0,
  ...over,
})

describe("toCsv", () => {
  it("quotes fields containing commas, quotes or newlines", () => {
    expect(toCsv([["a,b", 'say "hi"', "line\nbreak"]])).toBe('"a,b","say ""hi""","line\nbreak"')
  })

  it("neutralises fields a spreadsheet would run as a formula", () => {
    // A branch called `-fix` or a project called `=cmd` must not execute when
    // the export is opened in Excel or Numbers.
    expect(toCsv([["=cmd()"]])).toBe("'=cmd()")
    expect(toCsv([["-fix"]])).toBe("'-fix")
    expect(toCsv([["+1"]])).toBe("'+1")
    expect(toCsv([["@ref"]])).toBe("'@ref")
  })

  it("leaves ordinary values untouched", () => {
    expect(toCsv([["main", 42]])).toBe("main,42")
  })
})

describe("bucketsCsv", () => {
  it("writes a header and one row per bucket", () => {
    const lines = bucketsCsv([bucket(), bucket({ key: "2026-07-11", cost: 0 })]).split("\n")
    expect(lines[0]).toBe(
      "period,sessions,input,output,cache_read,cache_write,total_tokens,cost_usd,unpriced_sessions"
    )
    expect(lines).toHaveLength(3)
    // Full precision, not the display rounding — this feeds a spreadsheet.
    expect(lines[1]).toContain("1.500000")
  })

  it("carries the unpriced count so a summed cost column isn't read as complete", () => {
    const lines = bucketsCsv([bucket({ cost: 1.5, unpricedSessions: 3 })]).split("\n")
    expect(lines[1].endsWith(",3")).toBe(true)
  })
})

describe("buildExport", () => {
  it("stamps the range and serialises instants as ISO", () => {
    const range = customRange(day(10), day(12))
    const blocks = identifyBlocks(
      [
        {
          ts: day(10),
          model: "claude-opus-4-8",
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 2 },
          cost: 0.5,
          unpriced: false,
        },
      ],
      day(30)
    )
    const out = buildExport({
      generatedAt: day(12, 9),
      range,
      granularity: "day",
      stats: computeUsageStats([]),
      buckets: [bucket()],
      blocks,
      tools: [{ name: "Read", calls: 3, errors: 1 }],
    })
    expect(out.generatedAt).toBe(new Date(day(12, 9)).toISOString())
    // `customRange` snaps to local midnight, so the exported instant is the
    // start of the 10th in the user's zone, not the noon the test passed in.
    expect(out.range.from).toBe(new Date(2026, 6, 10).toISOString())
    expect(out.granularity).toBe("day")
    expect(out.blocks).toHaveLength(1)
    expect(out.blocks[0].tokens).toBe(2)
    expect(out.blocks[0].active).toBe(false)
    expect(out.tools[0].name).toBe("Read")
  })

  it("leaves an unbounded range's ends null rather than inventing dates", () => {
    const out = buildExport({
      generatedAt: day(12),
      range: resolveRange("all"),
      granularity: "month",
      stats: computeUsageStats([]),
      buckets: [],
      blocks: [],
      tools: [],
    })
    expect(out.range).toEqual({ preset: "all", from: null, to: null })
  })
})

describe("exportFilename", () => {
  it("names the file after the preset and the day it was produced", () => {
    expect(exportFilename(resolveRange("7d", day(12)), "csv", day(12))).toBe(
      `agentpack-usage-7d-${new Date(day(12)).toISOString().slice(0, 10)}.csv`
    )
  })
})
