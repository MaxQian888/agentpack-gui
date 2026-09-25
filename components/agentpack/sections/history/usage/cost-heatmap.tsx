"use client"

import { useMemo, useState } from "react"
import {
  CalendarHeatmap,
  CalendarHeatmapBlock,
  CalendarHeatmapBody,
  CalendarHeatmapFooter,
  CalendarHeatmapLegend,
  CalendarHeatmapStat,
  type Activity,
} from "@/components/ui/calendar-heatmap"
import { useLocale, useT } from "@/lib/i18n/provider"
import { dayKey, formatCost } from "@/lib/history/format"
import { CHART_SERIES } from "@/lib/history/display"
import type { PeriodBucket } from "@/lib/history/insights"

const COST_COLOR = CHART_SERIES.cost

/** One "no usage" step plus four shades — the plan's five-level scale. */
const LEVELS = 5

/** Monday, matching `startOfWeek` in `lib/history/range.ts`. */
const WEEK_STARTS_MONDAY = 1

/**
 * A bucket key back into a `Date`.
 *
 * Built field by field rather than `new Date(key)`, which parses a bare
 * `YYYY-MM-DD` as **UTC** midnight: west of Greenwich that renders as the
 * previous day, so every cell in the heatmap would be labelled one day early.
 * The keys are local calendar days (see `bucketKey`), so they have to be read
 * back as local ones.
 */
function localDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(y, m - 1, d)
}

/**
 * Days each arrow key moves by. Weeks are the columns and weekdays the rows,
 * so left/right step a week and up/down a day — the way the grid reads.
 */
const ARROW_STEP: Record<string, number> = {
  ArrowLeft: -7,
  ArrowRight: 7,
  ArrowUp: -1,
  ArrowDown: 1,
}

/**
 * Daily cost as a GitHub-style contribution calendar.
 *
 * The alternative rendering of the same `dailyBuckets` the bar chart draws:
 * a bar chart answers "how much on the 14th", a heatmap answers "which stretches
 * were expensive" — over 90 days the second question is the one a reader
 * actually has, which is why this is the default view.
 *
 * Cells are focusable and report into a shared readout line, so the figure a
 * mouse gets on hover is the same one a keyboard gets on focus. The grid is one
 * tab stop, not one per day: a 90-day range was ninety Tab presses between the
 * toggle above it and whatever came after. Tab lands on one cell (the most
 * recent until the user moves), and the arrow keys walk the grid from there.
 */
export function CostHeatmap({ buckets }: { buckets: PeriodBucket[] }) {
  const t = useT().history
  const { lang } = useLocale()
  const [active, setActive] = useState<string | null>(null)
  // The one cell in the tab order. Kept only while it is still in the range,
  // so a range change can't leave the grid with no tab stop at all.
  const [rovingKey, setRovingKey] = useState<string | null>(null)

  const data = useMemo<Activity[]>(
    () => buckets.map((b) => ({ date: b.key, value: b.cost })),
    [buckets]
  )

  // Month and weekday names come from `Intl` under the app's own language rather
  // than from the catalog: 19 hand-translated names per locale is 19 chances to
  // drift, and the platform already has them.
  const labels = useMemo(() => {
    const month = new Intl.DateTimeFormat(lang, { month: "short" })
    const weekday = new Intl.DateTimeFormat(lang, { weekday: "short" })
    return {
      months: Array.from({ length: 12 }, (_, i) => month.format(new Date(2000, i, 1))),
      // Jan 2 2000 was a Sunday, and the primitive indexes weekdays from Sunday
      // before rotating them by `weekStart` itself.
      weekdays: Array.from({ length: 7 }, (_, i) => weekday.format(new Date(2000, 0, 2 + i))),
      heatmapLabel: t.heatmapLabel,
      legendLabel: t.heatmapLegendLabel,
      legendLevelLabel: t.heatmapLegendLevel,
    }
  }, [lang, t])

  const dayLabel = (key: string) => localDate(key).toLocaleDateString(lang, { dateStyle: "medium" })
  const cellLabel = (key: string, cost: number) =>
    cost > 0 ? t.heatmapCell(dayLabel(key), formatCost(cost)) : t.heatmapCellEmpty(dayLabel(key))

  const tabStop =
    rovingKey != null && buckets.some((b) => b.key === rovingKey)
      ? rovingKey
      : (buckets.at(-1)?.key ?? null)

  const onGridKey = (event: React.KeyboardEvent<SVGRectElement>, key: string) => {
    const d = localDate(key)
    let target: string | null = null
    if (event.key in ARROW_STEP) {
      target = dayKey(
        new Date(d.getFullYear(), d.getMonth(), d.getDate() + ARROW_STEP[event.key]).getTime()
      )
    } else if (event.key === "Home") {
      target = buckets[0]?.key ?? null
    } else if (event.key === "End") {
      target = buckets.at(-1)?.key ?? null
    } else {
      return
    }
    // Arrows would otherwise scroll the page (or the grid's own scroller).
    event.preventDefault()
    const cell = event.currentTarget
      .closest("[data-slot=calendar-heatmap-body]")
      ?.querySelector<SVGRectElement>(`[data-slot=calendar-heatmap-block][data-date="${target}"]`)
    if (!cell) return // past either end of the range
    setRovingKey(target)
    cell.focus()
  }

  const activeBucket = active == null ? null : buckets.find((b) => b.key === active)
  const activeDays = buckets.filter((b) => b.cost > 0).length
  const total = buckets.reduce((sum, b) => sum + b.cost, 0)

  return (
    <CalendarHeatmap
      data={data}
      labels={labels}
      levels={LEVELS}
      weekStart={WEEK_STARTS_MONDAY}
      blockSize={13}
      colors={{ scale: COST_COLOR }}
      emptyState={<p className="py-4 text-sm text-muted-foreground">{t.rangeEmpty}</p>}
      // The primitive pads itself for standalone use; the Card already does.
      className="p-0"
    >
      {/* `CalendarHeatmapBody` already scrolls itself horizontally, which is what
          keeps a multi-year "All time" grid from widening the page. */}
      <CalendarHeatmapBody hideYearLabels>
        {({ activity, dayIndex, weekIndex }) => (
          <CalendarHeatmapBlock
            activity={activity}
            dayIndex={dayIndex}
            weekIndex={weekIndex}
            highlighted={active === activity.date}
            // The primitive only makes a cell tabbable when it is given a click
            // handler. There is nothing to click here, but a keyboard user still
            // has to be able to reach the value — through one stop, roved.
            tabIndex={activity.date === tabStop ? 0 : -1}
            aria-label={cellLabel(activity.date, activity.value)}
            onCellHover={(a) => setActive(a?.date ?? null)}
            onFocus={() => {
              setActive(activity.date)
              setRovingKey(activity.date)
            }}
            onBlur={() => setActive(null)}
            onKeyDown={(event) => onGridKey(event, activity.date)}
          />
        )}
      </CalendarHeatmapBody>
      <CalendarHeatmapFooter>
        <CalendarHeatmapStat>
          {() => (
            <div className="text-xs text-muted-foreground tabular-nums">
              {activeBucket
                ? cellLabel(activeBucket.key, activeBucket.cost)
                : t.heatmapStat(formatCost(total), activeDays)}
            </div>
          )}
        </CalendarHeatmapStat>
        <CalendarHeatmapLegend labels={{ less: t.heatmapLess, more: t.heatmapMore }} />
      </CalendarHeatmapFooter>
    </CalendarHeatmap>
  )
}
