"use client"

import { useState } from "react"
import { CalendarDays } from "lucide-react"
import type { DateRange } from "react-day-picker"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import { customRange, resolveRange, type Granularity, type TimeRange } from "@/lib/history/range"

const PRESETS = ["today", "7d", "30d", "month", "all"] as const

/**
 * Range + granularity control shared by all three usage tabs.
 *
 * Granularity is offered but disabled for `today`, where a single day can only
 * ever be one bucket — showing a live control that changes nothing is worse
 * than showing a disabled one.
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

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onRangeChange(resolveRange(preset))}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              range.preset === preset
                ? "border-primary bg-primary/10 font-medium"
                : "text-muted-foreground hover:bg-accent/50"
            )}
          >
            {t.ranges[preset]}
          </button>
        ))}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
                range.preset === "custom"
                  ? "border-primary bg-primary/10 font-medium"
                  : "text-muted-foreground hover:bg-accent/50"
              )}
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
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Select
          value={granularity}
          onValueChange={(v) => onGranularityChange(v as Granularity)}
          disabled={range.preset === "today"}
        >
          <SelectTrigger className="w-28" aria-label={t.granularityLabel}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="day">{t.granularity.day}</SelectItem>
            <SelectItem value="week">{t.granularity.week}</SelectItem>
            <SelectItem value="month">{t.granularity.month}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

/** Export buttons, kept beside the range so both act on the same selection. */
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
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={onCsv} disabled={disabled}>
        {t.exportCsv}
      </Button>
      <Button variant="outline" size="sm" onClick={onJson} disabled={disabled}>
        {t.exportJson}
      </Button>
    </div>
  )
}
