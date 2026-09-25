import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { ALL_TIME, resolveRange } from "@/lib/history/range"
import type { SessionSeries, SessionSummary } from "@/lib/history/types"
import { OverviewPanel } from "./overview"
import { buildView } from "./view"
import { session, usage } from "./fixtures"

const h = en.history
const day = (d: number, hh = 12) => new Date(2026, 6, d, hh).getTime()
const NOW = day(20, 10)

function renderPanel(
  sessions: SessionSummary[],
  opts: { series?: SessionSeries[] | null; range?: typeof ALL_TIME; onDrilldown?: jest.Mock } = {}
) {
  const onDrilldown = opts.onDrilldown ?? jest.fn()
  const view = buildView({
    sessions,
    series: opts.series ?? null,
    range: opts.range ?? ALL_TIME,
    granularity: "day",
    now: NOW,
  })
  render(
    <I18nProvider>
      <OverviewPanel view={view} onDrilldown={onDrilldown} />
    </I18nProvider>
  )
  return { onDrilldown }
}

describe("OverviewPanel — cost provenance", () => {
  it("keeps recorded, estimated and unpriced cost apart", () => {
    renderPanel([
      // Recorded by OpenCode.
      session({ id: "a", source: "opencode", cost: 2, usage: usage({ total: 10 }) }),
      // Estimated: 1M input on Opus 4.8 at $5/M.
      session({
        id: "b",
        model: "claude-opus-4-8",
        cost: null,
        usage: usage({ input: 1e6, total: 1e6 }),
      }),
      // No rate at all.
      session({ id: "c", model: "mystery-llm", cost: null, usage: usage({ total: 5e5 }) }),
    ])
    expect(screen.getByText(h.costActual)).toBeInTheDocument()
    expect(screen.getByText("$2.00")).toBeInTheDocument()
    expect(screen.getByText("$5.00")).toBeInTheDocument()
    // The unpriced session is reported as unpriced, never folded in as a real $0.
    expect(screen.getByText(h.unpricedValue(1, "500K"))).toBeInTheDocument()
  })

  it("says so plainly when every model could be priced", () => {
    renderPanel([session({ source: "opencode", cost: 1 })])
    expect(screen.getByText(h.costUnpricedNone)).toBeInTheDocument()
  })
})

describe("OverviewPanel — sub-agent share", () => {
  it("shows the share of tokens spent inside sub-agent runs", () => {
    renderPanel([
      session({ id: "root", usage: usage({ total: 250 }) }),
      session({ id: "kid", parentId: "root", usage: usage({ total: 750 }) }),
    ])
    expect(screen.getByText(h.subagentShare(75, 1))).toBeInTheDocument()
    // …while the session count stays at the one real conversation.
    expect(screen.getByText(h.rootSessionsHint)).toBeInTheDocument()
  })
})

describe("OverviewPanel — wall-clock time", () => {
  it("says how many sessions the duration actually covers", () => {
    renderPanel([
      session({ id: "timed", durationMs: 120_000 }),
      // Codex records no turn durations; counting it as a zero-length session
      // would halve the average.
      session({ id: "untimed", source: "codex", durationMs: null }),
    ])
    expect(screen.getByText(h.statDuration)).toBeInTheDocument()
    expect(screen.getByText(h.durationCoverage(1, 2))).toBeInTheDocument()
    // Total and average coincide here — one session reported a duration, so
    // both cards read 2m. Averaging over both sessions would have said 1m.
    expect(screen.getAllByText("2m")).toHaveLength(2)
  })

  it("hides the time cards entirely when no source measured any", () => {
    renderPanel([session({ source: "codex", durationMs: null })])
    expect(screen.queryByText(h.statDuration)).not.toBeInTheDocument()
  })
})

describe("OverviewPanel — period-over-period", () => {
  it("renders a delta against the previous window", () => {
    render(
      <I18nProvider>
        <OverviewPanel
          view={buildView({
            sessions: [
              session({ id: "now", updatedAt: day(19), usage: usage({ total: 200 }) }),
              session({ id: "prev", updatedAt: day(12), usage: usage({ total: 100 }) }),
            ],
            series: null,
            range: resolveRange("7d", NOW),
            granularity: "day",
            now: NOW,
          })}
          onDrilldown={jest.fn()}
        />
      </I18nProvider>
    )
    // Tokens doubled against the preceding seven days.
    expect(screen.getAllByText("100%").length).toBeGreaterThan(0)
  })

  it("omits the delta entirely for an unbounded range", () => {
    renderPanel([session({ usage: usage({ total: 10 }) })])
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument()
  })
})

describe("OverviewPanel — drill-down", () => {
  it("hands the clicked project back by its exact key, not as a search", async () => {
    const user = userEvent.setup()
    const { onDrilldown } = renderPanel([
      session({ id: "a", projectName: "alpha", usage: usage({ total: 10 }) }),
    ])
    await user.click(screen.getByRole("cell", { name: "alpha" }))
    expect(onDrilldown).toHaveBeenCalledWith({ project: "alpha" })
  })

  it("reaches a project row from the keyboard, firing once per press", async () => {
    const user = userEvent.setup()
    const { onDrilldown } = renderPanel([
      session({ id: "a", projectName: "alpha", usage: usage({ total: 10 }) }),
    ])
    screen.getByRole("button", { name: "alpha" }).focus()
    await user.keyboard("{Enter}")
    expect(onDrilldown).toHaveBeenCalledTimes(1)
    expect(onDrilldown).toHaveBeenCalledWith({ project: "alpha" })
  })

  it("only calls the day chart clickable when it is grouped by day", () => {
    const weekly = buildView({
      sessions: [session({ updatedAt: day(19) })],
      series: null,
      range: resolveRange("30d", NOW),
      granularity: "week",
      now: NOW,
    })
    render(
      <I18nProvider>
        <OverviewPanel view={weekly} onDrilldown={jest.fn()} />
      </I18nProvider>
    )
    expect(screen.queryByText(h.clickDayToDrill)).not.toBeInTheDocument()
  })
})

describe("OverviewPanel — cost figure", () => {
  it("marks an estimated total with ~", () => {
    renderPanel([
      session({ model: "claude-opus-4-8", cost: null, usage: usage({ input: 1e6, total: 1e6 }) }),
    ])
    // The headline tile and the average are the same money, so both say ~.
    expect(screen.getAllByText("~$5.00").length).toBeGreaterThan(0)
  })

  it("says — rather than $0.00 when no model in the period has a rate", () => {
    renderPanel([session({ model: "mystery-llm", cost: null, usage: usage({ total: 5e5 }) })])
    // The provenance card's "Recorded $0.00 / Estimated $0.00" are real sums of
    // nothing; the headline is the figure that must not pretend.
    const tile = screen
      .getByText(h.statCost, { selector: "div" })
      .closest<HTMLElement>("[data-slot=card]")!
    expect(within(tile).getByText("—")).toBeInTheDocument()
    expect(within(tile).getByText(h.unpricedExcluded(1))).toBeInTheDocument()
  })
})
