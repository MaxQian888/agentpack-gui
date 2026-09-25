import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import type { PeriodBucket } from "@/lib/history/insights"
import { CostHeatmap } from "./cost-heatmap"

const h = en.history

const bucket = (key: string, cost: number): PeriodBucket => ({
  key,
  sessions: cost > 0 ? 1 : 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  tokens: 0,
  cost,
  unpricedSessions: 0,
})

/** Five consecutive days, two of them quiet. */
const BUCKETS = [
  bucket("2026-07-13", 2),
  bucket("2026-07-14", 0),
  bucket("2026-07-15", 10),
  bucket("2026-07-16", 0),
  bucket("2026-07-17", 4),
]

function renderHeatmap(buckets: PeriodBucket[] = BUCKETS) {
  render(
    <I18nProvider>
      <CostHeatmap buckets={buckets} />
    </I18nProvider>
  )
}

/** The day cells, in the order the primitive laid them out. */
function cells(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-slot=calendar-heatmap-block]"))
}

const cellFor = (date: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(
    `[data-slot=calendar-heatmap-block][data-date="${date}"]`
  )
  if (!el) throw new Error(`no cell for ${date}`)
  return el
}

describe("CostHeatmap", () => {
  it("draws one cell per day in the range, quiet days included", () => {
    renderHeatmap()
    expect(cells()).toHaveLength(5)
    expect(cellFor("2026-07-14")).toBeInTheDocument()
  })

  it("shades a cell by that day's cost, and leaves a costless day at level zero", () => {
    renderHeatmap()
    // 10 is the maximum, so it takes the top step of the four coloured levels.
    expect(cellFor("2026-07-15")).toHaveAttribute("data-level", "4")
    expect(cellFor("2026-07-13")).toHaveAttribute("data-level", "1")
    expect(cellFor("2026-07-14")).toHaveAttribute("data-level", "0")
  })

  it("names each cell with a localised date and a formatted cost", () => {
    renderHeatmap()
    const date = new Date(2026, 6, 15).toLocaleDateString("en", { dateStyle: "medium" })
    expect(cellFor("2026-07-15")).toHaveAccessibleName(h.heatmapCell(date, "$10.00"))
  })

  it("says a quiet day has no usage rather than reporting it as $0.00", () => {
    renderHeatmap()
    const date = new Date(2026, 6, 14).toLocaleDateString("en", { dateStyle: "medium" })
    expect(cellFor("2026-07-14")).toHaveAccessibleName(h.heatmapCellEmpty(date))
  })

  it("summarises the range until a day is picked out", () => {
    renderHeatmap()
    // Three of the five days carry cost; the other two are not "active".
    expect(screen.getByText(h.heatmapStat("$16.00", 3))).toBeInTheDocument()
  })

  it("reports the hovered day's cost", async () => {
    const user = userEvent.setup()
    renderHeatmap()
    await user.hover(cellFor("2026-07-15"))
    const date = new Date(2026, 6, 15).toLocaleDateString("en", { dateStyle: "medium" })
    expect(screen.getByText(h.heatmapCell(date, "$10.00"))).toBeInTheDocument()
  })

  it("reports the same figure on keyboard focus as on hover", () => {
    renderHeatmap()
    const cell = cellFor("2026-07-17")
    // The primitive only makes a cell tabbable when it is given a click handler,
    // so this asserts the override that puts it back in the tab order.
    expect(cell).toHaveAttribute("tabindex", "0")
    // `focusIn`, not `focus`: React binds `onFocus` to the bubbling `focusin`,
    // and the non-bubbling `focus` event never reaches it.
    fireEvent.focusIn(cell)
    const date = new Date(2026, 6, 17).toLocaleDateString("en", { dateStyle: "medium" })
    expect(screen.getByText(h.heatmapCell(date, "$4.00"))).toBeInTheDocument()
  })

  // One stop per day made a 90-day grid ninety Tab presses long.
  it("puts one cell in the tab order, not every day", () => {
    renderHeatmap()
    const stops = cells().filter((c) => c.getAttribute("tabindex") === "0")
    expect(stops).toHaveLength(1)
    expect(stops[0]).toHaveAttribute("data-date", "2026-07-17")
  })

  it("walks the grid with the arrow keys and keeps one tab stop", async () => {
    const user = userEvent.setup()
    renderHeatmap()
    cellFor("2026-07-17").focus()
    await user.keyboard("{ArrowUp}")
    expect(cellFor("2026-07-16")).toHaveFocus()
    expect(cellFor("2026-07-16")).toHaveAttribute("tabindex", "0")
    expect(cellFor("2026-07-17")).toHaveAttribute("tabindex", "-1")
    await user.keyboard("{Home}")
    expect(cellFor("2026-07-13")).toHaveFocus()
    // A week back is outside the range: focus stays where it was.
    await user.keyboard("{ArrowLeft}")
    expect(cellFor("2026-07-13")).toHaveFocus()
    const date = new Date(2026, 6, 13).toLocaleDateString("en", { dateStyle: "medium" })
    expect(screen.getByText(h.heatmapCell(date, "$2.00"))).toBeInTheDocument()
  })

  it("falls back to the range summary once the pointer leaves", async () => {
    const user = userEvent.setup()
    renderHeatmap()
    await user.hover(cellFor("2026-07-15"))
    await user.unhover(cellFor("2026-07-15"))
    expect(screen.getByText(h.heatmapStat("$16.00", 3))).toBeInTheDocument()
  })

  it("falls back to the range summary once focus leaves", () => {
    renderHeatmap()
    const cell = cellFor("2026-07-17")
    fireEvent.focusIn(cell)
    fireEvent.focusOut(cell)
    expect(screen.getByText(h.heatmapStat("$16.00", 3))).toBeInTheDocument()
  })

  it("labels the grid and its legend for assistive tech", () => {
    renderHeatmap()
    expect(screen.getByRole("img", { name: h.heatmapLabel })).toBeInTheDocument()
    expect(screen.getByRole("group", { name: h.heatmapLegendLabel })).toBeInTheDocument()
    // Five swatches, each named by the interpolated template.
    expect(
      screen.getByRole("img", { name: h.heatmapLegendLevel.replace("{{level}}", "4") })
    ).toBeInTheDocument()
  })

  it("says the range is empty rather than drawing a grid with no cells", () => {
    renderHeatmap([])
    expect(screen.getByText(h.rangeEmpty)).toBeInTheDocument()
    expect(cells()).toHaveLength(0)
  })
})
