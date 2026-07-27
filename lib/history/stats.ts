import type { HistorySource, SessionSummary, TokenUsage } from "./types"
import { addUsage, dayKey, emptyUsage } from "./format"
import { estimateCost } from "./pricing"

/** A session's USD cost — real when the source records it, else estimated. */
export interface SessionCost {
  value: number
  estimated: boolean
}

/**
 * Effective cost of a session: OpenCode's recorded cost when present, otherwise
 * an estimate from the model's token pricing (Claude Code / Codex). Falls back to
 * a non-estimated 0 when the model has no known rate.
 */
export function sessionCost(s: SessionSummary): SessionCost {
  if (s.cost != null) return { value: s.cost, estimated: false }
  const est = estimateCost(s.source, s.model, s.usage)
  return est != null ? { value: est, estimated: true } : { value: 0, estimated: false }
}

export interface Totals {
  sessions: number
  messages: number
  usage: TokenUsage
  cost: number
  /**
   * Wall-clock time actually spent, summed over the sessions that report it.
   * Only Claude Code records per-turn durations, so this covers a subset of
   * `sessions` — `durationSessions` says how many, so the average isn't diluted
   * by sources that simply don't measure it.
   */
  durationMs: number
  durationSessions: number
}

export interface SourceStat extends Totals {
  source: HistorySource
}

export interface ModelStat {
  model: string
  sessions: number
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

export interface UsageStats {
  totals: Totals
  /** Sum of real (OpenCode) costs. */
  actualCost: number
  /** Sum of estimated (Claude Code / Codex) costs. */
  estimatedCost: number
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
 * (day bucketing uses local calendar days via `dayKey`). Cost is only summed
 * where the source reported it (OpenCode); null costs contribute 0.
 */
export function computeUsageStats(sessions: SessionSummary[]): UsageStats {
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

  for (const s of sessions) {
    const { value: cost, estimated } = sessionCost(s)
    totals.sessions += 1
    totals.messages += s.messageCount
    addUsage(totals.usage, s.usage)
    totals.cost += cost
    if (s.durationMs != null && s.durationMs > 0) {
      totals.durationMs += s.durationMs
      totals.durationSessions += 1
    }
    if (estimated) estimatedCost += cost
    else actualCost += cost

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
    src.sessions += 1
    src.messages += s.messageCount
    addUsage(src.usage, s.usage)
    src.cost += cost
    if (s.durationMs != null && s.durationMs > 0) {
      src.durationMs += s.durationMs
      src.durationSessions += 1
    }

    // Attribute a session's usage to its primary model (fallback "unknown").
    const modelKey = s.model || "unknown"
    let mod = byModel.get(modelKey)
    if (!mod) {
      mod = { model: modelKey, sessions: 0, usage: emptyUsage(), cost: 0 }
      byModel.set(modelKey, mod)
    }
    mod.sessions += 1
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

    const projKey = s.projectName || "—"
    let p = byProject.get(projKey)
    if (!p) {
      p = { project: projKey, sessions: 0, total: 0, cost: 0 }
      byProject.set(projKey, p)
    }
    p.sessions += 1
    p.total += s.usage.total
    p.cost += cost

    // Bucket by the local hour the session was started (work-time pattern).
    const hour = new Date(s.startedAt).getHours()
    byHour[hour].sessions += 1
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
    actualCost,
    estimatedCost,
    averages,
    bySource: [...bySource.values()].sort((a, b) => b.usage.total - a.usage.total),
    byModel: [...byModel.values()].sort((a, b) => b.usage.total - a.usage.total),
    byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    byProject: [...byProject.values()].sort((a, b) => b.total - a.total),
    byHour,
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
