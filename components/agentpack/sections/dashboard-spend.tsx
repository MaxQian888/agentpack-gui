/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 */
/* Hallmark · genre: modern-minimal · macrostructure: Workbench · design-system: design.md · contrast: pass (40–41) · slop: pass (42–49) · mobile: pass (34, 49, 50–57) */
"use client"

import { useMemo } from "react"
import { Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"
import { useMounted } from "@/hooks/use-mounted"
import { useT } from "@/lib/i18n/provider"
import { WHOLE_SCAN, type ListResult, type ScanProgress } from "@/lib/history/types"
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
  /** A manual reread is running; the previous result remains cached. */
  loading?: boolean
  /** Streamed while gigabytes of JSONL are parsed; null when idle. */
  progress: ScanProgress | null
  /** Read the history again after a failed read or an empty month. */
  retry?: () => void
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
 * An empty month, no history, and an unreadable source are different states.
 */
export function SpendCard({
  history,
  onNavigate,
  onOpenUsage,
}: {
  history: HistoryFeed
  onNavigate: (key: SectionKey) => void
  /** Open History on its Usage tab — where the link says it goes. */
  onOpenUsage?: () => void
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
    const data = history.data
    if (history.loading || !spend || !data) {
      return <ScanningBody label={s.scanning} progress={history.progress} />
    }
    const failure =
      data.errors.find((e) => e.source === WHOLE_SCAN) ??
      (data.sessions.length === 0 ? data.errors[0] : undefined)
    if (failure) {
      return (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-[var(--hm-danger)] [overflow-wrap:anywhere]">
            {s.failed(failure.message)}
          </p>
          {history.retry ? (
            <Button size="sm" variant="outline" onClick={history.retry}>
              {s.retry}
            </Button>
          ) : null}
        </div>
      )
    }
    const unread = data.errors.length
    if (!spend.hasActivity) {
      if (data.sessions.length > 0) {
        return (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm font-medium">{s.monthEmpty}</p>
            <p className="text-sm text-muted-foreground">{s.monthEmptyHint}</p>
            {unread > 0 ? (
              <p className="text-xs text-[var(--hm-warn)]">{s.partial(unread)}</p>
            ) : null}
            {history.retry ? (
              <Button size="sm" variant="outline" onClick={history.retry}>
                {s.retry}
              </Button>
            ) : null}
          </div>
        )
      }
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
                  spend.deltaPct > 0 ? "text-[var(--hm-danger)]" : "text-[var(--hm-ok)]"
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
          {unread > 0 ? <span className="text-[var(--hm-warn)]">{s.partial(unread)}</span> : null}
        </div>
      </div>
    )
  }

  return (
    <section
      aria-label={s.title}
      className="flex min-w-0 flex-col gap-3 rounded-[var(--hm-radius-surface)] border p-4"
    >
      {/* Header and hand-off link are stacked, not opposed: the aside column is
          ~330px wide, and side by side the title wrapped to two lines. */}
      <div className="flex items-center gap-2">
        <Wallet className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-sm font-medium">{s.title}</h3>
      </div>
      {body()}
      <Button
        variant="link"
        size="sm"
        onClick={onOpenUsage ?? (() => onNavigate("history"))}
        className="h-auto self-start p-0 text-sm text-[var(--hm-accent)]"
      >
        {s.details}
      </Button>
    </section>
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
      <p role="status" className="text-xs text-muted-foreground">
        {label}
      </p>
      {progress && progress.total > 0 ? (
        <Progress value={(progress.done / progress.total) * 100} className="h-1" />
      ) : null}
    </div>
  )
}
