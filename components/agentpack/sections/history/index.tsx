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
import type { ListResult, ScanProgress, UsageSeriesResult } from "@/lib/history/types"
import { computeUsageStats } from "@/lib/history/stats"
import { formatCost, formatTokens } from "@/lib/history/format"
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
}

export function HistorySection({
  result,
  loading,
  progress,
  series,
  refresh,
}: HistorySectionProps) {
  const t = useT()
  const h = t.history
  const tauri = isTauri()
  const [tab, setTab] = useState("sessions")
  const [focus, setFocus] = useState<BrowserFocus | undefined>()

  // A drill-down from a chart: switch to the session list and hand it the
  // filter. The nonce is what makes clicking the same bar twice work.
  const drilldown = (next: UsageDrilldown) => {
    setFocus({ ...next, nonce: Date.now() })
    setTab("sessions")
  }

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
          disabled={loading || !tauri}
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          {h.refresh}
        </Button>
      }
    >
      {!tauri ? (
        <DesktopOnlyNote>{h.notTauri}</DesktopOnlyNote>
      ) : result === null ? (
        <ScanStatus progress={progress} />
      ) : (
        <>
          <HistorySummary result={result} />
          {result.errors.map((e) => (
            <p key={e.source} className="text-xs text-destructive">
              {h.scanError(h.sources[e.source] ?? e.source, e.message)}
            </p>
          ))}
          <Tabs value={tab} onValueChange={setTab} className="gap-0">
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
            <TabsContent value="sessions" className="mt-4">
              <SessionBrowser sessions={result.sessions} focus={focus} />
            </TabsContent>
            <TabsContent value="usage" className="mt-4">
              <UsageDashboard
                sessions={result.sessions}
                series={series.data?.sessions ?? null}
                seriesLoading={series.loading}
                requestSeries={series.request}
                onDrilldown={drilldown}
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
  const facts = useMemo(() => {
    const stats = computeUsageStats(result.sessions)
    const lastActive = result.sessions.reduce((max, s) => Math.max(max, s.updatedAt), 0)
    const estimated = stats.estimatedCost > 0
    return [
      { label: h.statAllSessions, value: stats.totals.sessions },
      { label: h.statAllTokens, value: formatTokens(stats.totals.usage.total) },
      {
        label: h.statAllSpend,
        value: `${estimated ? "~" : ""}${formatCost(stats.totals.cost)}`,
      },
      {
        label: h.statLastActive,
        value: lastActive > 0 ? new Date(lastActive).toLocaleDateString() : h.statLastActiveNever,
      },
      { label: h.statSources, value: stats.bySource.length },
    ]
  }, [result, h])

  return <SectionStatus label={h.summaryLabel} facts={facts} notes={[h.summaryNote]} />
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
