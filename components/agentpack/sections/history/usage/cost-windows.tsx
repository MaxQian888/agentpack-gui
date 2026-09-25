"use client"

import { useState } from "react"
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"
import { Flame } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { useT } from "@/lib/i18n/provider"
import {
  formatCost,
  formatCostFigure,
  formatDuration,
  formatTokens,
  type CostFigure,
} from "@/lib/history/format"
import { CHART_SERIES, modelColor } from "@/lib/history/display"
import { priceForModel } from "@/lib/history/pricing"
import { statsCostFigure, UNKNOWN_MODEL } from "@/lib/history/stats"
import { bucketLabel } from "@/lib/history/range"
import { burnRate, projectBlock, type UsageBlock } from "@/lib/history/blocks"
import { Stat, PanelTitle, EmptyPanel, SeriesPending } from "./stat"
import { CostHeatmap } from "./cost-heatmap"
import type { UsageView } from "./view"

const COST_COLOR = CHART_SERIES.cost

/** How the cost-over-time card is drawn. Not persisted — see `CostOverTimeCard`. */
type CostChartView = "heatmap" | "bar"

/** Rows the windows table renders before it starts saying "and N more". */
const BLOCK_ROWS = 60

export function CostWindowsPanel({
  view,
  now,
  subscriptionUsd,
}: {
  view: UsageView
  now: number
  subscriptionUsd: number | null
}) {
  const t = useT().history
  const { stats, blocks, activeBlock, p90Tokens, seriesReady, seriesFailed } = view
  // Newest first; the table renders at most `BLOCK_ROWS` of them and says so
  // rather than trailing off, so a capped list never reads as the whole history.
  const finished = blocks.filter((b) => !b.active).reverse()
  const shown = finished.slice(0, BLOCK_ROWS)

  return (
    <div className="flex flex-col gap-4">
      {activeBlock ? <ActiveBlockCard block={activeBlock} now={now} p90Tokens={p90Tokens} /> : null}

      {subscriptionUsd != null && subscriptionUsd > 0 ? (
        <SubscriptionCard apiEquivalent={statsCostFigure(stats)} paid={subscriptionUsd} />
      ) : null}

      <CostOverTimeCard view={view} />

      <Card className="gap-3 p-4">
        <PanelTitle title={t.chartByModel} hint={t.modelCostHint} />
        <div className="flex flex-col gap-2.5">
          {stats.byModel.slice(0, 8).map((m) => {
            const rate = priceForModel(m.model)
            const max = Math.max(1, ...stats.byModel.slice(0, 8).map((x) => x.usage.total))
            return (
              <div key={m.model} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: modelColor(m.model) }}
                      aria-hidden
                    />
                    <span className="truncate font-medium">
                      {m.model === UNKNOWN_MODEL ? t.noModel : m.model}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatTokens(m.usage.total)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(3, (m.usage.total / max) * 100)}%`,
                      backgroundColor: modelColor(m.model),
                    }}
                  />
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>
                    {rate ? t.ratePerMillion(formatCost(rate.input), formatCost(rate.output)) : ""}
                  </span>
                  <span className="tabular-nums">{m.cost > 0 ? formatCost(m.cost) : ""}</span>
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      <Card className="gap-3 p-4">
        <PanelTitle title={t.blocksTitle} hint={t.blocksHint} />
        {!seriesReady ? (
          <SeriesPending failed={seriesFailed} />
        ) : finished.length === 0 ? (
          <EmptyPanel message={t.blocksEmpty} />
        ) : (
          <div className="max-h-[420px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.colWindow}</TableHead>
                  <TableHead>{t.colModels}</TableHead>
                  <TableHead className="text-right">{t.colDuration}</TableHead>
                  <TableHead className="text-right">{t.colTokens}</TableHead>
                  <TableHead className="text-right">{t.colCost}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((b) => (
                  <TableRow key={b.start}>
                    <TableCell className="whitespace-nowrap font-medium tabular-nums">
                      {formatWindow(b)}
                    </TableCell>
                    <TableCell className="max-w-[14rem] truncate text-xs text-muted-foreground">
                      {b.models.join(", ") || t.noModel}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatDuration(b.lastActivity - b.firstActivity)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTokens(b.usage.total)}
                    </TableCell>
                    <TableCell
                      className="text-right tabular-nums"
                      title={
                        b.unpricedEntries > 0 ? t.costLowerBound(b.unpricedEntries) : undefined
                      }
                    >
                      {formatCostFigure({
                        value: b.cost,
                        // A window doesn't keep which of its entries were
                        // recorded and which estimated, so only the lower
                        // bound is marked — as it always was here.
                        estimated: false,
                        unpriced: b.unpricedEntries,
                        transcripts: b.entries,
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {finished.length > shown.length ? (
          <p className="text-xs text-muted-foreground">
            {t.blocksTruncated(shown.length, finished.length)}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">{t.blocksNoQuotaNote}</p>
      </Card>
    </div>
  )
}

/**
 * Cost over time, as a calendar heatmap or as the bar chart it used to be.
 *
 * The choice lives in component state on purpose: it is a way of looking at the
 * same numbers, not a preference about the app, and nothing about it is worth
 * writing to `settings.json` and carrying between machines. It resets when the
 * user leaves the section, which is the same lifetime the tab selection has.
 */
function CostOverTimeCard({ view }: { view: UsageView }) {
  const t = useT().history
  const [chart, setChart] = useState<CostChartView>("heatmap")
  const costConfig: ChartConfig = { cost: { label: t.statCost, color: COST_COLOR } }

  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PanelTitle
          title={t.chartCostByDay}
          hint={chart === "heatmap" ? t.heatmapHint : undefined}
        />
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={chart}
          // Radix reports a deselect as `""`. Ignoring it keeps one view always
          // chosen — a toggle group that can end up empty would leave the card
          // with nothing to draw.
          onValueChange={(v) => {
            if (v) setChart(v as CostChartView)
          }}
          aria-label={t.costViewLabel}
        >
          <ToggleGroupItem value="heatmap">{t.costView.heatmap}</ToggleGroupItem>
          <ToggleGroupItem value="bar">{t.costView.bar}</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {chart === "heatmap" ? (
        // `dailyBuckets`, not `buckets`: a heatmap cell is a day whatever the
        // "Group by" control says.
        <CostHeatmap buckets={view.dailyBuckets} />
      ) : (
        <ChartContainer config={costConfig} className="h-[220px] w-full">
          <BarChart data={view.buckets} margin={{ left: 4, right: 4, top: 4 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="key"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
              tickFormatter={(v: string) => bucketLabel(v, view.granularity)}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => (
                    <span className="font-mono font-medium tabular-nums">
                      {formatCost(Number(value))}
                    </span>
                  )}
                />
              }
            />
            <Bar dataKey="cost" fill={COST_COLOR} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ChartContainer>
      )}
    </Card>
  )
}

/**
 * The window currently running: what's left of it, how fast it is being spent,
 * and where that lands by close.
 */
function ActiveBlockCard({
  block,
  now,
  p90Tokens,
}: {
  block: UsageBlock
  now: number
  p90Tokens: number
}) {
  const t = useT().history
  const rate = burnRate(block, now)
  const projection = projectBlock(block, now)
  // Compared against the user's own history, not a published plan limit.
  const share = p90Tokens > 0 ? Math.min(100, (block.usage.total / p90Tokens) * 100) : 0

  return (
    <Card className="gap-3 p-4">
      <PanelTitle title={t.activeBlockTitle} hint={t.activeBlockHint} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label={t.blockRemaining}
          value={formatDuration(Math.max(0, block.end - now))}
          sub={formatWindow(block)}
        />
        <Stat label={t.blockTokens} value={formatTokens(block.usage.total)} />
        <Stat
          label={t.blockBurn}
          value={rate ? t.tokensPerMin(formatTokens(rate.tokensPerMinute)) : "—"}
          sub={rate ? t.costPerHour(formatCost(rate.costPerHour)) : undefined}
        />
        <Stat
          label={t.blockProjected}
          value={projection ? formatTokens(projection.totalTokens) : "—"}
          sub={projection ? formatCost(projection.totalCost) : undefined}
        />
      </div>
      {block.unpricedEntries > 0 ? (
        <p className="text-xs text-muted-foreground">{t.costLowerBound(block.unpricedEntries)}</p>
      ) : null}
      {p90Tokens > 0 ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Flame className="size-3.5" />
              {t.p90Label(formatTokens(p90Tokens))}
            </span>
            <span className="tabular-nums">{share.toFixed(0)}%</span>
          </div>
          <Progress value={share} />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t.p90NotEnough}</p>
      )}
    </Card>
  )
}

/**
 * What the same work would have cost on metered API pricing, against what the
 * user actually pays. Only shown once they've entered a figure — the
 * transcripts carry no evidence of which plan is in force.
 */
function SubscriptionCard({ apiEquivalent, paid }: { apiEquivalent: CostFigure; paid: number }) {
  const t = useT().history
  const figure = formatCostFigure(apiEquivalent)
  // `paid` is guaranteed positive by the caller's guard — no division guard here
  // would ever fire, and an unreachable one only pretends to be safety. A ratio
  // over a figure that priced nothing would be a made-up 0.0×, so it follows
  // the figure to `—`.
  const ratio = figure === "—" ? "—" : `${(apiEquivalent.value / paid).toFixed(1)}×`
  return (
    <Card className="gap-3 p-4">
      <PanelTitle title={t.subscriptionTitle} hint={t.subscriptionHint} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label={t.subscriptionApi} value={figure} />
        <Stat label={t.subscriptionPaid} value={formatCost(paid)} />
        <Stat label={t.subscriptionRatio} value={ratio} />
      </div>
    </Card>
  )
}

/**
 * A window as "Mar 10, 9 AM–2 PM", in the viewer's locale.
 *
 * Locale-formatted like every other date in this section rather than hand-built
 * as `MM-DD HH:00`: a reader outside the US reads `03-10` as the 3rd of October
 * about as readily as the 10th of March. Blocks always start on the hour, so
 * the hour alone carries the whole time.
 */
function formatWindow(b: UsageBlock): string {
  const start = new Date(b.start)
  const end = new Date(b.end)
  const date = start.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  const hour = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric" })
  return `${date} ${hour(start)}–${hour(end)}`
}
