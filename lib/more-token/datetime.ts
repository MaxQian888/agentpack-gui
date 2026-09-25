/**
 * `<input type="datetime-local">` speaks wall-clock time with no offset, and
 * `new Date("2026-09-25T10:00")` reads such a string as local time. So the value
 * written into the input has to be local too: `toISOString()` is UTC, and a
 * round trip through it moves the range by the UTC offset on every edit.
 */
export function toLocalDateTimeInput(seconds: number): string {
  const date = new Date(seconds * 1000)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

/**
 * The input's value back as unix seconds, or null when it is empty or not a
 * date — clearing one segment of the control yields `""`, and a range built from
 * `NaN` throws the moment anything formats it.
 */
export function parseLocalDateTimeInput(value: string): number | null {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? Math.floor(time / 1000) : null
}
