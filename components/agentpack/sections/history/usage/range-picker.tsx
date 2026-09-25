"use client"

import { useId, useState } from "react"
import { CalendarDays, Download } from "lucide-react"
import type { DateRange } from "react-day-picker"
import { Button } from "@/components/ui/button"
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useT } from "@/lib/i18n/provider"
import { customRange, resolveRange, type Granularity, type TimeRange } from "@/lib/history/range"
import { scopeChipClass } from "../../filter-bar"

const PRESETS = ["today", "7d", "30d", "90d", "month", "all"] as const

/**
 * Range + granularity control shared by all three usage tabs.
 *
 * Granularity is offered but disabled for `today`, where a single day can only
 * ever be one bucket — showing a live control that changes nothing is worse
 * than showing a disabled one. The caller passes the granularity actually in
 * force (Daily, for today), so the disabled control never claims "Weekly", and
 * the reason sits beside it rather than in a tooltip a disabled control can't
 * raise.
 *
 * The pills are the same chip as the source chips on the Sessions tab
 * (`scopeChipClass`), not a second pill dialect — the two tabs sit one click
 * apart and used to answer "which subset am I looking at?" with two different
 * shapes. Granularity travels with them rather than being pushed to the far
 * edge by an `ml-auto`: it refines the same choice, and the old rule fought the
 * toolbar's own trailing group for the right-hand side.
 */
export function RangePicker({
  range,
  onRangeChange,
  granularity,
  onGranularityChange,
}: {
  range: TimeRange
  onRangeChange: (r: TimeRange) => void
  granularity: Granularity
  onGranularityChange: (g: Granularity) => void
}) {
  const t = useT().history
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange | undefined>()
  const dayOnlyId = useId()
  const dayOnly = range.preset === "today"

  return (
    <>
      <span aria-hidden="true" className="mr-0.5 text-xs text-muted-foreground">
        {t.periodLabel}
      </span>
      {PRESETS.map((preset) => (
        <button
          key={preset}
          type="button"
          aria-pressed={range.preset === preset}
          onClick={() => onRangeChange(resolveRange(preset))}
          className={scopeChipClass(range.preset === preset)}
        >
          {t.ranges[preset]}
        </button>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-pressed={range.preset === "custom"}
            className={scopeChipClass(range.preset === "custom")}
          >
            <CalendarDays className="size-3.5" />
            {range.preset === "custom" && range.from != null && range.to != null
              ? t.customRangeLabel(
                  new Date(range.from).toLocaleDateString(),
                  // `to` is exclusive; show the last day the user actually picked.
                  new Date(range.to - 1).toLocaleDateString()
                )
              : t.ranges.custom}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          {/* Applied on an explicit Apply, never on selection. The picker
                reports the very first click as `{from: X, to: X}`, so
                auto-applying on "both ends set" would collapse every custom
                range to a single day and close before a second day could be
                picked. Confirming also makes a deliberate one-day range
                expressible. */}
          <Calendar mode="range" autoFocus selected={draft} onSelect={setDraft} />
          <div className="border-t p-2">
            <Button
              size="sm"
              className="w-full"
              disabled={!draft?.from}
              onClick={() => {
                if (!draft?.from) return
                const from = draft.from.getTime()
                onRangeChange(customRange(from, (draft.to ?? draft.from).getTime()))
                setOpen(false)
              }}
            >
              {t.applyRange}
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Select
        value={granularity}
        onValueChange={(v) => onGranularityChange(v as Granularity)}
        disabled={dayOnly}
      >
        <SelectTrigger
          size="sm"
          className="w-28"
          aria-label={t.granularityLabel}
          aria-describedby={dayOnly ? dayOnlyId : undefined}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="day">{t.granularity.day}</SelectItem>
          <SelectItem value="week">{t.granularity.week}</SelectItem>
          <SelectItem value="month">{t.granularity.month}</SelectItem>
        </SelectContent>
      </Select>
      {dayOnly ? (
        <span id={dayOnlyId} className="text-xs text-muted-foreground">
          {t.granularityDayOnly}
        </span>
      ) : null}
    </>
  )
}

/**
 * Export, as one control with two formats rather than two loose buttons.
 *
 * Both act on the same selection and differ only in file type, so they are
 * joined and captioned once. Two free-standing outline buttons read as two
 * unrelated actions, which is how "CSV" and "JSON" ended up looking like peers
 * of Share and the subscription setting beside them.
 */
export function ExportButtons({
  onCsv,
  onJson,
  disabled,
}: {
  onCsv: () => void
  onJson: () => void
  disabled: boolean
}) {
  const t = useT().history
  return (
    <ButtonGroup aria-label={t.exportLabel}>
      <ButtonGroupText className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground">
        <Download aria-hidden="true" className="size-3.5" />
        {t.exportLabel}
      </ButtonGroupText>
      <Button variant="outline" size="sm" onClick={onCsv} disabled={disabled}>
        {t.exportCsv}
      </Button>
      <Button variant="outline" size="sm" onClick={onJson} disabled={disabled}>
        {t.exportJson}
      </Button>
    </ButtonGroup>
  )
}
