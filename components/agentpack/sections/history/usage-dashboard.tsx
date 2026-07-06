"use client"

import { useMemo } from "react"
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
import type { SessionSummary } from "@/lib/history/types"
import { computeUsageStats } from "@/lib/history/stats"
import { formatCost, formatNumber, formatTokens } from "@/lib/history/format"
import { priceForModel } from "@/lib/history/pricing"
import { SOURCE_COLORS, modelColor } from "@/lib/history/display"

const INPUT_COLOR = "#3b82f6"
const OUTPUT_COLOR = "#10b981"
const COST_COLOR = "#f59e0b"
const HOUR_COLOR = "#6366f1"

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="gap-1 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
    </Card>
  )
}

export function UsageDashboard({ sessions }: { sessions: SessionSummary[] }) {
  const t = useT().history
  const stats = useMemo(() => computeUsageStats(sessions), [sessions])

  if (stats.totals.sessions === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        {t.usageEmpty}
      </div>
    )
  }

  const { totals, averages, byDay, byHour, bySource, byModel, byProject, estimatedCost } = stats

  const dayConfig: ChartConfig = {
    input: { label: t.statInput, color: INPUT_COLOR },
    output: { label: t.statOutput, color: OUTPUT_COLOR },
  }
  const costConfig: ChartConfig = { cost: { label: t.statCost, color: COST_COLOR } }
  const hourConfig: ChartConfig = { sessions: { label: t.colSessions, color: HOUR_COLOR } }
  const hasCostByDay = byDay.some((d) => d.cost > 0)

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

  const topModels = byModel.slice(0, 8)
  const maxModel = Math.max(1, ...topModels.map((m) => m.usage.total))
  const topProjects = byProject.slice(0, 10)

  return (
    <div className="flex flex-col gap-4">
      {/* Headline stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label={t.statSessions} value={formatNumber(totals.sessions)} />
        <Stat label={t.statMessages} value={formatNumber(totals.messages)} />
        <Stat
          label={t.statTokens}
          value={formatTokens(totals.usage.total)}
          sub={formatNumber(totals.usage.total)}
        />
        <Stat label={t.statInput} value={formatTokens(totals.usage.input)} />
        <Stat label={t.statOutput} value={formatTokens(totals.usage.output)} />
        <Stat
          label={t.statCost}
          value={formatCost(totals.cost)}
          sub={estimatedCost > 0 ? t.costEstimatedSub(formatCost(estimatedCost)) : undefined}
        />
      </div>

      {/* Derived insights */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label={t.statCache}
          value={formatTokens(totals.usage.cacheRead)}
          sub={formatNumber(totals.usage.cacheRead)}
        />
        <Stat
          label={t.statReasoning}
          value={formatTokens(totals.usage.reasoning)}
          sub={formatNumber(totals.usage.reasoning)}
        />
        <Stat label={t.statAvgTokens} value={formatTokens(averages.tokensPerSession)} />
        <Stat label={t.statAvgCost} value={formatCost(averages.costPerSession)} />
      </div>

      {/* Tokens by day */}
      <Card className="gap-3 p-4">
        <h3 className="text-sm font-medium">{t.chartByDay}</h3>
        <ChartContainer config={dayConfig} className="h-[240px] w-full">
          <AreaChart data={byDay} margin={{ left: 4, right: 4, top: 4 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
              tickFormatter={(v: string) => v.slice(5)}
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
            />
            <Area
              dataKey="output"
              type="monotone"
              stackId="a"
              stroke={OUTPUT_COLOR}
              fill="url(#fillOutput)"
            />
            <ChartLegend content={<ChartLegendContent />} />
          </AreaChart>
        </ChartContainer>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Cost by day */}
        {hasCostByDay ? (
          <Card className="gap-3 p-4">
            <h3 className="text-sm font-medium">{t.chartCostByDay}</h3>
            <ChartContainer config={costConfig} className="h-[220px] w-full">
              <BarChart data={byDay} margin={{ left: 4, right: 4, top: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={24}
                  tickFormatter={(v: string) => v.slice(5)}
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
          </Card>
        ) : null}

        {/* Activity by hour of day */}
        <Card className={`gap-3 p-4${hasCostByDay ? "" : " lg:col-span-2"}`}>
          <div>
            <h3 className="text-sm font-medium">{t.chartByHour}</h3>
            <p className="text-xs text-muted-foreground">{t.chartByHourSub}</p>
          </div>
          <ChartContainer config={hourConfig} className="h-[220px] w-full">
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

      <div className="grid gap-4 lg:grid-cols-2">
        {/* By tool */}
        <Card className="gap-3 p-4">
          <h3 className="text-sm font-medium">{t.chartBySource}</h3>
          <ChartContainer config={sourceConfig} className="mx-auto aspect-square max-h-[240px]">
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

        {/* By model */}
        <Card className="gap-3 p-4">
          <h3 className="text-sm font-medium">{t.chartByModel}</h3>
          <div className="flex flex-col gap-2.5">
            {topModels.map((m) => {
              const rate = priceForModel(m.model)
              return (
                <div key={m.model} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: modelColor(m.model) }}
                        aria-hidden
                      />
                      <span className="truncate font-medium">{m.model || t.noModel}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatTokens(m.usage.total)}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(3, (m.usage.total / maxModel) * 100)}%`,
                        backgroundColor: modelColor(m.model),
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>
                      {rate
                        ? t.ratePerMillion(formatCost(rate.input), formatCost(rate.output))
                        : ""}
                    </span>
                    <span className="tabular-nums">{m.cost > 0 ? formatCost(m.cost) : ""}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      {/* Top projects */}
      <Card className="gap-3 p-4">
        <h3 className="text-sm font-medium">{t.tableProjects}</h3>
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
            {topProjects.map((p) => (
              <TableRow key={p.project}>
                <TableCell className="max-w-[18rem] truncate font-medium">{p.project}</TableCell>
                <TableCell className="text-right tabular-nums">{p.sessions}</TableCell>
                <TableCell className="text-right tabular-nums">{formatTokens(p.total)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {p.cost > 0 ? formatCost(p.cost) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground">{t.costNote}</p>
      </Card>
    </div>
  )
}
