/**
 * Time-range selection and bucketing for the usage dashboard.
 *
 * Everything here works in the **local** calendar: a "day" is the user's day,
 * a week starts on Monday, and a month is a real calendar month. That is what
 * "what did I spend this week" means to the person reading the screen, even
 * though ccusage buckets in UTC.
 */

export type RangePreset = "today" | "7d" | "30d" | "90d" | "month" | "all" | "custom"
export type Granularity = "day" | "week" | "month"

/** A half-open interval `[from, to)` in epoch ms. `null` means unbounded. */
export interface TimeRange {
  preset: RangePreset
  from: number | null
  to: number | null
}

export const ALL_TIME: TimeRange = { preset: "all", from: null, to: null }

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function addDays(ts: number, days: number): number {
  const d = new Date(ts)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

/** Monday 00:00 of the week containing `ts`. */
export function startOfWeek(ts: number): number {
  const d = new Date(startOfDay(ts))
  // getDay(): 0 = Sunday. Shift so Monday is the first day.
  const shift = (d.getDay() + 6) % 7
  return addDays(d.getTime(), -shift)
}

export function startOfMonth(ts: number): number {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

/**
 * Resolve a preset into concrete bounds. `to` is exclusive and always sits at
 * the *end* of the current day, so activity from a few minutes ago is inside
 * the range rather than a day in the future.
 */
export function resolveRange(preset: Exclude<RangePreset, "custom">, now = Date.now()): TimeRange {
  const today = startOfDay(now)
  const tomorrow = addDays(today, 1)
  switch (preset) {
    case "today":
      return { preset, from: today, to: tomorrow }
    case "7d":
      return { preset, from: addDays(today, -6), to: tomorrow }
    case "30d":
      return { preset, from: addDays(today, -29), to: tomorrow }
    case "90d":
      return { preset, from: addDays(today, -89), to: tomorrow }
    case "month":
      return { preset, from: startOfMonth(now), to: tomorrow }
    case "all":
      return ALL_TIME
  }
}

/**
 * A user-picked range, from the first day to the last day inclusive.
 *
 * The ends are ordered here rather than at the call site: a date picker will
 * hand back a reversed pair while the user is re-dragging a selection, and a
 * range with `to` before `from` silently matches nothing.
 */
export function customRange(from: number, to: number): TimeRange {
  const [first, last] = from <= to ? [from, to] : [to, from]
  // The interval is half-open, so include the whole of the last day picked
  // rather than cutting it off at midnight.
  return { preset: "custom", from: startOfDay(first), to: addDays(startOfDay(last), 1) }
}

export function inRange(ts: number, range: TimeRange): boolean {
  if (range.from != null && ts < range.from) return false
  if (range.to != null && ts >= range.to) return false
  return true
}

/**
 * The equally-long window immediately before `range`, for period-over-period
 * comparison. `null` for an unbounded range, which has nothing to compare with.
 */
export function previousRange(range: TimeRange): TimeRange | null {
  if (range.from == null || range.to == null) return null
  const span = range.to - range.from
  if (span <= 0) return null
  return { preset: range.preset, from: range.from - span, to: range.from }
}

/**
 * Relative change from `previous` to `current`, or `null` when there is no
 * meaningful baseline — growth from zero is not "+∞%", it is a new activity,
 * and the UI should say so rather than print a number.
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null
  return ((current - previous) / previous) * 100
}

/** Start of the bucket `ts` belongs to, at the given granularity. */
export function bucketStart(ts: number, granularity: Granularity): number {
  switch (granularity) {
    case "day":
      return startOfDay(ts)
    case "week":
      return startOfWeek(ts)
    case "month":
      return startOfMonth(ts)
  }
}

/** Stable, sortable key for a bucket: `YYYY-MM-DD` of its start instant. */
export function bucketKey(ts: number, granularity: Granularity): string {
  const d = new Date(bucketStart(ts, granularity))
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/**
 * Short axis label for a bucket. Days and weeks read as `MM-DD`; months as
 * `YYYY-MM`, since a month bucket labelled by its first day reads like a day.
 */
export function bucketLabel(key: string, granularity: Granularity): string {
  return granularity === "month" ? key.slice(0, 7) : key.slice(5)
}

/**
 * Every bucket key from `from` to `to` (exclusive), so a chart shows quiet days
 * as gaps at zero instead of silently closing them up. Returns `[]` for an
 * unbounded range, where the caller should use the keys it actually observed.
 */
export function bucketKeysIn(range: TimeRange, granularity: Granularity): string[] {
  if (range.from == null || range.to == null) return []
  const keys: string[] = []
  let cursor = bucketStart(range.from, granularity)
  while (cursor < range.to) {
    keys.push(bucketKey(cursor, granularity))
    const d = new Date(cursor)
    if (granularity === "day") d.setDate(d.getDate() + 1)
    else if (granularity === "week") d.setDate(d.getDate() + 7)
    else d.setMonth(d.getMonth() + 1)
    cursor = d.getTime()
  }
  return keys
}
