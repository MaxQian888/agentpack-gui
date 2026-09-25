import { parseLocalDateTimeInput, toLocalDateTimeInput } from "./datetime"

it("round-trips a datetime-local value without drifting by the UTC offset", () => {
  const start = parseLocalDateTimeInput("2026-09-25T08:30")!
  expect(toLocalDateTimeInput(start)).toBe("2026-09-25T08:30")
  // A second pass is where a UTC-formatted value used to move again.
  expect(toLocalDateTimeInput(parseLocalDateTimeInput(toLocalDateTimeInput(start))!)).toBe(
    "2026-09-25T08:30"
  )
})

it("formats with local date parts", () => {
  const seconds = Math.floor(new Date(2026, 0, 5, 7, 4).getTime() / 1000)
  expect(toLocalDateTimeInput(seconds)).toBe("2026-01-05T07:04")
})

it("reads an empty or invalid value as no value rather than NaN", () => {
  expect(parseLocalDateTimeInput("")).toBeNull()
  expect(parseLocalDateTimeInput("not-a-date")).toBeNull()
})
