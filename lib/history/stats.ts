import type { HistorySource, SessionSummary, TokenUsage } from "./types"
import { addUsage, dayKey, emptyUsage, type CostFigure } from "./format"
import { estimateCost } from "./pricing"

/**
 * A session's USD cost.
 *
 * Three outcomes, kept apart on purpose: the source recorded a real figure
 * (OpenCode), we priced it ourselves from token counts (Claude Code / Codex),
 * or the model isn't in the pricing table at all. The third case used to be
 * reported as a real `$0`, which quietly folded unpriced sessions into the
 * "actual cost" bucket — `unpriced` makes it visible instead.
 */
export interface SessionCost {
  value: number
  estimated: boolean
  unpriced: boolean
}

export function sessionCost(s: SessionSummary): SessionCost {
  if (s.cost != null) {
    return {
      value: s.cost,
      estimated: s.costBasis === "sourceEstimate",
      unpriced: false,
    }
  }
  const est = estimateCost(s.source, s.model, s.usage)
  if (est != null) return { value: est, estimated: true, unpriced: false }
  return { value: 0, estimated: false, unpriced: true }
}

/** One transcript's cost in the shape `formatCostFigure` writes. */
export function sessionCostFigure(s: SessionSummary): CostFigure {
  const cost = sessionCost(s)
  return {
    value: cost.value,
    estimated: cost.estimated,
    unpriced: cost.unpriced ? 1 : 0,
    transcripts: 1,
  }
}

/**
 * The key a transcript is grouped under in `byProject`. Exported so a drill-down
 * from a project row filters on exactly the key the row was counted by — a
 * substring search for "api" also matched "api-gateway" and every title that
 * mentioned the word.
 */
export function projectKey(s: SessionSummary): string {
  return s.projectName || "—"
}

/**
 * Whether a transcript is a top-level conversation rather than a sub-agent run.
 *
 * A sub-agent carries its spawner's id in `parentId`; if that parent is absent
 * from the scan (its file was deleted) the orphan is treated as top-level so
 * its tokens never vanish from the session-count denominators.
 */
export function rootFlags(sessions: SessionSummary[]): boolean[] {
  const present = new Set(sessions.map((s) => `${s.source}:${s.id}`))
  return sessions.map((s) => s.parentId == null || !present.has(`${s.source}:${s.parentId}`))
}

/**
 * Nearest-rank percentile — returns a value that actually occurred rather than
 * an interpolation between two samples. Shared by the cost outlier threshold
 * and the five-hour block reference line, which must not drift apart.
 */
export function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil(q * sorted.length) - 1
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)]
}

export interface Totals {
  /**
   * Top-level conversations. Sub-agent transcripts are *not* counted here —
   * on a real Claude history they outnumber their parents (55% of files), so
   * counting them as peers inflates the total ~2.2× and deflates every
   * per-session average. Their tokens still land in `usage` and `cost`.
   */
  sessions: number
  messages: number
  usage: TokenUsage
  cost: number
  /**
   * Wall-clock time actually spent, summed over the top-level sessions that
   * report it. Only Claude Code records per-turn durations, so this covers a
   * subset of `sessions` — `durationSessions` says how many, so the average
   * isn't diluted by sources that simply don't measure it. Sub-agents are
   * excluded because their runtime elapses *inside* a parent turn that already
   * counted it.
   */
  durationMs: number
  durationSessions: number
}

export interface SourceStat extends Totals {
  source: HistorySource
}

/**
 * Bucket key for usage that named no model.
 *
 * A sentinel rather than an empty string so the key is never mistaken for a
 * missing value — but it *is* a key, not display text: the UI must translate it
 * rather than print it, or a non-English reader gets a stray English word.
 */
export const UNKNOWN_MODEL = "unknown"

export interface ModelStat {
  model: string
  /** Transcripts that used this model, sub-agent runs included. */
  transcripts: number
  usage: TokenUsage
  cost: number
}

