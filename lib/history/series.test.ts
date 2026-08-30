import {
  aggregateTools,
  buildTimeline,
  cacheStats,
  isMcpTool,
  modelMix,
  splitToolOrigin,
  totalUsage,
  unpackUsage,
} from "./series"
import { ALL_TIME, customRange } from "./range"
import type { PackedEvent, SessionSeries } from "./types"

const day = (d: number, h = 12) => new Date(2026, 6, d, h).getTime()

/** `[ts, modelIndex, input, output, cacheRead, cacheWrite, reasoning]`. */
const ev = (
  ts: number,
  model: number,
  input: number,
  output: number,
  cacheRead = 0,
  cacheWrite = 0,
  reasoning = 0,
  reportedCostMicros?: number
): PackedEvent =>
  reportedCostMicros === undefined
    ? [ts, model, input, output, cacheRead, cacheWrite, reasoning]
    : [ts, model, input, output, cacheRead, cacheWrite, reasoning, reportedCostMicros]

const series = (over: Partial<SessionSeries> = {}): SessionSeries => ({
  id: "s",
  source: "claude",
  projectName: "proj",
  gitBranch: null,
  parentId: null,
  models: ["claude-opus-4-8"],
  events: [],
  tools: [],
  ...over,
})

describe("unpackUsage", () => {
  it("sums Claude's disjoint buckets into the total", () => {
    const u = unpackUsage("claude", ev(0, 0, 10, 20, 5, 3))
    expect(u.total).toBe(38)
  })

  it("does not re-add Codex's cached tokens, which live inside input", () => {
    // Codex reports `input` already including the cached part; summing all four
    // would bill the same tokens twice.
    const u = unpackUsage("codex", ev(0, 0, 100, 10, 80))
    expect(u.total).toBe(110)
    expect(u.cacheRead).toBe(80)
  })
})

describe("buildTimeline", () => {
  it("flattens sessions into one time-ordered stream", () => {
    const t = buildTimeline(
      [
        series({ id: "a", events: [ev(day(11), 0, 1, 1)] }),
        series({ id: "b", events: [ev(day(10), 0, 1, 1)] }),
      ],
      ALL_TIME
    )
    expect(t.map((e) => e.ts)).toEqual([day(10), day(11)])
  })

  it("resolves each event's model through the session's model table", () => {
    const t = buildTimeline(
      [series({ models: ["a-model", "b-model"], events: [ev(day(10), 1, 1, 1)] })],
      ALL_TIME
    )
    expect(t[0].model).toBe("b-model")
  })

  it("uses Pi's source-estimated event cost without treating it as unpriced", () => {
    const t = buildTimeline(
      [
        series({
          source: "pi",
          costBasis: "sourceEstimate",
          models: ["custom-model"],
          events: [ev(day(10), 0, 1, 1, 0, 0, 0, 1250)],
        }),
      ],
      ALL_TIME
    )
    expect(t[0].cost).toBeCloseTo(0.00125)
    expect(t[0].unpriced).toBe(false)
  })

  it("uses OpenCode's billed event cost in the timeline", () => {
    const t = buildTimeline(
      [
        series({
          source: "opencode",
          costBasis: "billed",
          models: ["custom-model"],
          events: [ev(day(10), 0, 1, 1, 0, 0, 0, 4200)],
        }),
      ],
      ALL_TIME
    )
    expect(t[0].cost).toBeCloseTo(0.0042)
    expect(t[0].unpriced).toBe(false)
  })

  it("leaves the model blank when the record named none", () => {
    const t = buildTimeline([series({ events: [ev(day(10), -1, 1, 1)] })], ALL_TIME)
    expect(t[0].model).toBe("")
  })

  it("drops events outside the range and those with no timestamp", () => {
    const t = buildTimeline(
      [series({ events: [ev(day(10), 0, 1, 1), ev(day(20), 0, 1, 1), ev(0, 0, 1, 1)] })],
      customRange(day(9), day(11))
    )
    expect(t).toHaveLength(1)
  })

  it("flags an unpriced model instead of reporting its spend as a real $0", () => {
    const t = buildTimeline(
      [series({ models: ["mystery-model-9"], events: [ev(day(10), 0, 1000, 500)] })],
      ALL_TIME
    )
    expect(t[0].unpriced).toBe(true)
    // 0 is the placeholder the type documents, not a measured cost — the
    // `unpriced` flag is what downstream blocks and burn rates must read.
    expect(t[0].cost).toBe(0)
  })

  it("marks a priced event as priced", () => {
    const t = buildTimeline(
      [series({ models: ["claude-sonnet-4-5"], events: [ev(day(10), 0, 1000, 0)] })],
      ALL_TIME
    )
    expect(t[0].unpriced).toBe(false)
    expect(t[0].cost).toBeGreaterThan(0)
  })

  it("prices each event, applying the long-context surcharge per request", () => {
    // Sonnet 4.5 past 200K input: $3/M doubles to $6/M for the whole request.
    const long = buildTimeline(
      [series({ models: ["claude-sonnet-4-5"], events: [ev(day(10), 0, 300_000, 0)] })],
      ALL_TIME
    )
    expect(long[0].cost).toBeCloseTo(1.8)
    const short = buildTimeline(
      [series({ models: ["claude-sonnet-4-5"], events: [ev(day(10), 0, 100_000, 0)] })],
      ALL_TIME
    )
    expect(short[0].cost).toBeCloseTo(0.3)
  })

  it("costs an unpriced model at zero rather than dropping the tokens", () => {
    const t = buildTimeline(
      [series({ models: ["mystery-model"], events: [ev(day(10), 0, 100, 5)] })],
      ALL_TIME
    )
    expect(t[0].cost).toBe(0)
    expect(t[0].usage.total).toBe(105)
  })
})

