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

export interface UsageStats {
  totals: Totals
  /** Sum of real (OpenCode) costs. */
  actualCost: number
  /** Sum of estimated (Claude Code / Codex) costs. */
  estimatedCost: number
  bySource: SourceStat[]
  byModel: ModelStat[]
  byDay: DayStat[]
  byProject: ProjectStat[]
}

/**
 * Aggregate session summaries into usage statistics. Pure and deterministic
 * (day bucketing uses local calendar days via `dayKey`). Cost is only summed
 * where the source reported it (OpenCode); null costs contribute 0.
 */
export function computeUsageStats(sessions: SessionSummary[]): UsageStats {
  const totals: Totals = { sessions: 0, messages: 0, usage: emptyUsage(), cost: 0 }
  const bySource = new Map<HistorySource, SourceStat>()
  const byModel = new Map<string, ModelStat>()
  const byDay = new Map<string, DayStat>()
  const byProject = new Map<string, ProjectStat>()
  let actualCost = 0
  let estimatedCost = 0

  for (const s of sessions) {
    const { value: cost, estimated } = sessionCost(s)
    totals.sessions += 1
    totals.messages += s.messageCount
    addUsage(totals.usage, s.usage)
    totals.cost += cost
    if (estimated) estimatedCost += cost
    else actualCost += cost

    let src = bySource.get(s.source)
    if (!src) {
      src = { source: s.source, sessions: 0, messages: 0, usage: emptyUsage(), cost: 0 }
      bySource.set(s.source, src)
    }
    src.sessions += 1
    src.messages += s.messageCount
    addUsage(src.usage, s.usage)
    src.cost += cost

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
  }

  return {
    totals,
    actualCost,
    estimatedCost,
    bySource: [...bySource.values()].sort((a, b) => b.usage.total - a.usage.total),
    byModel: [...byModel.values()].sort((a, b) => b.usage.total - a.usage.total),
    byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    byProject: [...byProject.values()].sort((a, b) => b.total - a.total),
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
