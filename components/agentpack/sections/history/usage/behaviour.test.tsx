import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { ALL_TIME } from "@/lib/history/range"
import type { SessionSeries, SessionSummary } from "@/lib/history/types"
import { BehaviourPanel } from "./behaviour"
import { buildView } from "./view"
import { ev, series, session, usage } from "./fixtures"

const h = en.history
const day = (d: number, hh = 12) => new Date(2026, 6, d, hh).getTime()
const NOW = day(20, 11)

function renderPanel(opts: {
  sessions?: SessionSummary[]
  series?: SessionSeries[] | null
  onDrilldown?: jest.Mock
}) {
  const onDrilldown = opts.onDrilldown ?? jest.fn()
  const view = buildView({
    sessions: opts.sessions ?? [session({ updatedAt: day(10) })],
    series: opts.series ?? null,
    range: ALL_TIME,
    granularity: "day",
    now: NOW,
  })
  render(
    <I18nProvider>
      <BehaviourPanel view={view} onDrilldown={onDrilldown} />
    </I18nProvider>
  )
  return { onDrilldown }
}

describe("BehaviourPanel — tools", () => {
  const withTools = () =>
    series({
      events: [ev(day(10), 0, 100, 10)],
      tools: [
        { name: "Read", calls: 10, errors: 3 },
        { name: "mcp__deepwiki__ask_question", calls: 5, errors: 0 },
      ],
    })

  it("ranks tools by calls and shows each one's failure rate", () => {
    renderPanel({ series: [withTools()] })
    expect(screen.getByText("Read")).toBeInTheDocument()
    expect(screen.getByText(h.toolErrors("3", "30.0"))).toBeInTheDocument()
  })

  it("shortens an MCP tool to server · tool and badges its origin", () => {
    renderPanel({ series: [withTools()] })
    expect(screen.getByText("deepwiki · ask_question")).toBeInTheDocument()
    expect(screen.getByText("MCP")).toBeInTheDocument()
    expect(screen.getByText(h.mcpVsBuiltin("5", "10"))).toBeInTheDocument()
  })

  it("keeps the caveat that Codex reports no failures visible", () => {
    renderPanel({ series: [withTools()] })
    expect(screen.getByText(h.toolErrorsCaveat)).toBeInTheDocument()
  })

  it("distinguishes a not-yet-loaded series from a genuinely empty one", () => {
    renderPanel({ series: null })
    expect(screen.queryByText(h.toolsEmpty)).not.toBeInTheDocument()
    renderPanel({ series: [series({ events: [ev(day(10), 0, 1, 1)] })] })
    expect(screen.getByText(h.toolsEmpty)).toBeInTheDocument()
  })
})

describe("BehaviourPanel — cache", () => {
  it("reports the hit rate and what caching saved", () => {
    renderPanel({
      // 1M read from cache, 100K fresh input on Opus 4.8.
      series: [series({ events: [ev(day(10), 0, 100_000, 0, 1_000_000, 0)] })],
    })
    // 1M / (1M + 100K) ≈ 91%.
    expect(screen.getByText("91%")).toBeInTheDocument()
    expect(screen.getByText(h.cacheSavedNote)).toBeInTheDocument()
  })
})

describe("BehaviourPanel — branches", () => {
  it("groups by branch when Claude recorded one", () => {
    renderPanel({
      sessions: [
        session({
          id: "a",
          gitBranch: "feat/usage",
          usage: usage({ total: 10 }),
          updatedAt: day(10),
        }),
      ],
    })
    expect(screen.getByText("feat/usage")).toBeInTheDocument()
  })

  it("says there is no branch data rather than inventing a bucket", () => {
    renderPanel({ sessions: [session({ gitBranch: null, updatedAt: day(10) })] })
    expect(screen.getByText(h.branchesEmpty)).toBeInTheDocument()
  })
})

describe("BehaviourPanel — expensive sessions", () => {
  it("flags a runaway against the set's own P95 and drills into it", async () => {
    const user = userEvent.setup()
    const routine = Array.from({ length: 19 }, (_, i) =>
      session({ id: `c${i}`, path: `p${i}`, source: "opencode", cost: 0.1, updatedAt: day(10) })
    )
    const { onDrilldown } = renderPanel({
      sessions: [
        ...routine,
        session({
          id: "big",
          path: "big",
          title: "Runaway session",
          source: "opencode",
          cost: 50,
          updatedAt: day(10),
        }),
      ],
    })
    expect(screen.getByText(h.outlierBadge)).toBeInTheDocument()
    await user.click(screen.getByText("Runaway session"))
    // By identity: a title search found nothing when the row was a sub-agent.
    expect(onDrilldown).toHaveBeenCalledWith({ session: { source: "opencode", path: "big" } })
  })
})

describe("BehaviourPanel — before the series arrives", () => {
  it("shows — with the reason rather than zeros it never measured", () => {
    renderPanel({ series: null })
    expect(screen.queryByText("0%")).not.toBeInTheDocument()
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument()
    // Four tiles, each saying why it is blank.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4)
    expect(screen.getAllByText(h.seriesLoading).length).toBeGreaterThanOrEqual(4)
  })

  it("says the series is unavailable, not still loading, once the fetch failed", () => {
    const view = buildView({
      sessions: [session({ updatedAt: day(10) })],
      series: null,
      seriesFailed: true,
      range: ALL_TIME,
      granularity: "day",
      now: NOW,
    })
    render(
      <I18nProvider>
        <BehaviourPanel view={view} onDrilldown={jest.fn()} />
      </I18nProvider>
    )
    expect(screen.queryByText(h.seriesLoading)).not.toBeInTheDocument()
    expect(screen.getAllByText(h.seriesUnavailable).length).toBeGreaterThan(0)
  })
})
