"use client"

import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis } from "recharts"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
import { formatCost, formatNumber, formatTokens } from "@/lib/history/format"
import { CHART_SERIES, modelColor } from "@/lib/history/display"
import { bucketLabel } from "@/lib/history/range"
import { isMcpTool, OTHER_MODELS } from "@/lib/history/series"
import { UNKNOWN_MODEL } from "@/lib/history/stats"
import { costBucketLabel } from "@/lib/history/insights"
import { Stat, PanelTitle, EmptyPanel } from "./stat"
import type { UsageView } from "./view"

const HIST_COLOR = CHART_SERIES.histogram

export function BehaviourPanel({
  view,
  onDrilldown,
}: {
  view: UsageView
  onDrilldown: (focus: { query?: string }) => void
}) {
  const t = useT().history
  const {
    tools,
    toolSplit,
    cache,
    costHistogram,
    topSessions,
    branches,
    modelMix,
    granularity,
    seriesReady,
  } = view

  const totalCalls = toolSplit.builtinCalls + toolSplit.mcpCalls
  const topTools = tools.slice(0, 12)
  const maxCalls = Math.max(1, ...topTools.map((x) => x.calls))

  // The mix's `unknown` and `other` bands are keys, not labels — printing them
  // raw would leave English words in the legend whatever the locale.
  const modelLabel = (m: string) =>
    m === UNKNOWN_MODEL ? t.noModel : m === OTHER_MODELS ? t.modelOther : m
  const mixConfig: ChartConfig = Object.fromEntries(
    modelMix.models.map((m) => [m, { label: modelLabel(m), color: modelColor(m) }])
  )
  const histConfig: ChartConfig = { sessions: { label: t.colSessions, color: HIST_COLOR } }
  const histData = costHistogram.buckets.map((b) => ({
    label: costBucketLabel(b),
    sessions: b.sessions,
  }))

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t.statToolCalls} value={formatNumber(totalCalls)} />
        <Stat
          label={t.statMcpShare}
          value={totalCalls > 0 ? `${Math.round((toolSplit.mcpCalls / totalCalls) * 100)}%` : "—"}
          sub={t.mcpVsBuiltin(
            formatNumber(toolSplit.mcpCalls),
            formatNumber(toolSplit.builtinCalls)
          )}
        />
        <Stat
          label={t.statCacheHit}
          value={`${Math.round(cache.hitRate * 100)}%`}
          sub={t.cacheBreakdown(formatTokens(cache.read), formatTokens(cache.fresh))}
        />
        <Stat
          label={t.statCacheSaved}
          value={formatCost(cache.savedUsd)}
          sub={t.cacheSavedNote}
          tone="up-good"
        />
      </div>

      <Card className="gap-3 p-4">
        <PanelTitle title={t.toolsTitle} hint={t.toolsHint} />
        {!seriesReady ? (
          <EmptyPanel message={t.seriesLoading} />
        ) : topTools.length === 0 ? (
          <EmptyPanel message={t.toolsEmpty} />
        ) : (
          <div className="flex flex-col gap-2.5">
            {topTools.map((tool) => {
              const errorRate = tool.calls > 0 ? tool.errors / tool.calls : 0
              return (
                <div key={tool.name} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-medium">{shortToolName(tool.name)}</span>
                      {isMcpTool(tool.name) ? (
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          MCP
                        </Badge>
                      ) : null}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatNumber(tool.calls)}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${Math.max(2, (tool.calls / maxCalls) * 100)}%` }}
                    />
                  </div>
                  {tool.errors > 0 ? (
                    <div
                      className={cn(
                        "text-[11px] tabular-nums",
                        errorRate > 0.2 ? "text-amber-600" : "text-muted-foreground"
                      )}
                    >
                      {t.toolErrors(formatNumber(tool.errors), (errorRate * 100).toFixed(1))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t.toolErrorsCaveat}</p>
      </Card>

      <Card className="gap-3 p-4">
        <PanelTitle title={t.modelMixTitle} hint={t.modelMixHint} />
        {!seriesReady ? (
          <EmptyPanel message={t.seriesLoading} />
        ) : modelMix.buckets.length === 0 ? (
          <EmptyPanel message={t.modelMixEmpty} />
        ) : (
          <ChartContainer config={mixConfig} className="h-[260px] w-full">
            <AreaChart data={modelMix.buckets} margin={{ left: 4, right: 4, top: 4 }}>
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
              {modelMix.models.map((m) => (
                <Area
                  key={m}
                  dataKey={m}
                  type="monotone"
                  stackId="mix"
                  stroke={modelColor(m)}
                  fill={modelColor(m)}
                  fillOpacity={0.35}
                />
              ))}
              <ChartLegend content={<ChartLegendContent />} />
            </AreaChart>
          </ChartContainer>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-3 p-4">
          <PanelTitle title={t.costHistogramTitle} hint={t.costHistogramHint} />
          <ChartContainer config={histConfig} className="h-[220px] w-full">
            <BarChart data={histData} margin={{ left: 4, right: 4, top: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="sessions" fill={HIST_COLOR} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartContainer>
          {costHistogram.unpriced > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t.unpricedExcluded(costHistogram.unpriced)}
            </p>
          ) : null}
        </Card>

        <Card className="gap-3 p-4">
          <PanelTitle title={t.branchesTitle} hint={t.branchesHint} />
          {branches.length === 0 ? (
            <EmptyPanel message={t.branchesEmpty} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.colBranch}</TableHead>
                  <TableHead className="text-right">{t.colSessions}</TableHead>
                  <TableHead className="text-right">{t.colTokens}</TableHead>
                  <TableHead className="text-right">{t.colCost}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {branches.map((b) => (
                  <TableRow key={b.branch}>
                    <TableCell className="max-w-[14rem] truncate font-medium">{b.branch}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.sessions}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTokens(b.tokens)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="flex items-center justify-end gap-1.5">
                        {formatCost(b.cost)}
                        {b.unpricedSessions > 0 ? (
                          <Badge
                            variant="outline"
                            className="shrink-0 text-[10px] text-muted-foreground"
                            title={t.unpricedExcluded(b.unpricedSessions)}
                          >
                            {t.unpricedBadge}
                          </Badge>
                        ) : null}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>

      <Card className="gap-3 p-4">
        <PanelTitle title={t.topSessionsTitle} hint={t.clickToDrill} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.colSession}</TableHead>
              <TableHead>{t.colProject}</TableHead>
              <TableHead className="text-right">{t.colTokens}</TableHead>
              <TableHead className="text-right">{t.colCost}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {topSessions.map((r) => (
              <TableRow
                key={`${r.session.source}:${r.session.path}`}
                className="cursor-pointer"
                onClick={() => onDrilldown({ query: r.session.title })}
              >
                <TableCell className="max-w-[22rem] truncate font-medium">
                  <span className="flex items-center gap-2">
                    <span className="truncate">{r.session.title}</span>
                    {r.outlier ? (
                      <Badge variant="outline" className="shrink-0 text-[10px] text-amber-600">
                        {t.outlierBadge}
                      </Badge>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="max-w-[12rem] truncate text-muted-foreground">
                  {r.session.projectName}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatTokens(r.session.usage.total)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.unpriced ? (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      {t.unpricedBadge}
                    </Badge>
                  ) : (
                    formatCost(r.cost)
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}

/** `mcp__deepwiki__ask_question` → `deepwiki · ask_question`; built-ins unchanged. */
function shortToolName(name: string): string {
  if (!isMcpTool(name)) return name
  const [, server, ...rest] = name.split("__")
  return rest.length > 0 ? `${server} · ${rest.join("__")}` : name
}
