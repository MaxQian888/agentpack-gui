/**
 * CSV / JSON export of whatever the dashboard is currently showing.
 *
 * Pure serialisation — the file dialog and the write live in the component, so
 * these stay unit-testable and free of Tauri imports.
 */
import type { UsageStats } from "./stats"
import type { UsageBlock } from "./blocks"
import type { ToolStat } from "./types"
import type { Granularity, TimeRange } from "./range"

/**
 * Quote a CSV field. Excel and Numbers both treat a leading `=`, `+`, `-` or
 * `@` as the start of a formula, so those get a leading apostrophe: a project
 * or branch called `-fix` must not execute anything when the file is opened.
 */
function csvField(value: string | number): string {
  const s = String(value)
  const guarded = /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvField).join(",")).join("\n")
}

/** Per-bucket rows, the shape a spreadsheet actually wants. */
export interface ExportBucket {
  key: string
  tokens: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
  sessions: number
  /** Sessions excluded from `cost` for want of a rate — see `unpriced_sessions`. */
  unpricedSessions: number
}

/**
 * `unpriced_sessions` is a column of its own rather than a footnote: a reader
 * summing `cost_usd` needs to see that some rows are lower bounds, and a CSV
 * has nowhere else to say so.
 */
export function bucketsCsv(buckets: ExportBucket[]): string {
  return toCsv([
    [
      "period",
      "sessions",
      "input",
      "output",
      "cache_read",
      "cache_write",
      "total_tokens",
      "cost_usd",
      "unpriced_sessions",
    ],
    ...buckets.map((b) => [
      b.key,
      b.sessions,
      b.input,
      b.output,
      b.cacheRead,
      b.cacheWrite,
      b.tokens,
      b.cost.toFixed(6),
      b.unpricedSessions,
    ]),
  ])
}

/** One five-hour window, as the JSON export writes it. */
export interface ExportBlock {
  start: string
  end: string
  tokens: number
  /** Lower bound when `unpricedEntries > 0`. */
  cost: number
  entries: number
  unpricedEntries: number
  models: string[]
  active: boolean
}

/** The whole aggregate, for scripts rather than spreadsheets. */
export interface UsageExport {
  generatedAt: string
  range: { preset: string; from: string | null; to: string | null }
  granularity: Granularity
  stats: UsageStats
  buckets: ExportBucket[]
  /**
   * `null` when the per-message series hadn't loaded (or couldn't be read) at
   * export time — the windows and tool tallies come only from it, and an empty
   * array would state "no windows, no tool calls" as a measured fact.
   */
  blocks: ExportBlock[] | null
  /** `null` for the same reason as `blocks`. */
  tools: ToolStat[] | null
}

export function buildExport(args: {
  generatedAt: number
  range: TimeRange
  granularity: Granularity
  stats: UsageStats
  buckets: ExportBucket[]
  /** `null` when the series isn't loaded — see `UsageExport.blocks`. */
  blocks: UsageBlock[] | null
  tools: ToolStat[] | null
}): UsageExport {
  const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString())
  return {
    generatedAt: new Date(args.generatedAt).toISOString(),
    range: {
      preset: args.range.preset,
      from: iso(args.range.from),
      to: iso(args.range.to),
    },
    granularity: args.granularity,
    stats: args.stats,
    buckets: args.buckets,
    blocks:
      args.blocks?.map((b) => ({
        start: new Date(b.start).toISOString(),
        end: new Date(b.end).toISOString(),
        tokens: b.usage.total,
        cost: b.cost,
        entries: b.entries,
        unpricedEntries: b.unpricedEntries,
        models: b.models,
        active: b.active,
      })) ?? null,
    tools: args.tools,
  }
}

/** Default file name, stamped so successive exports don't overwrite silently. */
export function exportFilename(range: TimeRange, ext: "csv" | "json", now: number): string {
  const stamp = new Date(now).toISOString().slice(0, 10)
  return `agentpack-usage-${range.preset}-${stamp}.${ext}`
}
