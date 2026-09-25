import type { TokenUsage } from "./types"

/** A zeroed token accumulator. */
export function emptyUsage(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 }
}

/** Add `b` into `a` in place and return `a` (fold-friendly). */
export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  a.input += b.input
  a.output += b.output
  a.cacheRead += b.cacheRead
  a.cacheWrite += b.cacheWrite
  a.reasoning += b.reasoning
  a.total += b.total
  return a
}

/** Compact token count: 940 → "940", 12_300 → "12.3K", 4_500_000 → "4.5M". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0"
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${trimZero(n / 1000)}K`
  if (n < 1_000_000_000) return `${trimZero(n / 1_000_000)}M`
  return `${trimZero(n / 1_000_000_000)}B`
}

function trimZero(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "")
}

/** Full number with grouped thousands (locale-independent, deterministic). */
export function formatNumber(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

/**
 * USD cost. Small amounts keep 4 decimals ("$0.0123"), larger ones 2 ("$3.40").
 * Returns "—" for null (sources without cost data).
 */
export function formatCost(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—"
  if (n === 0) return "$0.00"
  if (n < 1) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

/** A cost and how much of it is actually known — what `formatCostFigure` reads. */
export interface CostFigure {
  value: number
  /** Some of it was priced by us from token counts rather than recorded. */
  estimated: boolean
  /** Transcripts in it whose model has no known rate, so `value` leaves them out. */
  unpriced: number
  /** Transcripts it covers, priced or not. */
  transcripts: number
}

/**
 * The one way the history section writes a cost it aggregated, so a figure
 * carries its provenance on its face wherever it appears:
 *
 * - `—` when nothing in it could be priced — `$0.00` would claim a measured zero;
 * - `≥$X` when some of it had no rate, so `$X` is a lower bound;
 * - `~$X` when any of it was estimated from token counts;
 * - `$X` when every cent was recorded by the source.
 */
export function formatCostFigure(c: CostFigure): string {
  if (c.transcripts > 0 && c.unpriced >= c.transcripts) return "—"
  const figure = formatCost(c.value)
  if (c.unpriced > 0) return `≥${figure}`
  return c.estimated ? `~${figure}` : figure
}

/**
 * A dollar amount the user typed. `""` is "not set" (`null`); `undefined` means
 * the text isn't a non-negative number, so the caller keeps what it had rather
 * than quietly saving nothing. A leading `$` and thousands separators are
 * accepted, because that is how people write "$1,000" when asked for dollars.
 */
export function parseUsd(text: string): number | null | undefined {
  if (text.trim() === "") return null
  const cleaned = text.trim().replace(/^\$/, "").replace(/,/g, "").trim()
  // `Number("")` is 0, so a lone "$" would otherwise save as a real $0.
  if (cleaned === "") return undefined
  const n = Number(cleaned)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/**
 * Wall-clock duration in milliseconds, rendered at the coarsest unit that still
 * carries information ("45s", "12m", "3h 20m"). Returns "—" for null/zero, so a
 * source that doesn't measure duration reads as absent rather than instant.
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—"
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const totalMinutes = Math.round(totalSeconds / 60)
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
}

/** Local calendar-day key (YYYY-MM-DD) for an epoch-ms instant. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}
