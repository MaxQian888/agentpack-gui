/**
 * Analysis over the message-level usage series.
 *
 * Everything here needs resolution the session summaries don't have: real
 * timestamps (five-hour windows, burn rate), which model spent which tokens
 * (model mix over time), and tool call tallies. Pure functions over the
 * `SessionSeries[]` that `historyUsageSeries` returns.
 */
import type { HistorySource, PackedEvent, SessionSeries, TokenUsage, ToolStat } from "./types"
import { EV } from "./types"
import { addUsage, emptyUsage } from "./format"
import { estimateRequestCost } from "./pricing"
import { UNKNOWN_MODEL } from "./stats"
import type { TimelineEntry } from "./blocks"
import { bucketKey, inRange, type Granularity, type TimeRange } from "./range"

/**
 * Expand a packed event's token counts.
 *
 * `total` has to be recomputed per source rather than stored: Claude's four
 * buckets are disjoint and sum to the total, while Codex's `input` already
 * subsumes the cached part and its `output` the reasoning part — adding those
 * up would count the same tokens twice.
 */
export function unpackUsage(source: HistorySource, ev: PackedEvent): TokenUsage {
  const input = ev[EV.input]
  const output = ev[EV.output]
  const cacheRead = ev[EV.cacheRead]
  const cacheWrite = ev[EV.cacheWrite]
  const reasoning = ev[EV.reasoning]
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning,
    total: source === "codex" ? input + output : input + output + cacheRead + cacheWrite,
  }
}

function modelOf(s: SessionSeries, ev: PackedEvent): string {
  const idx = ev[EV.model]
  return idx >= 0 ? (s.models[idx] ?? "") : ""
}

/**
 * Visit every event in `range` across every session, newest-first order not
 * guaranteed. Every walk over the series needs the same two guards — a
 * timestamp the writer never filled in (`<= 0`) and the range test — so they
 * live here once rather than being re-spelled at each call site.
 */
function eachEvent(
  series: SessionSeries[],
  range: TimeRange,
  visit: (s: SessionSeries, ev: PackedEvent, ts: number) => void
): void {
  for (const s of series) {
    for (const ev of s.events) {
      const ts = ev[EV.ts]
      if (ts <= 0 || !inRange(ts, range)) continue
      visit(s, ev, ts)
    }
  }
}

/**
 * Flatten every session's events into one account-wide, time-ordered timeline —
 * the input for five-hour blocks, which are cut per account rather than per
 * conversation.
 *
 * Cost is estimated per request, so a prompt that crossed a long-context
 * threshold is priced at the raised rate. That makes the timeline's cost an
 * estimate even for OpenCode, whose real figure is only recorded per session;
 * the headline cost cards still use the recorded value.
 */
export function buildTimeline(series: SessionSeries[], range: TimeRange): TimelineEntry[] {
  const out: TimelineEntry[] = []
  eachEvent(series, range, (s, ev, ts) => {
    const model = modelOf(s, ev)
    const usage = unpackUsage(s.source, ev)
    // A model absent from the pricing table yields null, which is carried as
    // `unpriced` rather than flattened to 0 — a real $0 would quietly understate
    // every block cost, burn rate and projection downstream.
    const reportedMicros = ev[EV.reportedCost]
    const reported =
      (s.costBasis === "sourceEstimate" || s.costBasis === "billed") &&
      reportedMicros != null &&
      reportedMicros >= 0
        ? reportedMicros / 1_000_000
        : null
    const cost = reported ?? estimateRequestCost(s.source, model, usage)
    out.push({ ts, model, usage, cost: cost ?? 0, unpriced: cost == null })
  })
  return out.sort((a, b) => a.ts - b.ts)
}

/**
 * One time bucket's tokens split by model, shaped for a stacked area chart.
 *
 * Flat rather than `{ key, tokens: Record<string, number> }` because recharts
 * addresses each series with `dataKey={model}` straight off the row. That forces
 * the index signature to admit `key`'s own string, so the tallies are summed in
 * a `Record<string, number>` first and the row assembled at the end — keeping
 * the arithmetic cast-free.
 */
export interface ModelBucket {
  key: string
  /** `model id → tokens`; every model in `models` is present, zero-filled. */
  [model: string]: string | number
}

export interface ModelMix {
  buckets: ModelBucket[]
  /** Models included, busiest first — the stack order and legend order. */
  models: string[]
}

/**
 * Band collecting every model outside the top N. Like {@link UNKNOWN_MODEL} it
 * is a key, not display text — translate it before showing it.
 */
export const OTHER_MODELS = "other"

/**
 * Tokens per time bucket, split by model, keeping only the `limit` busiest
 * models. Everything else collapses into one `other` band rather than being
 * dropped, so the stack still sums to the real total.
 */
