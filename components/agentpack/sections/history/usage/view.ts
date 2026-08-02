/**
 * The one derived model all three usage tabs read from.
 *
 * Computed once per (sessions, series, range, granularity) and handed down, so
 * switching tabs doesn't re-aggregate a few thousand sessions and half a
 * million events.
 */
import type { SessionSeries, SessionSummary, ToolStat } from "@/lib/history/types"
import { computeUsageStats, type UsageStats } from "@/lib/history/stats"
import {
  bucketSessions,
  byBranch,
  costHistogram,
  sessionsInRange,
  topSessionsByCost,
  type BranchStat,
  type CostHistogram,
  type PeriodBucket,
  type RankedSession,
} from "@/lib/history/insights"
import {
  aggregateTools,
  buildTimeline,
  cacheStats,
  modelMix,
  splitToolOrigin,
  type CacheStats,
  type ModelMix,
  type ToolSplit,
} from "@/lib/history/series"
import { identifyBlocks, p90BlockTokens, type UsageBlock } from "@/lib/history/blocks"
import { previousRange, type Granularity, type TimeRange } from "@/lib/history/range"

export interface UsageView {
  range: TimeRange
  granularity: Granularity
  /** Sessions whose last activity falls inside the range. */
  sessions: SessionSummary[]
  stats: UsageStats
  /** The equally long window before this one, or null for an unbounded range. */
  previous: UsageStats | null
  buckets: PeriodBucket[]
  /**
   * The same aggregation forced to day granularity, for the cost heatmap — one
   * cell is one calendar day by definition, so it can't follow the `granularity`
   * control the way `buckets` does. Shares the array with `buckets` when the two
   * already agree, which is the common case.
   */
  dailyBuckets: PeriodBucket[]
  costHistogram: CostHistogram
  topSessions: RankedSession[]
  branches: BranchStat[]
  /** Series-derived; empty until the series has loaded. */
  blocks: UsageBlock[]
  activeBlock: UsageBlock | null
  p90Tokens: number
  modelMix: ModelMix
  cache: CacheStats
  tools: ToolStat[]
  toolSplit: ToolSplit
  /** True when the series hasn't been fetched yet, so those panels can say so. */
  seriesReady: boolean
}

export function buildView(args: {
  sessions: SessionSummary[]
  series: SessionSeries[] | null
  range: TimeRange
  granularity: Granularity
  now: number
}): UsageView {
  const { sessions, series, range, granularity, now } = args
  const inRangeSessions = sessionsInRange(sessions, range)
  const prev = previousRange(range)

  const seriesList = series ?? []
  const blocks = identifyBlocks(buildTimeline(seriesList, range), now)
  const tools = aggregateTools(seriesList, range)
  const buckets = bucketSessions(inRangeSessions, range, granularity)

  return {
    range,
    granularity,
    sessions: inRangeSessions,
    stats: computeUsageStats(inRangeSessions),
    previous: prev ? computeUsageStats(sessionsInRange(sessions, prev)) : null,
    buckets,
    dailyBuckets: granularity === "day" ? buckets : bucketSessions(inRangeSessions, range, "day"),
    costHistogram: costHistogram(inRangeSessions),
    topSessions: topSessionsByCost(inRangeSessions),
    branches: byBranch(inRangeSessions),
    blocks,
    activeBlock: blocks.find((b) => b.active) ?? null,
    p90Tokens: p90BlockTokens(blocks),
    modelMix: modelMix(seriesList, range, granularity),
    cache: cacheStats(seriesList, range),
    tools,
    toolSplit: splitToolOrigin(tools),
    seriesReady: series !== null,
  }
}
