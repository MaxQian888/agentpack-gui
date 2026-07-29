import { render, screen } from "@testing-library/react"
import { PanelTitle, EmptyPanel, Stat } from "./stat"

/** The delta's colour class, which is what encodes good/bad/flat. */
function toneOf(label: string): string {
  return screen.getByText(label).closest("span")?.className ?? ""
}

describe("Stat", () => {
  it("renders the value, and the sub-line only when given one", () => {
    const { rerender } = render(<Stat label="Tokens" value="1.2M" sub="1,200,000" />)
    expect(screen.getByText("Tokens")).toBeInTheDocument()
    expect(screen.getByText("1.2M")).toBeInTheDocument()
    expect(screen.getByText("1,200,000")).toBeInTheDocument()
    rerender(<Stat label="Tokens" value="1.2M" />)
    expect(screen.queryByText("1,200,000")).not.toBeInTheDocument()
  })

  it("omits the delta when there is no baseline to compare against", () => {
    // `null` means the previous period was zero — growth from nothing isn't a
    // percentage, and printing one would invent a fact.
    render(<Stat label="Cost" value="$1" delta={null} />)
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument()
  })

  it("omits a delta that isn't a finite number", () => {
    render(<Stat label="Cost" value="$1" delta={Number.POSITIVE_INFINITY} />)
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument()
  })

  it("rounds the delta and drops the sign, which the arrow already carries", () => {
    render(<Stat label="Cost" value="$1" delta={-12.4} />)
    expect(screen.getByText("12%")).toBeInTheDocument()
  })

  it("caps an extreme delta rather than printing a meaningless number", () => {
    render(<Stat label="Cost" value="$1" delta={45000} />)
    expect(screen.getByText("999+%")).toBeInTheDocument()
  })

  it("greys out a change too small to mean anything", () => {
    render(<Stat label="Cost" value="$1" delta={0.2} />)
    expect(toneOf("0%")).toContain("text-muted-foreground")
  })

  it("colours growth green by default and amber where growth is bad", () => {
    const { unmount } = render(<Stat label="Tokens" value="1" delta={30} />)
    expect(toneOf("30%")).toContain("text-emerald-600")
    unmount()

    render(<Stat label="Cost" value="$1" delta={30} tone="up-bad" />)
    expect(toneOf("30%")).toContain("text-amber-600")
  })

  it("inverts the colour for a fall, per tone", () => {
    const { unmount } = render(<Stat label="Tokens" value="1" delta={-30} />)
    expect(toneOf("30%")).toContain("text-amber-600")
    unmount()

    // Cost falling is good news.
    render(<Stat label="Cost" value="$1" delta={-30} tone="up-bad" />)
    expect(toneOf("30%")).toContain("text-emerald-600")
  })
})

describe("PanelTitle", () => {
  it("shows the hint only when there is one", () => {
    const { rerender } = render(<PanelTitle title="Tools" hint="Busiest first." />)
    expect(screen.getByText("Busiest first.")).toBeInTheDocument()
    rerender(<PanelTitle title="Tools" />)
    expect(screen.queryByText("Busiest first.")).not.toBeInTheDocument()
  })
})

describe("EmptyPanel", () => {
  it("renders its message", () => {
    render(<EmptyPanel message="Nothing here." />)
    expect(screen.getByText("Nothing here.")).toBeInTheDocument()
  })
})