export interface DayStat {
  day: string
  total: number
  input: number
  output: number
  cost: number
}

export interface ProjectStat {
  project: string
  sessions: number
  total: number
  cost: number
  /** Provenance of `cost`, for `formatCostFigure`. */
  transcripts: number
  unpriced: number
  estimated: boolean
}

/** Session count + tokens bucketed by local hour of day (0–23) of session start. */
export interface HourStat {
  hour: number
  sessions: number
  total: number
}

/** Per-session derived averages (0 when there are no sessions/messages). */
export interface Averages {
  tokensPerSession: number
  costPerSession: number
  /** Averaged over the sessions that report a duration, not over all of them. */
  durationPerSession: number
}

/** What sub-agent runs contributed — a subset of `totals`, not an addition. */
export interface SubagentShare {
  transcripts: number
  tokens: number
  cost: number
}

/** Sessions we couldn't price at all, so cost figures can state their reach. */
export interface UnpricedShare {
  transcripts: number
  tokens: number
}

export interface UsageStats {
  totals: Totals
  /** Every transcript folded in, sub-agent runs included — cost's denominator. */
  transcripts: number
  /** Sum of real, source-recorded costs (OpenCode). */
  actualCost: number
  /** Sum of costs we estimated from token counts (Claude Code / Codex). */
  estimatedCost: number
  /** Transcripts whose model has no known rate — absent from every cost above. */
  unpriced: UnpricedShare
  subagents: SubagentShare
  averages: Averages
  bySource: SourceStat[]
  byModel: ModelStat[]
  byDay: DayStat[]
  byProject: ProjectStat[]
  /** Always length 24, hour 0 → 23, zero-filled where there was no activity. */
  byHour: HourStat[]
}

/**
 * Aggregate session summaries into usage statistics. Pure and deterministic
 * (day bucketing uses local calendar days via `dayKey`).
 *
 * One rule runs through the whole fold: **every transcript contributes tokens
 * and cost, but only top-level ones contribute to session counts**. That keeps
 * sub-agent spend in the totals — it is real money — without letting it distort
 * "how many sessions did I have" or any average derived from that denominator.
 */
