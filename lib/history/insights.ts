/**
 * Derived views over session summaries: where the money went, which sessions
 * are outliers, and which git branch carried the work.
 *
 * Summary-level on purpose — these answer "which conversation" questions, so
 * they need the session identity that the packed event series deliberately
 * drops.
 */
import type { SessionSummary } from "./types"
import { percentile, rootFlags, sessionCost } from "./stats"
import { bucketKey, bucketKeysIn, inRange, type Granularity, type TimeRange } from "./range"

export { percentile }

/** Sessions that fall inside `range`, keyed off their last activity. */
export function sessionsInRange(sessions: SessionSummary[], range: TimeRange): SessionSummary[] {
  return sessions.filter((s) => inRange(s.updatedAt, range))
}

/** One time bucket's totals — the row behind every trend chart and the export. */
export interface PeriodBucket {
  key: string
  sessions: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  tokens: number
  /** Lower bound when `unpricedSessions > 0` — see {@link UnpricedShare}. */
  cost: number
  /** Sessions in this bucket whose model has no rate, so `cost` omits them. */
  unpricedSessions: number
}

/**
 * Roll sessions up into time buckets, keyed on last activity.
 *
 * Buckets the range covers but nothing landed in are emitted at zero, so a
 * quiet week reads as a gap in the chart rather than silently closing up and
 * making the trend look continuous. For an unbounded range only the buckets
 * that actually occurred are emitted — there is no start to fill from.
 */
export function bucketSessions(
  sessions: SessionSummary[],
  range: TimeRange,
  granularity: Granularity
): PeriodBucket[] {
  const empty = (key: string): PeriodBucket => ({
    key,
    sessions: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    tokens: 0,
    cost: 0,
    unpricedSessions: 0,
  })
  const buckets = new Map<string, PeriodBucket>()
  for (const key of bucketKeysIn(range, granularity)) buckets.set(key, empty(key))

  // Sub-agents contribute tokens but are not separate sessions. Reuse the same
  // root test `computeUsageStats` applies (orphans included) so a bucket's
  // session count can never disagree with the headline one.
  const isRootAt = rootFlags(sessions)
  for (const [i, s] of sessions.entries()) {
    const key = bucketKey(s.updatedAt, granularity)
    let b = buckets.get(key)
    if (!b) {
      b = empty(key)
      buckets.set(key, b)
    }
    if (isRootAt[i]) b.sessions += 1
    b.input += s.usage.input
    b.output += s.usage.output
    b.cacheRead += s.usage.cacheRead
    b.cacheWrite += s.usage.cacheWrite
    b.tokens += s.usage.total
    const cost = sessionCost(s)
    if (cost.unpriced) b.unpricedSessions += 1
    else b.cost += cost.value
  }
  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key))
}

export interface CostBucket {
  /** Inclusive lower bound of the bucket, in USD. */
  from: number
  /** Exclusive upper bound; `Infinity` for the open-ended top bucket. */
  to: number
  sessions: number
}

/**
 * Distribution of per-session cost over fixed, human-readable brackets.
 *
 * Fixed brackets rather than equal-width bins because session cost spans four
 * orders of magnitude: equal-width bins would put 99% of sessions in the first
 * one and tell the reader nothing.
 */
const COST_EDGES = [0, 0.01, 0.05, 0.25, 1, 5, 20, Infinity]

/**
 * Axis label for a cost bracket, as an upper-bound ladder (`<$0.05` … `≥$20`).
 *
 * Not `formatCost`: that renders sub-dollar amounts with four decimals, which
 * turns a tidy bracket edge into `<$0.0100` on the chart axis. Bracket edges are
 * round numbers by construction, so they want their own compact rendering.
 */
export function costBucketLabel(bucket: CostBucket): string {
  const edge = (v: number) => `$${v < 1 ? v.toFixed(2) : String(v)}`
  return bucket.to === Infinity ? `≥${edge(bucket.from)}` : `<${edge(bucket.to)}`
}

export interface CostHistogram {
  buckets: CostBucket[]
  /**
   * Sessions left out of every bucket because their model has no known rate.
   * Bucketing them would land them all in the cheapest bracket and misreport an
   * unknown cost as a measured near-zero one.
   */
  unpriced: number
}

export function costHistogram(sessions: SessionSummary[]): CostHistogram {
  const buckets: CostBucket[] = []
  for (let i = 0; i < COST_EDGES.length - 1; i += 1) {
    buckets.push({ from: COST_EDGES[i], to: COST_EDGES[i + 1], sessions: 0 })
  }
  let unpriced = 0
  for (const s of sessions) {
    const cost = sessionCost(s)
    if (cost.unpriced) {
      unpriced += 1
      continue
    }
    const idx = buckets.findIndex((b) => cost.value >= b.from && cost.value < b.to)
    if (idx >= 0) buckets[idx].sessions += 1
  }
  return { buckets, unpriced }
}

export interface RankedSession {
  session: SessionSummary
  /** 0 when `unpriced` — a placeholder, not a measured zero. */
  cost: number
  /** The session's model has no known rate, so `cost` says nothing. */
  unpriced: boolean
  /** True when this session's cost sits above the set's 95th percentile. */
  outlier: boolean
}

/**
 * The `limit` most expensive sessions, flagged against the whole set's P95 so
 * "expensive" is relative to how this user actually works rather than a
 * hard-coded dollar figure.
 */
export function topSessionsByCost(sessions: SessionSummary[], limit = 10): RankedSession[] {
  const costs = sessions.map((s) => {
    const cost = sessionCost(s)
    return { session: s, cost: cost.value, unpriced: cost.unpriced }
  })
  // The threshold is drawn from the priced sessions only: an unpriced session
  // sits at a placeholder 0, and letting a pile of those into the sample would
  // drag the P95 down and mint false outliers.
  const threshold = percentile(
    costs.filter((c) => !c.unpriced).map((c) => c.cost),
    0.95
  )
  return costs
    .sort((a, b) => b.cost - a.cost)
    .slice(0, limit)
    .map((c) => ({ ...c, outlier: !c.unpriced && threshold > 0 && c.cost > threshold }))
}

export interface BranchStat {
  branch: string
  sessions: number
  tokens: number
  /** Lower bound when `unpricedSessions > 0`. */
  cost: number
  /** Sessions on this branch whose model has no rate, so `cost` omits them. */
  unpricedSessions: number
}

/**
 * Usage grouped by git branch. Only Claude Code records a branch, and it records
 * the *first* one seen in a session — a session that switched branches is
 * attributed to where it started. Sessions without a branch are left out
 * entirely rather than lumped into a misleading "—" row.
 */
export function byBranch(sessions: SessionSummary[], limit = 10): BranchStat[] {
  const totals = new Map<string, BranchStat>()
  for (const s of sessions) {
    const branch = s.gitBranch?.trim()
    if (!branch) continue
    const acc = totals.get(branch) ?? {
      branch,
      sessions: 0,
      tokens: 0,
      cost: 0,
      unpricedSessions: 0,
    }
    acc.sessions += 1
    acc.tokens += s.usage.total
    const cost = sessionCost(s)
    if (cost.unpriced) acc.unpricedSessions += 1
    else acc.cost += cost.value
    totals.set(branch, acc)
  }
  return [...totals.values()].sort((a, b) => b.tokens - a.tokens).slice(0, limit)
}