describe("modelMix", () => {
  it("buckets tokens per model over time", () => {
    const mix = modelMix(
      [
        series({
          models: ["opus", "haiku"],
          events: [ev(day(10), 0, 100, 0), ev(day(10), 1, 40, 0), ev(day(11), 0, 60, 0)],
        }),
      ],
      ALL_TIME,
      "day"
    )
    expect(mix.models).toEqual(["opus", "haiku"])
    expect(mix.buckets).toHaveLength(2)
    expect(mix.buckets[0]).toEqual({ key: "2026-07-10", opus: 100, haiku: 40 })
    expect(mix.buckets[1]).toEqual({ key: "2026-07-11", opus: 60, haiku: 0 })
  })

  it("collapses the tail into `other` so the stack still sums to the truth", () => {
    const events = Array.from({ length: 4 }, (_, i) => ev(day(10), i, (4 - i) * 10, 0))
    const mix = modelMix([series({ models: ["a", "b", "c", "d"], events })], ALL_TIME, "day", 2)
    expect(mix.models).toEqual(["a", "b", "other"])
    const row = mix.buckets[0]
    expect(row.a).toBe(40)
    expect(row.b).toBe(30)
    expect(row.other).toBe(30) // c (20) + d (10)
  })

  it("labels events with no model as `unknown` rather than dropping them", () => {
    const mix = modelMix([series({ events: [ev(day(10), -1, 5, 0)] })], ALL_TIME, "day")
    expect(mix.models).toEqual(["unknown"])
  })
})

describe("cacheStats", () => {
  it("reports the share of the prompt served from cache", () => {
    const st = cacheStats([series({ events: [ev(day(10), 0, 100, 10, 700, 200)] })], ALL_TIME)
    expect(st.read).toBe(700)
    expect(st.write).toBe(200)
    expect(st.fresh).toBe(100)
    expect(st.hitRate).toBeCloseTo(0.7)
  })

  it("values the saving against paying full input rate for the same tokens", () => {
    // Opus 4.8: input $5/M, cacheRead $0.5/M, cacheWrite $6.25/M.
    // Cached: 1M × 0.5 + 0 = $0.50; fresh equivalent: 1M × 5 = $5.00 → $4.50.
    const st = cacheStats([series({ events: [ev(day(10), 0, 0, 0, 1e6, 0)] })], ALL_TIME)
    expect(st.savedUsd).toBeCloseTo(4.5)
  })

  it("shows a negative saving when a session only ever writes cache", () => {
    // Writes cost 1.25× input and nothing was read back — that is a real loss,
    // and rounding it up to zero would flatter the number.
    const st = cacheStats([series({ events: [ev(day(10), 0, 0, 0, 0, 1e6)] })], ALL_TIME)
    expect(st.savedUsd).toBeLessThan(0)
  })

  it("counts Codex's cached tokens without double-counting them as fresh", () => {
    const st = cacheStats(
      [
        series({
          source: "codex",
          models: ["gpt-5.3-codex"],
          events: [ev(day(10), 0, 100, 0, 80)],
        }),
      ],
      ALL_TIME
    )
    expect(st.read).toBe(80)
    expect(st.fresh).toBe(20)
  })
})

describe("aggregateTools", () => {
  const withTools = (id: string, ts: number) =>
    series({
      id,
      events: [ev(ts, 0, 1, 1)],
      tools: [
        { name: "Read", calls: 3, errors: 1 },
        { name: "mcp__deepwiki__ask_question", calls: 2, errors: 0 },
      ],
    })

  it("sums calls and errors across sessions, busiest first", () => {
    const tools = aggregateTools([withTools("a", day(10)), withTools("b", day(11))], ALL_TIME)
    expect(tools[0]).toEqual({ name: "Read", calls: 6, errors: 2 })
    expect(tools[1].calls).toBe(4)
  })

  it("includes a session only when it has activity inside the range", () => {
    const tools = aggregateTools(
      [withTools("a", day(10)), withTools("b", day(30))],
      customRange(day(9), day(11))
    )
    expect(tools[0].calls).toBe(3)
  })
})

describe("tool origin", () => {
  it("recognises the shared mcp__server__tool namespace", () => {
    expect(isMcpTool("mcp__deepwiki__ask_question")).toBe(true)
    expect(isMcpTool("Read")).toBe(false)
  })

  it("splits calls between built-ins and MCP", () => {
    expect(
      splitToolOrigin([
        { name: "Read", calls: 5, errors: 0 },
        { name: "mcp__x__y", calls: 2, errors: 0 },
      ])
    ).toEqual({ builtinCalls: 5, mcpCalls: 2 })
  })
})

describe("totalUsage", () => {
  it("adds up every in-range event", () => {
    const u = totalUsage(
      [series({ events: [ev(day(10), 0, 10, 1), ev(day(30), 0, 999, 0)] })],
      customRange(day(9), day(11))
    )
    expect(u.total).toBe(11)
  })
})
