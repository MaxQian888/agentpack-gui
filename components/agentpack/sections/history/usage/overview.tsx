"use client"

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis } from "recharts"
import { Card } from "@/components/ui/card"
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
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { useT } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import {
  formatCost,
  formatCostFigure,
  formatDuration,
  formatNumber,
  formatTokens,
} from "@/lib/history/format"
import { CHART_SERIES, SOURCE_COLORS } from "@/lib/history/display"
import { bucketLabel } from "@/lib/history/range"
import { statsCostFigure } from "@/lib/history/stats"
import { Stat, StatGrid, PanelTitle } from "./stat"
import { DrillButton } from "./drill-button"
import type { UsageView } from "./view"
import type { UsageDrilldown } from "./index"

const INPUT_COLOR = CHART_SERIES.input
const OUTPUT_COLOR = CHART_SERIES.output
const HOUR_COLOR = CHART_SERIES.hour

export function OverviewPanel({
  view,
  onDrilldown,
}: {
  view: UsageView
  onDrilldown: (focus: UsageDrilldown) => void
}) {
  const t = useT().history
  const { stats, previous, buckets, granularity } = view
  const { totals, averages, bySource, byProject, byHour, unpriced, subagents } = stats

  const delta = (current: number, key: (s: typeof stats) => number) =>
    previous ? pct(current, key(previous)) : undefined
  // Only a day bucket maps cleanly onto a session filter; a week or month would
  // need a range filter the browser doesn't have. So the chart says it is
  // clickable only when a click will do something.
  const dayDrill = granularity === "day"
  // A single bucket is one point, and an area needs two to draw anything — a
  // "Today" chart used to render as an empty frame. The point is drawn instead.
  const dot = buckets.length < 2

  const dayConfig: ChartConfig = {
    input: { label: t.statInput, color: INPUT_COLOR },
    output: { label: t.statOutput, color: OUTPUT_COLOR },
  }
  const hourConfig: ChartConfig = { sessions: { label: t.colSessions, color: HOUR_COLOR } }
  const sourceConfig: ChartConfig = Object.fromEntries(
    bySource.map((s) => [
      s.source,
      { label: t.sources[s.source] ?? s.source, color: SOURCE_COLORS[s.source] },
    ])
  )
  const pieData = bySource.map((s) => ({
    source: s.source,
    value: s.usage.total,
    fill: SOURCE_COLORS[s.source],
  }))

  return (
    <div className="flex flex-col gap-4">
      <StatGrid className="grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <Stat
          label={t.statSessions}
          value={formatNumber(totals.sessions)}
          sub={t.rootSessionsHint}
          delta={delta(totals.sessions, (s) => s.totals.sessions)}
        />
        <Stat
          label={t.statMessages}
          value={formatNumber(totals.messages)}
          delta={delta(totals.messages, (s) => s.totals.messages)}
        />
        <Stat
          label={t.statTokens}
          value={formatTokens(totals.usage.total)}
          sub={formatNumber(totals.usage.total)}
          delta={delta(totals.usage.total, (s) => s.totals.usage.total)}
        />
        <Stat label={t.statInput} value={formatTokens(totals.usage.input)} />
        <Stat label={t.statOutput} value={formatTokens(totals.usage.output)} />
        <Stat
          label={t.statCost}
          value={formatCostFigure(statsCostFigure(stats))}
          sub={unpriced.transcripts > 0 ? t.unpricedExcluded(unpriced.transcripts) : undefined}
          delta={delta(totals.cost, (s) => s.totals.cost)}
          tone="up-bad"
        />
      </StatGrid>

      {/* Cost provenance. One summed number would imply a precision we don't
          have: OpenCode records real dollars, Claude/Codex are priced from
          tokens, and an unpriced model contributes nothing at all. */}
      <Card className="gap-3 p-4">
        <PanelTitle title={t.costBreakdownTitle} hint={t.costBreakdownHint} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Segment
            label={t.costActual}
            value={formatCost(stats.actualCost)}
            note={t.costActualNote}
          />
          <Segment
            label={t.costEstimated}
            value={formatCost(stats.estimatedCost)}
            note={t.costEstimatedNote}
          />
          <Segment
            label={t.costUnpriced}
            value={
              unpriced.transcripts > 0
                ? t.unpricedValue(unpriced.transcripts, formatTokens(unpriced.tokens))
                : t.costUnpricedNone
            }
            note={t.costUnpricedNote}
          />
        </div>
      </Card>

      <StatGrid className="grid-cols-2 md:grid-cols-4">
        <Stat
          label={t.statCache}
          value={formatTokens(totals.usage.cacheRead)}
          sub={formatNumber(totals.usage.cacheRead)}
        />
        <Stat
          label={t.statSubagents}
          value={formatTokens(subagents.tokens)}
          sub={t.subagentShare(
            totals.usage.total > 0 ? Math.round((subagents.tokens / totals.usage.total) * 100) : 0,
            subagents.transcripts
          )}
        />
        <Stat label={t.statAvgTokens} value={formatTokens(averages.tokensPerSession)} />
        <Stat
          label={t.statAvgCost}
          value={formatCostFigure(statsCostFigure(stats, averages.costPerSession))}
        />
      </StatGrid>

      {totals.durationSessions > 0 ? (
        <StatGrid className="grid-cols-2">
          <Stat
            label={t.statDuration}
            value={formatDuration(totals.durationMs)}
            sub={t.durationCoverage(totals.durationSessions, totals.sessions)}
          />
          <Stat label={t.statAvgDuration} value={formatDuration(averages.durationPerSession)} />
        </StatGrid>
      ) : null}

      <Card className="gap-3 p-4">
        <PanelTitle title={t.chartByDay} hint={dayDrill ? t.clickDayToDrill : undefined} />
        <ChartContainer
          config={dayConfig}
          className={cn("h-[240px] w-full", dayDrill && "cursor-pointer")}
        >
          <AreaChart
            data={buckets}
            margin={{ left: 4, right: 4, top: 4 }}
            onClick={(state) => {
              const label = state?.activeLabel
              if (dayDrill && typeof label === "string") onDrilldown({ day: label })
            }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="key"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
              tickFormatter={(v: string) => bucketLabel(v, granularity)}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <defs>
              <linearGradient id="fillInput" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={INPUT_COLOR} stopOpacity={0.7} />
                <stop offset="95%" stopColor={INPUT_COLOR} stopOpacity={0.08} />
              </linearGradient>
              <linearGradient id="fillOutput" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={OUTPUT_COLOR} stopOpacity={0.7} />
                <stop offset="95%" stopColor={OUTPUT_COLOR} stopOpacity={0.08} />
              </linearGradient>
            </defs>
            <Area
              dataKey="input"
              type="monotone"
              stackId="a"
              stroke={INPUT_COLOR}
              fill="url(#fillInput)"
              dot={dot ? { r: 4, fill: INPUT_COLOR, strokeWidth: 0 } : false}
            />
            <Area
              dataKey="output"
              type="monotone"
              stackId="a"
              stroke={OUTPUT_COLOR}
              fill="url(#fillOutput)"
              dot={dot ? { r: 4, fill: OUTPUT_COLOR, strokeWidth: 0 } : false}
            />
            <ChartLegend content={<ChartLegendContent />} />
          </AreaChart>
        </ChartContainer>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-3 p-4">
          <PanelTitle title={t.chartBySource} />
          {/* Sized like the charts above (explicit height + `w-full`), NOT with
              `mx-auto aspect-square max-h-`: `Card` is a flex column, so an auto
              inline margin cancels the cross-axis stretch and the container
              collapses to width 0 — and, through `aspect-square`, height 0 —
              which makes recharts warn and render nothing. */}
          <ChartContainer config={sourceConfig} className="h-[240px] w-full">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent nameKey="source" hideLabel />} />
              <Pie data={pieData} dataKey="value" nameKey="source" innerRadius={55} strokeWidth={2}>
                {pieData.map((d) => (
                  <Cell key={d.source} fill={d.fill} />
                ))}
              </Pie>
              <ChartLegend content={<ChartLegendContent nameKey="source" />} />
            </PieChart>
          </ChartContainer>
        </Card>

        <Card className="gap-3 p-4">
          <PanelTitle title={t.chartByHour} hint={t.chartByHourSub} />
          <ChartContainer config={hourConfig} className="h-[240px] w-full">
            <BarChart data={byHour} margin={{ left: 4, right: 4, top: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="hour"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                interval={2}
                tickFormatter={(v: number) => String(v).padStart(2, "0")}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) =>
                      `${String(payload?.[0]?.payload?.hour ?? "").padStart(2, "0")}:00`
                    }
                  />
                }
              />
              <Bar dataKey="sessions" fill={HOUR_COLOR} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </Card>
      </div>

      <Card className="gap-3 p-4">
        <PanelTitle title={t.tableProjects} hint={t.clickToDrill} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.colProject}</TableHead>
              <TableHead className="text-right">{t.colSessions}</TableHead>
              <TableHead className="text-right">{t.colTokens}</TableHead>
              <TableHead className="text-right">{t.colCost}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byProject.slice(0, 10).map((p) => (
              <TableRow
                key={p.project}
                className="cursor-pointer"
                onClick={() => onDrilldown({ project: p.project })}
              >
                <TableCell className="max-w-[18rem] truncate font-medium">
                  <DrillButton>{p.project}</DrillButton>
                </TableCell>
                <TableCell className="text-right tabular-nums">{p.sessions}</TableCell>
                <TableCell className="text-right tabular-nums">{formatTokens(p.total)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCostFigure({
                    value: p.cost,
                    estimated: p.estimated,
                    unpriced: p.unpriced,
                    transcripts: p.transcripts,
                  })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}

function Segment({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{note}</div>
    </div>
  )
}

function pct(current: number, previous: number): number | null {
  if (previous === 0) return null
  return ((current - previous) / previous) * 100
}
