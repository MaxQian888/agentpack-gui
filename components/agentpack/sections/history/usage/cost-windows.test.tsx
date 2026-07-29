import { render, screen } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { ALL_TIME } from "@/lib/history/range"
import type { SessionSeries, SessionSummary } from "@/lib/history/types"
import { CostWindowsPanel } from "./cost-windows"
import { buildView } from "./view"
import { ev, series, session, usage } from "./fixtures"

const h = en.history
const day = (d: number, hh = 12) => new Date(2026, 6, d, hh).getTime()
const NOW = day(20, 11)

function renderPanel(opts: {
  sessions?: SessionSummary[]
  series?: SessionSeries[] | null
  subscriptionUsd?: number | null
  now?: number
}) {
  const now = opts.now ?? NOW
  const view = buildView({
    sessions: opts.sessions ?? [session({ updatedAt: day(20) })],
    series: opts.series ?? null,
    range: ALL_TIME,
    granularity: "day",
    now,
  })
  render(
    <I18nProvider>
      <CostWindowsPanel view={view} now={now} subscriptionUsd={opts.subscriptionUsd ?? null} />
    </I18nProvider>
  )
}

describe("CostWindowsPanel — active window", () => {
  it("shows remaining time, burn rate and projection for the live window", () => {
    renderPanel({
      // Window floors to 09:00 and closes at 14:00; `now` is 11:00.
      series: [series({ events: [ev(day(20, 9), 0, 60_000, 0), ev(day(20, 10), 0, 60_000, 0)] })],
    })
    expect(screen.getByText(h.activeBlockTitle)).toBeInTheDocument()
    expect(screen.getByText(h.blockRemaining)).toBeInTheDocument()
    // 120K tokens over the 120 minutes since first activity (09:00 → 11:00),
    // measured from that first message rather than the floored 09:00 start.
    expect(screen.getByText(h.tokensPerMin("1K"))).toBeInTheDocument()
    expect(screen.getByText(h.blockProjected)).toBeInTheDocument()
  })

  it("hides the active card entirely when no window is running", () => {
    renderPanel({ series: [series({ events: [ev(day(1, 9), 0, 100, 10)] })] })
    expect(screen.queryByText(h.activeBlockTitle)).not.toBeInTheDocument()
  })

  it("shows a dash rather than a fabricated rate before any time has elapsed", () => {
    // A window whose only activity is this very instant: dividing by zero
    // elapsed minutes would produce Infinity dressed up as a burn rate.
    const instant = day(20, 9)
    renderPanel({ series: [series({ events: [ev(instant, 0, 100, 10)] })], now: instant })
    expect(screen.getAllByText("—").length).toBeGreaterThan(0)
  })

  it("declines to draw a reference line from too few completed windows", () => {
    renderPanel({ series: [series({ events: [ev(day(20, 9), 0, 100, 10)] })] })
    expect(screen.getByText(h.p90NotEnough)).toBeInTheDocument()
  })

  it("compares against the user's own P90 once there is enough history", () => {
    // Six windows six hours apart, the last one live.
    const start = new Date(2026, 6, 18, 9).getTime()
    const events = Array.from({ length: 6 }, (_, i) => ev(start + i * 6 * 3_600_000, 0, 1000, 0))
    renderPanel({
      series: [series({ events })],
      now: start + 5 * 6 * 3_600_000 + 3_600_000,
    })
    expect(screen.getByText(h.p90Label("1K"))).toBeInTheDocument()
  })
})

describe("CostWindowsPanel — per-model breakdown", () => {
  it("shows each model's rate and estimated cost", () => {
    renderPanel({
      sessions: [
        session({ updatedAt: day(20), usage: usage({ input: 1e6, total: 1e6 }), cost: null }),
      ],
    })
    // Opus 4.8: $5 in / $25 out per 1M.
    expect(screen.getByText(h.ratePerMillion("$5.00", "$25.00"))).toBeInTheDocument()
    expect(screen.getByText("$5.00")).toBeInTheDocument()
  })

  it("names an unidentified model and leaves its rate and cost blank", () => {
    renderPanel({
      sessions: [
        session({
          updatedAt: day(20),
          model: "",
          models: [],
          usage: usage({ total: 10 }),
          cost: null,
        }),
      ],
    })
    // No model id → labelled, but nothing invented for its rate or its cost.
    expect(screen.getAllByText(h.noModel).length).toBeGreaterThan(0)
    expect(screen.queryByText(/per 1M/)).not.toBeInTheDocument()
  })
})

describe("CostWindowsPanel — completed windows", () => {
  it("says the series is still loading rather than claiming there are none", () => {
    renderPanel({ series: null })
    // "No completed windows" would be a claim about data we haven't read yet.
    expect(screen.queryByText(h.blocksEmpty)).not.toBeInTheDocument()
    expect(screen.getAllByText(h.seriesLoading).length).toBeGreaterThan(0)
  })

  it("reports that the table is capped instead of trailing off silently", () => {
    // 70 windows, 6 hours apart, all finished well before `now`.
    const start = new Date(2026, 5, 1, 9).getTime()
    const events = Array.from({ length: 70 }, (_, i) => ev(start + i * 6 * 3_600_000, 0, 100, 10))
    renderPanel({ series: [series({ events })] })
    expect(screen.getByText(h.blocksTruncated(60, 70))).toBeInTheDocument()
  })

  it("never claims a percent-of-plan figure", () => {
    renderPanel({ series: [series({ events: [ev(day(20, 9), 0, 100, 10)] })] })
    expect(screen.getByText(h.blocksNoQuotaNote)).toBeInTheDocument()
  })
})

describe("CostWindowsPanel — subscription comparison", () => {
  it("stays hidden until the user supplies what they pay", () => {
    renderPanel({ subscriptionUsd: null })
    expect(screen.queryByText(h.subscriptionTitle)).not.toBeInTheDocument()
  })

  it("shows the API-equivalent multiple once a figure is set", () => {
    renderPanel({
      // 1M input on Opus 4.8 → $5 of metered API usage.
      sessions: [
        session({ updatedAt: day(20), usage: usage({ input: 1e6, total: 1e6 }), cost: null }),
      ],
      subscriptionUsd: 20,
    })
    expect(screen.getByText(h.subscriptionTitle)).toBeInTheDocument()
    expect(screen.getByText("0.3×")).toBeInTheDocument()
  })
})
