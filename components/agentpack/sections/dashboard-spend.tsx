"use client"

import { useMemo } from "react"
import { ArrowRight, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"
import { useMounted } from "@/hooks/use-mounted"
import { useT } from "@/lib/i18n/provider"
import type { ListResult, ScanProgress } from "@/lib/history/types"
import { computeSpend } from "@/lib/history/spend"
import { formatCost, formatNumber, formatTokens } from "@/lib/history/format"
import { formatDelta } from "@/lib/history/report"
import { SOURCE_COLORS } from "@/lib/history/display"
import type { SectionKey } from "../sidebar-nav"
import { DesktopOnlyNote } from "../desktop-only-note"

/** The startup history scan, as the dashboard sees it. */
export interface HistoryFeed {
  /** `null` while the scan is still running — that IS the loading signal. */
  data: ListResult | null
  /** Streamed while gigabytes of JSONL are parsed; null when idle. */
  progress: ScanProgress | null
}

/**
 * "What have I spent this month", on the home page.
 *
 * The dashboard is otherwise entirely about configuration; this is the one card
 * that answers a question the user has independently of setup, which is why it
 * leads. It is built from session *summaries* only — the per-message series the
 * usage dashboard uses is an order of magnitude larger and would put a stall in
 * front of the first screen.
 *
 * Three states that must stay distinct: still scanning, scanned-and-empty (a
 * brand-new user, who needs a way forward rather than a $0.00), and real
 * figures.
 */
export function SpendCard({
  history,
  onNavigate,
}: {
  history: HistoryFeed
  onNavigate: (key: SectionKey) => void
}) {
  const s = useT().dashboard.spend
  // `isTauri()` is false in the pre-rendered HTML but true in the desktop
  // webview — gate on mount so the first client render matches the server.
  const mounted = useMounted()

  const spend = useMemo(
    () => (history.data ? computeSpend(history.data.sessions) : null),
    [history.data]
  )

  const body = () => {
    if (mounted && !isTauri()) {
      return <DesktopOnlyNote>{s.notTauri}</DesktopOnlyNote>
    }
    if (!spend) return <ScanningBody label={s.scanning} progress={history.progress} />
    if (!spend.hasActivity) {
      return (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm font-medium">{s.empty}</p>
          <p className="text-sm text-muted-foreground">{s.emptyHint}</p>
          <Button size="sm" variant="outline" className="mt-1" onClick={() => onNavigate("clis")}>
            {s.emptyAction}
          </Button>
        </div>
      )
    }

    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
          <span className="text-4xl leading-none font-semibold tabular-nums">
            {formatCost(spend.cost)}
          </span>
          {spend.deltaPct != null ? (
            <span className="flex flex-col text-xs leading-tight">
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  spend.deltaPct > 0 ? "text-red-500" : "text-emerald-600"
                )}
              >
                {formatDelta(spend.deltaPct)}
              </span>
              <span className="text-muted-foreground">{s.vsPrevious}</span>
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <Metric label={s.tokens} value={formatTokens(spend.tokens)} />
          <Metric label={s.sessions} value={formatNumber(spend.sessions)} />
        </div>

        {spend.bySource.length > 0 ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {spend.bySource.map((src) => (
              <span key={src.source} className="flex items-center gap-1.5">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: SOURCE_COLORS[src.source] }}
                  aria-hidden="true"
                />
                {formatCost(src.cost)}
              </span>
            ))}
          </div>
        ) : null}

        {/* Caveats are part of the number, not a footnote: a figure shown
            without them reads as an invoice. */}
        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {spend.estimatedCost > 0 ? <span>{s.estimated}</span> : null}
          {spend.unpricedTranscripts > 0 ? (
            <span>{s.unpriced(spend.unpricedTranscripts)}</span>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <Card className="flex flex-col gap-3 p-4 sm:col-span-2 xl:col-span-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Wallet className="size-4" aria-hidden="true" />
          </span>
          <h3 className="font-medium">{s.title}</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => onNavigate("history")}
        >
          {s.details}
          <ArrowRight className="size-3" aria-hidden="true" />
        </Button>
      </div>
      {body()}
    </Card>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-medium tabular-nums">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  )
}

/**
 * The cold scan reads every transcript on disk, so it gets a real progress bar
 * rather than a spinner — at ~17s a bare spinner reads as a hang.
 */
function ScanningBody({ label, progress }: { label: string; progress: ScanProgress | null }) {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-9 w-32" />
      <p className="text-xs text-muted-foreground">{label}</p>
      {progress && progress.total > 0 ? (
        <Progress value={(progress.done / progress.total) * 100} className="h-1" />
      ) : null}
    </div>
  )
}
