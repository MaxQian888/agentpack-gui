"use client"

import { ArrowDown, ArrowUp, Minus } from "lucide-react"
import { useT } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

/**
 * A headline number.
 *
 * `delta` is a percentage against the previous period, or `null` when there is
 * no baseline — a jump from zero isn't "+∞%", so that case renders as nothing
 * rather than an invented figure.
 */
export function Stat({
  label,
  value,
  sub,
  delta,
  tone,
}: {
  label: string
  value: string
  sub?: string
  delta?: number | null
  /** `up-good` colours growth green; `up-bad` colours it amber (cost, errors). */
  tone?: "up-good" | "up-bad"
}) {
  return (
    <div data-slot="stat" className="flex min-w-0 flex-col gap-1 bg-background p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {/*
        `flex-wrap` is what keeps the delta inside the card. These sit six to a
        row at xl, so a long value ("12,345,678") plus a badge ("↑ 999+%")
        overruns the line — and a flex item's default `min-width: auto` means
        the badge would be pushed past the right edge rather than shrink. It
        wraps onto its own line instead. `truncate` on the value is the last
        resort for a value wider than the whole card on its own; it only fires
        once the badge has already wrapped away, so the common case keeps both
        the full number and true baseline alignment.
      */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <div className="min-w-0 truncate text-2xl font-semibold tabular-nums">{value}</div>
        {delta != null && Number.isFinite(delta) ? <Delta value={delta} tone={tone} /> : null}
      </div>
      {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  )
}

/**
 * The frame a row of `Stat`s sits in: one hairline panel divided by rules, not
 * a row of identical cards (design.md § 5). The rules are the 1px gap showing
 * the border colour through, so the grid must be filled — choose column counts
 * that divide the number of stats, or an empty cell reads as a grey block.
 */
export function StatGrid({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("grid gap-px overflow-hidden rounded-lg border bg-border", className)}>
      {children}
    </div>
  )
}

function Delta({ value, tone = "up-good" }: { value: number; tone?: "up-good" | "up-bad" }) {
  // Anything under half a percent is noise between two periods of real work.
  const flat = Math.abs(value) < 0.5
  const up = value > 0
  const good = tone === "up-good" ? up : !up
  const Icon = flat ? Minus : up ? ArrowUp : ArrowDown
  return (
    <span
      className={cn(
        // `shrink-0`: the badge is already as small as it reads — squeezing it
        // is what let it spill out of the card instead of wrapping.
        "flex shrink-0 items-center gap-0.5 text-xs font-medium tabular-nums",
        flat ? "text-muted-foreground" : good ? "text-[var(--hm-ok)]" : "text-[var(--hm-warn)]"
      )}
    >
      <Icon className="size-3" />
      {Math.abs(value) >= 999 ? "999+" : Math.abs(value).toFixed(0)}%
    </span>
  )
}

/**
 * Section heading inside a card, with an optional one-line explanation.
 *
 * Deliberately not named `CardTitle`: shadcn exports one of those from
 * `@/components/ui/card`, and these panels import `Card` from there in the
 * same block — two different `CardTitle`s side by side reads as a bug.
 */
export function PanelTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h3 className="text-sm font-medium">{title}</h3>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/** Placeholder for a panel whose data the current range doesn't contain. */
export function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      {message}
    </div>
  )
}

/**
 * A series-backed panel before its data: still loading, or — once the fetch has
 * failed — unavailable. "Loading…" on a fetch that already failed never ends.
 */
export function SeriesPending({ failed }: { failed: boolean }) {
  const t = useT().history
  return <EmptyPanel message={failed ? t.seriesUnavailable : t.seriesLoading} />
}
