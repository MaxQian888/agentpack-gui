"use client"

import { useEffect, useId, useMemo, useState } from "react"
import { Settings2, Share2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useT } from "@/lib/i18n/provider"
import { isTauri } from "@/lib/tauri"
import { writeTextFile } from "@/lib/tauri/commands"
import { loadSettings, saveSettings } from "@/lib/tauri/settings"
import {
  WHOLE_SCAN,
  type HistorySource,
  type SessionSeries,
  type SessionSummary,
  type SourceError,
} from "@/lib/history/types"
import { resolveRange, type Granularity, type TimeRange } from "@/lib/history/range"
import { bucketsCsv, buildExport, exportFilename } from "@/lib/history/export"
import { parseUsd } from "@/lib/history/format"
import { pickSavePath } from "@/lib/tauri/dialog"
import { FilterToolbar } from "../../filter-bar"
import { ExportButtons, RangePicker } from "./range-picker"
import { OverviewPanel } from "./overview"
import { CostWindowsPanel } from "./cost-windows"
import { BehaviourPanel } from "./behaviour"
import { ShareDialog } from "./share-dialog"
import { buildView } from "./view"

/**
 * "Show me what's behind this" — by identity, never by a text search. A search
 * for a project name also matched every project containing it and every title
 * mentioning it, and a session's title matched nothing at all when it was a
 * sub-agent the list nests out of sight.
 */
export interface UsageDrilldown {
  /** One local day (`YYYY-MM-DD`), from a day-grouped chart. */
  day?: string
  /** One `projectKey`, matched exactly. */
  project?: string
  /** The period the clicked figure was counted over, so the list agrees with it. */
  period?: { range: TimeRange; label: string }
  /** One transcript; a sub-agent opens inside its parent's transcript. */
  session?: { source: HistorySource; path: string }
}

/**
 * Usage dashboard: three tabs over one shared range.
 *
 * The series (per-message events, tool tallies) is fetched lazily the first time
 * this mounts, because it is far larger than the session summaries and only
 * these panels need it. Everything derived from summaries renders immediately;
 * the series-backed panels say so until it arrives.
 */
