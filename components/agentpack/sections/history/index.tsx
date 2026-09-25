"use client"

import { useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"
import { useT } from "@/lib/i18n/provider"
import {
  WHOLE_SCAN,
  type ListResult,
  type ScanProgress,
  type UsageSeriesResult,
} from "@/lib/history/types"
import { computeUsageStats, statsCostFigure } from "@/lib/history/stats"
import { formatCostFigure, formatTokens } from "@/lib/history/format"
import { SessionBrowser, type BrowserFocus } from "./session-browser"
import { UsageDashboard, type UsageDrilldown } from "./usage"
import { DesktopOnlyNote } from "../../desktop-only-note"
import { HelpTip } from "../../help-tip"
import { SectionShell } from "../section-shell"
import { SectionStatus } from "../section-status"

/**
 * Chat-history browser + usage dashboard. Prop-driven like `DashboardSection`:
 * `ShellBody` owns the (lazy, cached) scans so leaving and returning to History
 * doesn't re-read every JSONL and the OpenCode DB.
 *
 * The frame is the workbench every other section uses — `SectionShell` for the
 * heading, one `SectionStatus` band for the verdict, content below. It used to
 * hand-build its own header, which is how it ended up the one page in the app
 * whose title sat at a different width from its neighbours and whose tour
 * anchor had to be re-added by hand.
 */
/**
 * The lazily-fetched usage series and the handle to ask for it.
 *
 * Bundled because the three always travel together and are meaningless apart:
 * `loading` without `data` is a spinner with nothing behind it, and `request`
 * without either has nowhere to put its result. Passing one object also stops a
 * caller from wiring up two of the three and silently getting a dashboard that
 * never loads.
 */
export interface SeriesFeed {
  data: UsageSeriesResult | null
  loading: boolean
  /** Ask the owner to fetch the series; a no-op once it's loaded or in flight. */
  request: () => void
}

export interface HistorySectionProps {
  result: ListResult | null
  loading: boolean
  /** Streamed while the caches are being rebuilt; null when idle. */
  progress: ScanProgress | null
  series: SeriesFeed
  refresh: () => void
  /** Which tab to open on — the overview's "Open usage dashboard" asks for Usage. */
  initialTab?: "sessions" | "usage"
}

export function HistorySection({
  result,
  loading,
  progress,
  series,
  refresh,
  initialTab = "sessions",
}: HistorySectionProps) {
  const t = useT()
  const h = t.history
  const tauri = isTauri()
  const [tab, setTab] = useState<string>(initialTab)
  // The usage panel mounts on first visit — that is what asks for the series —
  // and then stays mounted, hidden, like the session list does. Unmounting on
  // every switch threw away the period, grouping and sub-tab on one side and
  // the search, filters and scroll depth on the other.
  const [usageVisited, setUsageVisited] = useState(initialTab === "usage")
  const [focus, setFocus] = useState<BrowserFocus | undefined>()

  const selectTab = (next: string) => {
    setTab(next)
    if (next === "usage") setUsageVisited(true)
  }

  // A drill-down from a chart or table. The nonce is what makes clicking the
  // same bar twice work. A filter drill switches to the session list; a single
  // session opens its transcript where the user already is — the dialog floats
  // over either tab, and closing it should land back on the row they clicked.
  const drilldown = (next: UsageDrilldown) => {
    setFocus({ ...next, nonce: Date.now() })
    if (!next.session) setTab("sessions")
  }

  // Anything scanning at all: the startup read, a Rescan, or the series. A
  // second scan started over any of them would race it for the same caches.
  const busy = tauri && (loading || result === null || series.loading)
  const failure = result?.errors.find((e) => e.source === WHOLE_SCAN)

  return (
    <SectionShell
      title={h.title}
      subtitle={h.subtitle}
      help={<HelpTip text={t.help.history} />}
      wide
      actions={
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-2"
          onClick={refresh}
          disabled={busy || !tauri}
        >
          <RefreshCw className={cn("size-4", busy && "animate-spin")} />
          {/* Both labels share one grid cell, so the button is as wide as the
              longer one and swapping them never shifts the header. */}
          <span className="grid">
            <span aria-hidden={busy} className={cn("col-start-1 row-start-1", busy && "invisible")}>
              {h.refresh}
            </span>
            <span
              aria-hidden={!busy}
              className={cn("col-start-1 row-start-1", !busy && "invisible")}
            >
              {h.refreshing}
            </span>
          </span>
        </Button>
      }
    >
      {!tauri ? (
        <DesktopOnlyNote>{h.notTauri}</DesktopOnlyNote>
      ) : result === null ? (
        <ScanStatus progress={progress} />
      ) : failure ? (
        // Nothing was read, so there is nothing to summarise or list: a zeroed
        // band and "No sessions found" would state as fact what the failure
        // means nobody checked.
        <>
          <p role="alert" className="text-sm text-destructive">
            {h.scanFailed(failure.message)}
          </p>
          {loading ? <RescanStatus progress={progress} /> : null}
        </>
      ) : (
        <>
          <HistorySummary result={result} />
          {loading ? <RescanStatus progress={progress} /> : null}
          {result.errors.map((e) => (
            <p key={e.source} className="text-xs text-destructive">
              {h.scanError(h.sources[e.source] ?? e.source, e.message)}
            </p>
          ))}
          <Tabs value={tab} onValueChange={selectTab} className="gap-0">
            <TabsList aria-label={h.viewLabel}>
              <TabsTrigger value="sessions">{h.tabSessions}</TabsTrigger>
              <TabsTrigger value="usage">{h.tabUsage}</TabsTrigger>
            </TabsList>
            {/* One line under the strip saying what the open view answers. Two
                bare tab labels ("Sessions", "Usage") are only obvious once you
                already know what's behind them. */}
            <p className="mt-2 text-sm text-muted-foreground">
              {tab === "sessions" ? h.tabSessionsHint : h.tabUsageHint}
            </p>
            {/* `forceMount` alone would show both panels: Radix only derives
                `hidden` from presence, so it is set explicitly. */}
            <TabsContent value="sessions" className="mt-4" forceMount hidden={tab !== "sessions"}>
              <SessionBrowser sessions={result.sessions} focus={focus} />
            </TabsContent>
            <TabsContent
              value="usage"
              className="mt-4"
              forceMount={usageVisited || undefined}
              hidden={tab !== "usage"}
            >
              <UsageDashboard
                sessions={result.sessions}
                series={series.data?.sessions ?? null}
                seriesErrors={series.data?.errors ?? []}
                // A Rescan drops the series with the summaries; asking again
                // before it finishes would read the files it is re-reading.
                seriesLoading={series.loading || loading}
                requestSeries={series.request}
                onDrilldown={drilldown}
                active={tab === "usage"}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </SectionShell>
  )
}

/**
 * What the scan found, as one band of measured facts.
 *
 * Deliberately whole-history rather than range-aware: this sits above both
 * tabs, and a figure that silently followed the usage dashboard's range picker
 * would contradict the session list right under it. The note says so, because
 * "Cost $312" over a filtered list is exactly the kind of number a user carries
 * away wrong.
 */
function HistorySummary({ result }: { result: ListResult }) {
  const h = useT().history
  const { facts, unpriced } = useMemo(() => {
    const stats = computeUsageStats(result.sessions)
    const lastActive = result.sessions.reduce((max, s) => Math.max(max, s.updatedAt), 0)
    return {
      facts: [
        { label: h.statAllSessions, value: stats.totals.sessions },
        { label: h.statAllTokens, value: formatTokens(stats.totals.usage.total) },
        { label: h.statAllSpend, value: formatCostFigure(statsCostFigure(stats)) },
        {
          label: h.statLastActive,
          value: lastActive > 0 ? new Date(lastActive).toLocaleDateString() : h.statLastActiveNever,
        },
        { label: h.statSources, value: stats.bySource.length },
      ],
      unpriced: stats.unpriced.transcripts,
    }
  }, [result, h])

  return (
    <SectionStatus
      label={h.summaryLabel}
      facts={facts}
      // A `≥` or `—` on the spend figure is only half an answer without the reason.
      notes={[h.summaryNote, unpriced > 0 ? h.unpricedExcluded(unpriced) : null]}
    />
  )
}

/**
 * A Rescan over a list that is already on screen: the old list stays readable,
 * and this line says the new one is on its way and how far it has got.
 */
function RescanStatus({ progress }: { progress: ScanProgress | null }) {
  const h = useT().history
  const pct =
    progress && progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : null
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-2">
        <Spinner className="size-3.5" />
        {progress && progress.total > 0 ? h.scanProgress(progress.done, progress.total) : h.loading}
      </span>
      {pct !== null ? <Progress value={pct} className="w-40" /> : null}
    </div>
  )
}

/**
 * The first scan after an upgrade re-parses every transcript on disk — on a real
 * history that is gigabytes. Show how far it has got rather than a bare spinner
 * that looks identical whether it is working or wedged.
 */
function ScanStatus({ progress }: { progress: ScanProgress | null }) {
  const h = useT().history
  const pct =
    progress && progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : null
  return (
    <div className="flex flex-col items-center gap-3 p-10 text-sm text-muted-foreground">
      <span className="flex items-center gap-2">
        <Spinner className="size-4" />
        {progress && progress.total > 0 ? h.scanProgress(progress.done, progress.total) : h.loading}
      </span>
      {pct !== null ? <Progress value={pct} className="w-64" /> : null}
    </div>
  )
}
