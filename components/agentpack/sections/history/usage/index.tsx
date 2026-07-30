"use client"

import { useEffect, useMemo, useRef, useState } from "react"
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
import type { SessionSeries, SessionSummary } from "@/lib/history/types"
import { resolveRange, type Granularity, type TimeRange } from "@/lib/history/range"
import { bucketsCsv, buildExport, exportFilename } from "@/lib/history/export"
import { pickSavePath } from "@/lib/tauri/dialog"
import { ExportButtons, RangePicker } from "./range-picker"
import { OverviewPanel } from "./overview"
import { CostWindowsPanel } from "./cost-windows"
import { BehaviourPanel } from "./behaviour"
import { ShareDialog } from "./share-dialog"
import { buildView } from "./view"

export interface UsageDrilldown {
  query?: string
  day?: string
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
  seriesLoading,
  requestSeries,
  onDrilldown,
}: {
  sessions: SessionSummary[]
  series: SessionSeries[] | null
  seriesLoading: boolean
  requestSeries: () => void
  onDrilldown: (focus: UsageDrilldown) => void
}) {
  const t = useT().history
  const [range, setRange] = useState<TimeRange>(() => resolveRange("30d"))
  const [granularity, setGranularity] = useState<Granularity>("day")
  const [subscription, setSubscription] = useState<number | null>(null)
  const [shareOpen, setShareOpen] = useState(false)

  // One `now` for the whole render pass, so burn rate and "is this window still
  // active" can't disagree between panels. It ticks every minute because those
  // are live values — a window's remaining time is wrong the moment it's stale.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const requested = useRef(false)
  useEffect(() => {
    if (requested.current || series !== null || seriesLoading) return
    requested.current = true
    requestSeries()
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

  const view = useMemo(
    () => buildView({ sessions, series, range, granularity, now }),
    [sessions, series, range, granularity, now]
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

  const exportUsage = async (kind: "csv" | "json") => {
    if (!isTauri()) return
    const now = Date.now()
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
              granularity,
              stats: view.stats,
              buckets: view.buckets,
              blocks: view.blocks,
              tools: view.tools,
            }),
            null,
            2
          )
    await writeTextFile(path, content)
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
      <div className="flex flex-wrap items-center gap-2">
        <RangePicker
          range={range}
          onRangeChange={setRange}
          granularity={granularity}
          onGranularityChange={setGranularity}
        />
        <div className="flex items-center gap-2">
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
        </div>
      </div>

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
            <OverviewPanel view={view} onDrilldown={onDrilldown} />
          </TabsContent>
          <TabsContent value="cost" className="mt-4">
            <CostWindowsPanel view={view} now={now} subscriptionUsd={subscription} />
          </TabsContent>
          <TabsContent value="behaviour" className="mt-4">
            <BehaviourPanel view={view} onDrilldown={onDrilldown} />
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
  const [draft, setDraft] = useState(value == null ? "" : String(value))

  // Re-seed the field when the stored value changes underneath it (the initial
  // load), adjusting during render rather than in an effect so the popover never
  // flashes the stale text first.
  const [seeded, setSeeded] = useState(value)
  if (value !== seeded) {
    setSeeded(value)
    setDraft(value == null ? "" : String(value))
  }

  const commit = () => {
    const trimmed = draft.trim()
    const parsed = trimmed === "" ? null : Number(trimmed)
    const next = parsed != null && Number.isFinite(parsed) && parsed >= 0 ? parsed : null
    onChange(next)
    void saveSettings({ monthlySubscriptionUsd: next })
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
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit()
            }}
          />
          <p className="text-xs text-muted-foreground">{t.subscriptionSettingHint}</p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