export function UsageDashboard({
  sessions,
  series,
  seriesErrors = [],
  seriesLoading,
  requestSeries,
  onDrilldown,
  active = true,
}: {
  sessions: SessionSummary[]
  series: SessionSeries[] | null
  /** What went wrong reading the series; a `WHOLE_SCAN` entry means none of it was read. */
  seriesErrors?: SourceError[]
  seriesLoading: boolean
  requestSeries: () => void
  onDrilldown: (focus: UsageDrilldown) => void
  /** False while the dashboard is kept mounted behind another tab. */
  active?: boolean
}) {
  const t = useT().history
  const [range, setRange] = useState<TimeRange>(() => resolveRange("30d"))
  const [granularity, setGranularity] = useState<Granularity>("day")
  const [subscription, setSubscription] = useState<number | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  // The outcome of the last export, in words: a write the user can't see needs
  // saying, and one that failed must never look like it worked.
  const [exportStatus, setExportStatus] = useState<{ ok: boolean; text: string } | null>(null)

  // One `now` for the whole render pass, so burn rate and "is this window still
  // active" can't disagree between panels. It ticks every minute because those
  // are live values — a window's remaining time is wrong the moment it's stale.
  // Paused while the dashboard sits hidden behind the Sessions tab — nothing
  // is reading those figures — and refreshed as soon as it shows again, from a
  // timer rather than synchronously inside the effect.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const tick = () => setNow(Date.now())
    const refresh = setTimeout(tick, 0)
    const id = setInterval(tick, 60_000)
    return () => {
      clearTimeout(refresh)
      clearInterval(id)
    }
  }, [active])

  // Ask whenever there is no series and nothing is fetching one — including
  // after a Rescan, which drops it. A once-only latch here used to leave the
  // panels on "Loading…" forever after the first Rescan; the owner's own
  // in-flight guard is what stops a duplicate fetch, not this effect.
  useEffect(() => {
    if (series === null && !seriesLoading) requestSeries()
  }, [series, seriesLoading, requestSeries])

  useEffect(() => {
    let cancelled = false
    loadSettings().then((s) => {
      if (!cancelled) setSubscription(s.monthlySubscriptionUsd)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // A series that failed wholesale arrives as an empty list with an error; read
  // as data it would say "no tool calls, no windows" — so it is not data.
  const seriesFailure = seriesErrors.find((e) => e.source === WHOLE_SCAN) ?? null
  // A single day is one bucket whatever "Group by" says, and a week or month
  // key would also stop the day chart's click from drilling in.
  const effectiveGranularity: Granularity = range.preset === "today" ? "day" : granularity

  const view = useMemo(
    () =>
      buildView({
        sessions,
        series: seriesFailure ? null : series,
        seriesFailed: seriesFailure !== null,
        range,
        granularity: effectiveGranularity,
        now,
      }),
    [sessions, series, seriesFailure, range, effectiveGranularity, now]
  )

  // Same wording the range pills show, so the card's period line matches what
  // the user selected rather than restating the preset in its own words.
  const rangeLabel =
    range.preset === "custom" && range.from != null && range.to != null
      ? t.customRangeLabel(
          new Date(range.from).toLocaleDateString(),
          new Date(range.to - 1).toLocaleDateString()
        )
      : t.ranges[range.preset]

  // A project row's figures were counted over the period on screen, so the
  // list it opens carries the same period — otherwise "12 sessions" in the row
  // becomes 40 in the list, all time.
  const drilldown = (focus: UsageDrilldown) =>
    onDrilldown(
      focus.project !== undefined && range.preset !== "all"
        ? { ...focus, period: { range, label: rangeLabel } }
        : focus
    )

  const exportUsage = async (kind: "csv" | "json") => {
    if (!isTauri()) return
    const now = Date.now()
    setExportStatus(null)
    try {
      const path = await pickSavePath({
        defaultPath: exportFilename(range, kind, now),
        filters: [{ name: kind.toUpperCase(), extensions: [kind] }],
      })
      if (!path) return
      const content =
        kind === "csv"
          ? bucketsCsv(view.buckets)
          : JSON.stringify(
              buildExport({
                generatedAt: now,
                range,
                granularity: effectiveGranularity,
                stats: view.stats,
                buckets: view.buckets,
                // Series-backed: written as null until the series is in, not as
                // empty lists that would read as "none".
                blocks: view.seriesReady ? view.blocks : null,
                tools: view.seriesReady ? view.tools : null,
              }),
              null,
              2
            )
      await writeTextFile(path, content)
      setExportStatus({ ok: true, text: t.report.saved(path) })
    } catch (error) {
      setExportStatus({
        ok: false,
        text: t.exportFailed(error instanceof Error ? error.message : String(error)),
      })
    }
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        {t.usageEmpty}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Two tiers, the same shape the Sessions tab and the capability managers
          use: what the numbers below cover (period + granularity) stays out in
          the open, and what you do with them once you've read them — share,
          export, the one figure only the user can supply — sits at the trailing
          edge. Before this they were one undifferentiated row of seven
          controls, with the range picker's own `ml-auto` fighting the group
          beside it for the right-hand side. */}
      <FilterToolbar
        scope={
          <RangePicker
            range={range}
            onRangeChange={setRange}
            granularity={effectiveGranularity}
            onGranularityChange={setGranularity}
          />
        }
      >
        <Button variant="outline" size="sm" className="gap-2" onClick={() => setShareOpen(true)}>
          <Share2 className="size-4" />
          {t.report.share}
        </Button>
        <ExportButtons
          onCsv={() => void exportUsage("csv")}
          onJson={() => void exportUsage("json")}
          disabled={!isTauri()}
        />
        <SubscriptionSetting value={subscription} onChange={setSubscription} />
      </FilterToolbar>
      {exportStatus ? (
        <p
          role={exportStatus.ok ? "status" : "alert"}
          className={
            exportStatus.ok
              ? "text-xs break-all text-muted-foreground"
              : "text-xs break-all text-destructive"
          }
        >
          {exportStatus.text}
        </p>
      ) : null}
      {seriesErrors.map((e) => (
        <p key={e.source} className="text-xs text-destructive">
          {e.source === WHOLE_SCAN
            ? t.seriesFailed(e.message)
            : t.scanError(t.sources[e.source] ?? e.source, e.message)}
        </p>
      ))}

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        sessions={sessions}
        range={range}
        rangeLabel={rangeLabel}
        now={now}
      />

      {view.sessions.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t.rangeEmpty}
        </div>
      ) : (
        <Tabs defaultValue="overview">
          <div className="flex items-center gap-3">
            <TabsList>
              <TabsTrigger value="overview">{t.tabOverview}</TabsTrigger>
              <TabsTrigger value="cost">{t.tabCost}</TabsTrigger>
              <TabsTrigger value="behaviour">{t.tabBehaviour}</TabsTrigger>
            </TabsList>
            {seriesLoading ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Spinner className="size-3.5" />
                {t.seriesLoading}
              </span>
            ) : null}
          </div>
          <TabsContent value="overview" className="mt-4">
            <OverviewPanel view={view} onDrilldown={drilldown} />
          </TabsContent>
          <TabsContent value="cost" className="mt-4">
            <CostWindowsPanel view={view} now={now} subscriptionUsd={subscription} />
          </TabsContent>
          <TabsContent value="behaviour" className="mt-4">
            <BehaviourPanel view={view} onDrilldown={drilldown} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

/**
 * Monthly subscription spend, persisted. Optional on purpose: the transcripts
 * say nothing about which plan is in force, so the comparison only appears once
 * the user supplies the one number we can't derive.
 */
function SubscriptionSetting({
  value,
  onChange,
}: {
  value: number | null
  onChange: (v: number | null) => void
}) {
  const t = useT().history
  const hintId = useId()
  const errorId = useId()
  const [draft, setDraft] = useState(value == null ? "" : String(value))
  const [invalid, setInvalid] = useState(false)

  // Re-seed the field when the stored value changes underneath it (the initial
  // load), adjusting during render rather than in an effect so the popover never
  // flashes the stale text first.
  const [seeded, setSeeded] = useState(value)
  if (value !== seeded) {
    setSeeded(value)
    setDraft(value == null ? "" : String(value))
  }

  const commit = () => {
    const parsed = parseUsd(draft)
    // Text that isn't a number keeps the figure already saved. Reading it as
    // "not set" used to save null for "1,000" and make the comparison card
    // vanish with no word as to why.
    if (parsed === undefined) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    if (parsed === value) return
    onChange(parsed)
    void saveSettings({ monthlySubscriptionUsd: parsed })
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Settings2 className="size-4" />
          {t.subscriptionSetting}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="end">
        <div className="flex flex-col gap-2">
          <Label htmlFor="monthly-subscription">{t.subscriptionLabel}</Label>
          <Input
            id="monthly-subscription"
            inputMode="decimal"
            placeholder="200"
            value={draft}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${errorId} ${hintId}` : hintId}
            onChange={(e) => {
              setDraft(e.target.value)
              setInvalid(false)
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit()
            }}
          />
          {invalid ? (
            <p id={errorId} role="alert" className="text-xs text-destructive">
              {t.subscriptionInvalid}
            </p>
          ) : null}
          <p id={hintId} className="text-xs text-muted-foreground">
            {t.subscriptionSettingHint}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
