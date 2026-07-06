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

/** Local calendar-day key (YYYY-MM-DD) for an epoch-ms instant. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}
