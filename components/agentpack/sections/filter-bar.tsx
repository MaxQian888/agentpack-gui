"use client"

import { Search, SlidersHorizontal, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/**
 * The toolbar over an inventory list, in two tiers.
 *
 * Both managers put every control in one wrapping row — four chips, three
 * `<Select>`s and a search box for the MCP catalog; five chips, two selects and
 * a search box for skills. Ten controls with no ranking is the "杂乱" the
 * redesign is answering: someone opening this for the first time has to read
 * "Transport" and "Authentication" before they can find out what a server is.
 *
 * So the tier that answers "which agent?" — the scope chips, which double as the
 * colour legend for the rows below — stays out in the open, and everything that
 * refines an already-understood list folds into `<MoreFilters>` behind one
 * button that says how many are active.
 */
export function FilterToolbar({
  scope,
  label,
  children,
}: {
  /** The always-visible chip row: scope, and the counts that legend the list. */
  scope: React.ReactNode
  /**
   * Names the chip row for assistive tech, e.g. "Filter by resource". Without
   * it the row is a bare run of toggle buttons with nothing saying what they
   * filter, and a chip that repeats a word used elsewhere on the page (a
   * resource kind that is both a filter and a per-package switch) is
   * indistinguishable from it.
   */
  label?: string
  /** Search plus `<MoreFilters>`, pushed to the trailing edge when there's room. */
  children: React.ReactNode
}) {
  return (
    // `justify-between` rather than `ml-auto` on the trailing group: when the
    // two tiers don't fit on one line, each wrapped line justifies itself, so
    // the search box lands under the chips instead of stranded at the far right.
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div
        role={label ? "group" : undefined}
        aria-label={label}
        className="flex min-w-0 flex-wrap items-center gap-1.5"
      >
        {scope}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

/**
 * The chip's own look, exported so a control that has to build its own trigger
 * — a range pill that opens a calendar popover, say — is the same object as the
 * chips beside it instead of a near-miss with a different radius and ink.
 */
export function scopeChipClass(active: boolean, className?: string) {
  return cn(
    "flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs",
    "transition-colors duration-(--hm-dur-fast) ease-(--hm-ease-out)",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
    active
      ? "border-[var(--hm-accent)] bg-[var(--hm-accent-soft)] font-medium text-[var(--hm-ink)]"
      : "text-muted-foreground hover:bg-muted",
    className
  )
}

/**
 * One scope chip: a coloured dot, a name, and how many rows carry it.
 *
 * The count is what lets this replace the stat strip's per-agent tiles — the
 * number sits on the control that filters by it instead of being restated in a
 * summary line three inches away.
 */
export function ScopeChip({
  active,
  onSelect,
  dot,
  label,
  count,
}: {
  active: boolean
  onSelect: () => void
  /** The source/target dot, omitted by the "All" chip. */
  dot?: React.ReactNode
  label: string
  count?: number
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={scopeChipClass(active)}
    >
      {dot}
      {label}
      {count !== undefined ? (
        <span className={cn("font-mono tabular-nums", !active && "opacity-70")}>{count}</span>
      ) : null}
    </button>
  )
}

/** The search box, sized to its own row rather than to an English placeholder. */
export function SearchField({
  value,
  onChange,
  label,
  className,
}: {
  value: string
  onChange: (value: string) => void
  /** Placeholder and accessible name both — the field carries no visible label. */
  label: string
  className?: string
}) {
  return (
    // Fixed rather than greedy: a growing search box pushed the refinement
    // button onto a line of its own, so a five-chip toolbar spent three rows on
    // what fits in one.
    <div className={cn("relative w-full min-w-0 shrink-0 sm:w-56", className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        placeholder={label}
        className="w-full pl-8"
      />
    </div>
  )
}

/**
 * The refinements, behind one button.
 *
 * `active` is the count of non-default choices inside, shown on the trigger so a
 * folded filter can never silently hide rows — the one real risk of putting
 * controls away. Reset is inside, next to what it resets.
 */
export function MoreFilters({
  label,
  resetLabel,
  active,
  onReset,
  children,
}: {
  label: string
  resetLabel: string
  active: number
  onReset: () => void
  children: React.ReactNode
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="shrink-0 gap-2">
          <SlidersHorizontal className="size-4" />
          {label}
          {active > 0 ? (
            <span className="rounded-(--hm-radius-dot) bg-[var(--hm-accent)] px-1.5 font-mono text-2xs tabular-nums text-[var(--hm-accent-ink)]">
              {active}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <div className="flex flex-col gap-3">
          {children}
          {active > 0 ? (
            <Button variant="ghost" size="sm" className="gap-2 self-start" onClick={onReset}>
              <X className="size-4" />
              {resetLabel}
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * One labelled control inside `<MoreFilters>`.
 *
 * A `<div>` rather than a `<label>`: the controls in here are Radix comboboxes,
 * which are buttons, and a `<label>` names nothing for a button. The visible
 * caption is the eyebrow; the control keeps its own `aria-label`.
 */
export function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span aria-hidden="true" className="text-xs text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  )
}
