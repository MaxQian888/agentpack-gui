/**
 * The spend summary behind the dashboard card.
 *
 * Deliberately built from `SessionSummary` and nothing else. The usage dashboard
 * reads the per-message series (~200k packed events, ~9 MB) because its charts
 * need per-turn resolution; a headline "what have I spent this month" does not,
 * and making the home page wait on that file would put a multi-second stall in
 * front of the first screen every user sees.
 *
 * Pure and deterministic — `now` is injected rather than read, so the month
 * boundary is testable and can't shift mid-render.
 */
import type { HistorySource, SessionSummary } from "./types"
import { computeUsageStats } from "./stats"
import { sessionsInRange } from "./insights"
import {
  percentChange,
  previousRange,
  resolveRange,
  type RangePreset,
  type TimeRange,
} from "./range"

export interface SpendBySource {
  source: HistorySource
  cost: number
  tokens: number
}

export interface SpendSummary {
  range: TimeRange
  /** Total USD in the window. Excludes unpriced transcripts — see `unpriced`. */
  cost: number
  /** The part of `cost` we derived from token counts rather than read off disk. */
  estimatedCost: number
  /** The part of `cost` the source itself recorded (OpenCode). */
  actualCost: number
  tokens: number
  /** Top-level conversations only, matching `UsageStats.totals.sessions`. */
  sessions: number
  /**
   * Transcripts whose model has no known rate. They are absent from every cost
   * above, so the card can say the figure is a lower bound instead of implying
   * it priced everything.
   */
  unpricedTranscripts: number
  /** Descending by cost; only sources that actually appear in the window. */
  bySource: SpendBySource[]
  /** Change vs the equally long window before this one; null with no baseline. */
  deltaPct: number | null
  /**
   * Whether the window contains anything at all. Distinguishes "you have spent
   * $0.00" from "we found no history", which need different UI — the second is
   * the state a brand-new user lands in and it must not read as a real zero.
   */
  hasActivity: boolean
}

/**
 * Aggregate spend over `preset` (month-to-date by default — the window people
 * actually budget against).
 */
export function computeSpend(
  sessions: SessionSummary[],
  now: number = Date.now(),
  preset: Exclude<RangePreset, "custom"> = "month"
): SpendSummary {
  return computeSpendIn(sessions, resolveRange(preset, now))
}

/**
 * The same aggregate over an already-resolved window, so a caller that lets the
 * user pick the range (including a custom one) doesn't have to squeeze it back
 * through a preset.
 */
export function computeSpendIn(sessions: SessionSummary[], range: TimeRange): SpendSummary {
  const inWindow = sessionsInRange(sessions, range)
  const stats = computeUsageStats(inWindow)

  const prev = previousRange(range)
  const previousCost = prev ? computeUsageStats(sessionsInRange(sessions, prev)).totals.cost : null

  const bySource: SpendBySource[] = stats.bySource
    .map((s) => ({ source: s.source, cost: s.cost, tokens: s.usage.total }))
    .sort((a, b) => b.cost - a.cost)

  return {
    range,
    cost: stats.totals.cost,
    estimatedCost: stats.estimatedCost,
    actualCost: stats.actualCost,
    tokens: stats.totals.usage.total,
    sessions: stats.totals.sessions,
    unpricedTranscripts: stats.unpriced.transcripts,
    bySource,
    deltaPct: previousCost == null ? null : percentChange(stats.totals.cost, previousCost),
    hasActivity: inWindow.length > 0,
  }
}

/**
 * Daily cost for the window, oldest first, zero-filled.
 *
 * `UsageStats.byDay` only carries days that saw activity; a sparkline drawn from
 * that would silently compress idle days and misrepresent the shape. Returns []
 * for an unbounded range, which has no fixed number of columns to draw.
 */
export function dailyCostSeries(
  sessions: SessionSummary[],
  range: TimeRange
): { day: string; cost: number }[] {
  if (range.from == null || range.to == null) return []
  const stats = computeUsageStats(sessionsInRange(sessions, range))
  const byDay = new Map(stats.byDay.map((d) => [d.day, d.cost]))
  const out: { day: string; cost: number }[] = []
  // Step by calendar day through local time rather than adding 86_400_000, so a
  // DST transition doesn't shift every subsequent bucket by an hour.
  const cursor = new Date(range.from)
  cursor.setHours(0, 0, 0, 0)
  while (cursor.getTime() < range.to) {
    const y = cursor.getFullYear()
    const m = String(cursor.getMonth() + 1).padStart(2, "0")
    const d = String(cursor.getDate()).padStart(2, "0")
    const key = `${y}-${m}-${d}`
    out.push({ day: key, cost: byDay.get(key) ?? 0 })
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}