export function computeUsageStats(sessions: SessionSummary[]): UsageStats {
  const isRootAt = rootFlags(sessions)
  const totals: Totals = {
    sessions: 0,
    messages: 0,
    usage: emptyUsage(),
    cost: 0,
    durationMs: 0,
    durationSessions: 0,
  }
  const bySource = new Map<HistorySource, SourceStat>()
  const byModel = new Map<string, ModelStat>()
  const byDay = new Map<string, DayStat>()
  const byProject = new Map<string, ProjectStat>()
  const byHour: HourStat[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    sessions: 0,
    total: 0,
  }))
  let actualCost = 0
  let estimatedCost = 0
  const unpriced: UnpricedShare = { transcripts: 0, tokens: 0 }
  const subagents: SubagentShare = { transcripts: 0, tokens: 0, cost: 0 }

  for (const [i, s] of sessions.entries()) {
    const { value: cost, estimated, unpriced: noRate } = sessionCost(s)
    const isRoot = isRootAt[i]
    const rootCount = isRoot ? 1 : 0
    // Narrowed into a local rather than a `hasDuration` boolean: an alias of the
    // test doesn't carry the narrowing, which is what forced the casts here.
    const duration = isRoot && s.durationMs != null && s.durationMs > 0 ? s.durationMs : null

    totals.sessions += rootCount
    totals.messages += s.messageCount
    addUsage(totals.usage, s.usage)
    totals.cost += cost
    if (duration != null) {
      totals.durationMs += duration
      totals.durationSessions += 1
    }
    if (noRate) {
      unpriced.transcripts += 1
      unpriced.tokens += s.usage.total
    } else if (estimated) {
      estimatedCost += cost
    } else {
      actualCost += cost
    }
    if (!isRoot) {
      subagents.transcripts += 1
      subagents.tokens += s.usage.total
      subagents.cost += cost
    }

    let src = bySource.get(s.source)
    if (!src) {
      src = {
        source: s.source,
        sessions: 0,
        messages: 0,
        usage: emptyUsage(),
        cost: 0,
        durationMs: 0,
        durationSessions: 0,
      }
      bySource.set(s.source, src)
    }
    src.sessions += rootCount
    src.messages += s.messageCount
    addUsage(src.usage, s.usage)
    src.cost += cost
    if (duration != null) {
      src.durationMs += duration
      src.durationSessions += 1
    }

    // Attribute a transcript's usage to its primary model (fallback "unknown").
    // A sub-agent counts under whatever model *it* ran on, which is the point:
    // that is how a Haiku sub-agent under an Opus parent stays visible.
    const modelKey = s.model || UNKNOWN_MODEL
    let mod = byModel.get(modelKey)
    if (!mod) {
      mod = { model: modelKey, transcripts: 0, usage: emptyUsage(), cost: 0 }
      byModel.set(modelKey, mod)
    }
    mod.transcripts += 1
    addUsage(mod.usage, s.usage)
    mod.cost += cost

    // Bucket by the day the session was last active.
    const day = dayKey(s.updatedAt)
    let d = byDay.get(day)
    if (!d) {
      d = { day, total: 0, input: 0, output: 0, cost: 0 }
      byDay.set(day, d)
    }
    d.total += s.usage.total
    d.input += s.usage.input
    d.output += s.usage.output
    d.cost += cost

    const projKey = projectKey(s)
    let p = byProject.get(projKey)
    if (!p) {
      p = {
        project: projKey,
        sessions: 0,
        total: 0,
        cost: 0,
        transcripts: 0,
        unpriced: 0,
        estimated: false,
      }
      byProject.set(projKey, p)
    }
    p.sessions += rootCount
    p.total += s.usage.total
    p.cost += cost
    p.transcripts += 1
    if (noRate) p.unpriced += 1
    if (estimated) p.estimated = true

    // Bucket by the local hour the session was started (work-time pattern).
    const hour = new Date(s.startedAt).getHours()
    byHour[hour].sessions += rootCount
    byHour[hour].total += s.usage.total
  }

  const averages: Averages = {
    tokensPerSession: totals.sessions > 0 ? totals.usage.total / totals.sessions : 0,
    costPerSession: totals.sessions > 0 ? totals.cost / totals.sessions : 0,
    durationPerSession:
      totals.durationSessions > 0 ? totals.durationMs / totals.durationSessions : 0,
  }

  return {
    totals,
    transcripts: sessions.length,
    actualCost,
    estimatedCost,
    unpriced,
    subagents,
    averages,
    bySource: [...bySource.values()].sort((a, b) => b.usage.total - a.usage.total),
    byModel: [...byModel.values()].sort((a, b) => b.usage.total - a.usage.total),
    byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    byProject: [...byProject.values()].sort((a, b) => b.total - a.total),
    byHour,
  }
}

/**
 * A fold's cost in the shape `formatCostFigure` writes. `value` defaults to the
 * total; pass another figure drawn from the same fold (the per-session average)
 * and it carries the same provenance, because it is made of the same money.
 */
export function statsCostFigure(stats: UsageStats, value = stats.totals.cost): CostFigure {
  return {
    value,
    estimated: stats.estimatedCost > 0,
    unpriced: stats.unpriced.transcripts,
    transcripts: stats.transcripts,
  }
}

/** Case-insensitive match of a session against a free-text query. */
export function matchesQuery(s: SessionSummary, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    s.title.toLowerCase().includes(q) ||
    s.projectName.toLowerCase().includes(q) ||
    s.cwd.toLowerCase().includes(q) ||
    s.model.toLowerCase().includes(q)
  )
}