export function modelMix(
  series: SessionSeries[],
  range: TimeRange,
  granularity: Granularity,
  limit = 6
): ModelMix {
  const totals = new Map<string, number>()
  const buckets = new Map<string, Map<string, number>>()

  eachEvent(series, range, (s, ev, ts) => {
    const model = modelOf(s, ev) || UNKNOWN_MODEL
    const tokens = unpackUsage(s.source, ev).total
    totals.set(model, (totals.get(model) ?? 0) + tokens)
    const key = bucketKey(ts, granularity)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = new Map()
      buckets.set(key, bucket)
    }
    bucket.set(model, (bucket.get(model) ?? 0) + tokens)
  })

  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m)
  const top = ranked.slice(0, limit)
  const hasOther = ranked.length > top.length
  const models = hasOther ? [...top, OTHER_MODELS] : top

  const rows: ModelBucket[] = [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, bucket]) => {
      const tally: Record<string, number> = {}
      for (const m of models) tally[m] = 0
      for (const [model, tokens] of bucket) {
        const band = top.includes(model) ? model : OTHER_MODELS
        tally[band] += tokens
      }
      return { ...tally, key }
    })

  return { buckets: rows, models }
}

export interface CacheStats {
  /** Tokens served from cache. */
  read: number
  /** Tokens written into the cache (billed at a premium). */
  write: number
  /** Fresh input tokens — neither read from nor written to cache. */
  fresh: number
  /** `read / (read + write + fresh)`, i.e. share of prompt served from cache. */
  hitRate: number
  /**
   * What those cached tokens would have cost at the full input rate, minus what
   * they actually cost. Cache *writes* are a premium, so they are subtracted —
   * a session that only ever writes cache shows a negative saving, which is the
   * honest answer.
   */
  savedUsd: number
}

/**
 * Cache effectiveness across the range. Only meaningful for Claude and OpenCode:
 * Codex reports cached tokens as a subset of `input` and never charges for
 * writes, so its events contribute reads but no write premium.
 */
export function cacheStats(series: SessionSeries[], range: TimeRange): CacheStats {
  let read = 0
  let write = 0
  let fresh = 0
  let saved = 0

  eachEvent(series, range, (s, ev) => {
    const usage = unpackUsage(s.source, ev)
    const model = modelOf(s, ev)
    const cacheRead = usage.cacheRead
    const cacheWrite = usage.cacheWrite
    const freshInput = s.source === "codex" ? Math.max(0, usage.input - cacheRead) : usage.input
    read += cacheRead
    write += cacheWrite
    fresh += freshInput

    // Price the cached tokens both ways and keep the difference.
    const asCached = estimateRequestCost(s.source, model, {
      ...emptyUsage(),
      input: s.source === "codex" ? cacheRead : 0,
      cacheRead: s.source === "codex" ? 0 : cacheRead,
      cacheWrite,
    })
    const asFresh = estimateRequestCost(s.source, model, {
      ...emptyUsage(),
      input: cacheRead + cacheWrite,
    })
    if (asCached != null && asFresh != null) saved += asFresh - asCached
  })

  const prompt = read + write + fresh
  return { read, write, fresh, hitRate: prompt > 0 ? read / prompt : 0, savedUsd: saved }
}

/**
 * Tool calls across the range, busiest first.
 *
 * Tool records carry no timestamp of their own, so a session is included whole
 * when *any* of its events falls in the range. At day granularity that is
 * exact; it only blurs for a session straddling a boundary.
 */
export function aggregateTools(series: SessionSeries[], range: TimeRange): ToolStat[] {
  const totals = new Map<string, ToolStat>()
  for (const s of series) {
    if (!s.events.some((ev) => ev[EV.ts] > 0 && inRange(ev[EV.ts], range))) continue
    for (const t of s.tools) {
      const acc = totals.get(t.name) ?? { name: t.name, calls: 0, errors: 0 }
      acc.calls += t.calls
      acc.errors += t.errors
      totals.set(t.name, acc)
    }
  }
  return [...totals.values()].sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
}

/**
 * Whether a tool name is an MCP tool. Every CLI namespaces them the same way —
 * `mcp__<server>__<tool>` — so the prefix is a reliable discriminator against
 * the built-ins.
 */
export function isMcpTool(name: string): boolean {
  return name.startsWith("mcp__")
}

export interface ToolSplit {
  builtinCalls: number
  mcpCalls: number
}

export function splitToolOrigin(tools: ToolStat[]): ToolSplit {
  let builtinCalls = 0
  let mcpCalls = 0
  for (const t of tools) {
    if (isMcpTool(t.name)) mcpCalls += t.calls
    else builtinCalls += t.calls
  }
  return { builtinCalls, mcpCalls }
}

/** Total tokens across a set of events, for headline figures over the range. */
export function totalUsage(series: SessionSeries[], range: TimeRange): TokenUsage {
  const total = emptyUsage()
  eachEvent(series, range, (s, ev) => addUsage(total, unpackUsage(s.source, ev)))
  return total
}
