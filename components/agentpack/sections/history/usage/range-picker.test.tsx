import { useState } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { resolveRange, type Granularity, type TimeRange } from "@/lib/history/range"
import { ExportButtons, RangePicker } from "./range-picker"

const h = en.history

/** Drives the picker through real state, the way the dashboard does. */
function Harness({ onChange }: { onChange?: (r: TimeRange) => void }) {
  const [range, setRange] = useState<TimeRange>(() => resolveRange("30d"))
  const [granularity, setGranularity] = useState<Granularity>("day")
  return (
    <I18nProvider>
      <RangePicker
        range={range}
        onRangeChange={(r) => {
          setRange(r)
          onChange?.(r)
        }}
        granularity={granularity}
        onGranularityChange={setGranularity}
      />
    </I18nProvider>
  )
}

/**
 * The clickable day buttons in the open calendar. `react-day-picker` puts the
 * button inside the `gridcell`, so clicking the cell itself does nothing.
 */
async function findDayButtons(): Promise<HTMLElement[]> {
  await screen.findByRole("grid")
  return Array.from(document.querySelectorAll<HTMLElement>("button[data-day]:not([disabled])"))
}

describe("RangePicker", () => {
  it("resolves a preset into concrete bounds", async () => {
    const user = userEvent.setup()
    const onChange = jest.fn()
    render(<Harness onChange={onChange} />)
    await user.click(screen.getByRole("button", { name: h.ranges.today }))
    const range = onChange.mock.calls[0][0] as TimeRange
    expect(range.preset).toBe("today")
    // Ends at tomorrow, so work from a minute ago is inside the range.
    expect(range.to).toBeGreaterThan(Date.now())
  })

  it("offers a 90-day window, the span the cost heatmap is drawn for", async () => {
    const user = userEvent.setup()
    const onChange = jest.fn()
    render(<Harness onChange={onChange} />)
    await user.click(screen.getByRole("button", { name: h.ranges["90d"] }))
    const range = onChange.mock.calls[0][0] as TimeRange
    expect(range.preset).toBe("90d")
    expect(Math.round((range.to! - range.from!) / 86_400_000)).toBe(90)
  })

  it("disables granularity for a single day, where it can change nothing", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(screen.getByRole("combobox", { name: h.granularityLabel })).not.toBeDisabled()
    await user.click(screen.getByRole("button", { name: h.ranges.today }))
    expect(screen.getByRole("combobox", { name: h.granularityLabel })).toBeDisabled()
  })

  it("shows the custom trigger unlabelled until a range is picked", () => {
    render(<Harness />)
    expect(screen.getByRole("button", { name: new RegExp(h.ranges.custom) })).toBeInTheDocument()
  })

  it("does not apply anything until Apply is pressed", async () => {
    const user = userEvent.setup()
    const onChange = jest.fn()
    render(<Harness onChange={onChange} />)
    await user.click(screen.getByRole("button", { name: new RegExp(h.ranges.custom) }))

    // The picker reports the very first click as `{from: X, to: X}`. Applying
    // on that would collapse the range to one day and close the popover before
    // a second day could be picked.
    await user.click((await findDayButtons())[0])
    expect(onChange).not.toHaveBeenCalled()
    await user.click((await findDayButtons())[5])
    expect(onChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: h.applyRange }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const range = onChange.mock.calls[0][0] as TimeRange
    expect(range.preset).toBe("custom")
    // Six days apart, and the interval covers the whole of the last one.
    expect(range.to! - range.from!).toBe(6 * 24 * 3600 * 1000)
  })

  it("keeps Apply disabled until a day has been chosen", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole("button", { name: new RegExp(h.ranges.custom) }))
    expect(await screen.findByRole("button", { name: h.applyRange })).toBeDisabled()
    await user.click((await findDayButtons())[0])
    expect(screen.getByRole("button", { name: h.applyRange })).not.toBeDisabled()
  })

  it("lets a single day be chosen deliberately", async () => {
    const user = userEvent.setup()
    const onChange = jest.fn()
    render(<Harness onChange={onChange} />)
    await user.click(screen.getByRole("button", { name: new RegExp(h.ranges.custom) }))
    await user.click((await findDayButtons())[0])
    await user.click(screen.getByRole("button", { name: h.applyRange }))
    const range = onChange.mock.calls[0][0] as TimeRange
    expect(range.to! - range.from!).toBe(24 * 3600 * 1000)
  })

  it("labels the trigger with the applied range once it is set", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole("button", { name: new RegExp(h.ranges.custom) }))
    await user.click((await findDayButtons())[0])
    await user.click(screen.getByRole("button", { name: h.applyRange }))
    // No longer the bare "Custom" label — it names the two dates.
    expect(
      screen.queryByRole("button", { name: new RegExp(`^${h.ranges.custom}$`) })
    ).not.toBeInTheDocument()
  })
})

describe("ExportButtons", () => {
  it("wires each button to its writer", async () => {
    const user = userEvent.setup()
    const onCsv = jest.fn()
    const onJson = jest.fn()
    render(
      <I18nProvider>
        <ExportButtons onCsv={onCsv} onJson={onJson} disabled={false} />
      </I18nProvider>
    )
    await user.click(screen.getByRole("button", { name: h.exportCsv }))
    await user.click(screen.getByRole("button", { name: h.exportJson }))
    expect(onCsv).toHaveBeenCalledTimes(1)
    expect(onJson).toHaveBeenCalledTimes(1)
  })

  it("is disabled outside the desktop app, where there is nowhere to save", () => {
    render(
      <I18nProvider>
        <ExportButtons onCsv={jest.fn()} onJson={jest.fn()} disabled />
      </I18nProvider>
    )
    expect(screen.getByRole("button", { name: h.exportCsv })).toBeDisabled()
  })
})
