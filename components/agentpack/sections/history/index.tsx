"use client"

import { useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"
import { useT } from "@/lib/i18n/provider"
import type { ListResult, ScanProgress, UsageSeriesResult } from "@/lib/history/types"
import { SessionBrowser, type BrowserFocus } from "./session-browser"
import { UsageDashboard, type UsageDrilldown } from "./usage"
import { DesktopOnlyNote } from "../../desktop-only-note"

/**
 * Chat-history browser + usage dashboard. Prop-driven like `DashboardSection`:
 * `ShellBody` owns the (lazy, cached) scans so leaving and returning to History
 * doesn't re-read every JSONL and the OpenCode DB.
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
  const h = useT().history
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
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      {/* This section builds its own header rather than using SectionShell, so
          the tour's spotlight anchor has to be added here explicitly. */}
      <div data-tour="section-heading" className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{h.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{h.subtitle}</p>
        </div>
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
      </div>

      {!tauri ? (
        <DesktopOnlyNote>{h.notTauri}</DesktopOnlyNote>
      ) : result === null ? (
        <ScanStatus progress={progress} />
      ) : (
        <>
          {result.errors.map((e) => (
            <p key={e.source} className="text-xs text-destructive">
              {h.scanError(h.sources[e.source] ?? e.source, e.message)}
            </p>
          ))}
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="sessions">{h.tabSessions}</TabsTrigger>
              <TabsTrigger value="usage">{h.tabUsage}</TabsTrigger>
            </TabsList>
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
