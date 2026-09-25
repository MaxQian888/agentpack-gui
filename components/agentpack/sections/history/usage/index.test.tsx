const mockIsTauri = jest.fn(() => true)
jest.mock("@/lib/tauri", () => ({ isTauri: () => mockIsTauri() }))

// Mock the picker module itself rather than the underlying plugin: `pickSavePath`
// reaches the plugin through `await import(...)`, and resolving that virtual
// module inside the assertion window made these tests the slowest in the suite —
// slow enough that they intermittently blew `waitFor`'s budget under load. There
// is a dedicated suite for lib/tauri/dialog.ts; this one is about the dashboard.
const mockSave = jest.fn<Promise<string | null>, unknown[]>()
jest.mock("@/lib/tauri/dialog", () => ({ pickSavePath: (...a: unknown[]) => mockSave(...a) }))

const mockWrite = jest.fn<Promise<void>, [string, string]>(async () => {})
jest.mock("@/lib/tauri/commands", () => ({
  writeTextFile: (p: string, c: string) => mockWrite(p, c),
}))

const mockSaveSettings = jest.fn<Promise<unknown>, [unknown]>(async () => ({}))
jest.mock("@/lib/tauri/settings", () => ({
  loadSettings: jest.fn(async () => ({ monthlySubscriptionUsd: null })),
  saveSettings: (patch: unknown) => mockSaveSettings(patch),
}))

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { WHOLE_SCAN } from "@/lib/history/types"
import { UsageDashboard } from "./index"
import { series, session, usage } from "./fixtures"

const h = en.history
const RECENT = Date.now() - 60_000

function renderDashboard(over: Partial<React.ComponentProps<typeof UsageDashboard>> = {}) {
  render(
    <I18nProvider>
      <UsageDashboard
        sessions={[
          session({
            updatedAt: RECENT,
            startedAt: RECENT,
            usage: usage({ input: 100, total: 100 }),
          }),
        ]}
        series={null}
        seriesLoading={false}
        requestSeries={jest.fn()}
        onDrilldown={jest.fn()}
        {...over}
      />
    </I18nProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockIsTauri.mockReturnValue(true)
})

describe("UsageDashboard — shell", () => {
  it("says there is nothing to show at all before narrowing by period", () => {
    renderDashboard({ sessions: [] })
    expect(screen.getByText(h.usageEmpty)).toBeInTheDocument()
    // The range chips would be pointless with no history whatsoever.
    expect(screen.queryByRole("button", { name: h.ranges.today })).not.toBeInTheDocument()
  })

  it("offers all three sub-tabs", () => {
    renderDashboard()
    expect(screen.getByRole("tab", { name: h.tabOverview })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: h.tabCost })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: h.tabBehaviour })).toBeInTheDocument()
  })

  it("asks for the series once, not on every re-render", async () => {
    const requestSeries = jest.fn()
    const { rerender } = render(
      <I18nProvider>
        <UsageDashboard
          sessions={[session({ updatedAt: RECENT })]}
          series={null}
          seriesLoading={false}
          requestSeries={requestSeries}
          onDrilldown={jest.fn()}
        />
      </I18nProvider>
    )
    rerender(
      <I18nProvider>
        <UsageDashboard
          sessions={[session({ updatedAt: RECENT })]}
          series={null}
          seriesLoading={false}
          requestSeries={requestSeries}
          onDrilldown={jest.fn()}
        />
      </I18nProvider>
    )
    await waitFor(() => expect(requestSeries).toHaveBeenCalledTimes(1))
  })

  it("does not ask again while a fetch is already in flight", () => {
    const requestSeries = jest.fn()
    renderDashboard({ seriesLoading: true, requestSeries })
    expect(requestSeries).not.toHaveBeenCalled()
  })

  // A Rescan drops the series with the summaries while this stays mounted. A
  // once-only latch never asked again, and the panels read "Loading…" forever.
  it("asks again when a Rescan drops the series it already had", async () => {
    const requestSeries = jest.fn()
    const view = (data: ReturnType<typeof series>[] | null, loading: boolean) => (
      <I18nProvider>
        <UsageDashboard
          sessions={[session({ updatedAt: RECENT })]}
          series={data}
          seriesLoading={loading}
          requestSeries={requestSeries}
          onDrilldown={jest.fn()}
        />
      </I18nProvider>
    )
    const { rerender } = render(view(null, false))
    await waitFor(() => expect(requestSeries).toHaveBeenCalledTimes(1))
    rerender(view([series()], false))
    // The Rescan: summaries re-reading, series gone.
    rerender(view(null, true))
    expect(requestSeries).toHaveBeenCalledTimes(1)
    rerender(view(null, false))
    await waitFor(() => expect(requestSeries).toHaveBeenCalledTimes(2))
  })

  it("surfaces a failed series read instead of loading forever", () => {
    const requestSeries = jest.fn()
    renderDashboard({
      series: [],
      seriesErrors: [{ source: WHOLE_SCAN, message: "database is locked" }],
      requestSeries,
    })
    expect(screen.getByText(h.seriesFailed("database is locked"))).toBeInTheDocument()
    expect(screen.queryByText(h.seriesLoading)).not.toBeInTheDocument()
    // A recorded failure is an answer: nothing asks again in a loop.
    expect(requestSeries).not.toHaveBeenCalled()
  })

  it("shows a per-source series error the same way the list's are shown", () => {
    renderDashboard({
      series: [],
      seriesErrors: [{ source: "codex", message: "permission denied" }],
    })
    expect(screen.getByText(h.scanError(h.sources.codex, "permission denied"))).toBeInTheDocument()
  })

  it("groups Today by day and says why the control is disabled", async () => {
    const user = userEvent.setup()
    renderDashboard()
    await user.click(screen.getByRole("combobox", { name: h.granularityLabel }))
    await user.click(await screen.findByRole("option", { name: h.granularity.week }))
    await user.click(screen.getByRole("button", { name: h.ranges.today }))
    const select = screen.getByRole("combobox", { name: h.granularityLabel })
    expect(select).toBeDisabled()
    expect(select).toHaveTextContent(h.granularity.day)
    expect(screen.getByText(h.granularityDayOnly)).toBeInTheDocument()
  })
})

describe("UsageDashboard — export", () => {
  it("writes CSV to the chosen path", async () => {
    const user = userEvent.setup()
    mockSave.mockResolvedValue("/tmp/usage.csv")
    renderDashboard()
    await user.click(screen.getByRole("button", { name: h.exportCsv }))
    await waitFor(() => expect(mockWrite).toHaveBeenCalled())
    const [path, content] = mockWrite.mock.calls[0]
    expect(path).toBe("/tmp/usage.csv")
    expect(String(content).split("\n")[0]).toBe(
      "period,sessions,input,output,cache_read,cache_write,total_tokens,cost_usd,unpriced_sessions"
    )
  })

  it("writes JSON that parses, carrying the range and the stats", async () => {
    const user = userEvent.setup()
    mockSave.mockResolvedValue("/tmp/usage.json")
    renderDashboard()
    await user.click(screen.getByRole("button", { name: h.exportJson }))
    await waitFor(() => expect(mockWrite).toHaveBeenCalled())
    const parsed = JSON.parse(String(mockWrite.mock.calls[0][1]))
    expect(parsed.range.preset).toBe("30d")
    expect(parsed.granularity).toBe("day")
    expect(parsed.stats.totals.sessions).toBe(1)
  })

  it("writes the series-backed fields as null until the series is in", async () => {
    const user = userEvent.setup()
    mockSave.mockResolvedValue("/tmp/usage.json")
    renderDashboard({ series: null, seriesLoading: true })
    await user.click(screen.getByRole("button", { name: h.exportJson }))
    await waitFor(() => expect(mockWrite).toHaveBeenCalled())
    const parsed = JSON.parse(String(mockWrite.mock.calls[0][1]))
    // Empty lists would claim "no windows, no tool calls" — nothing measured that.
    expect(parsed.blocks).toBeNull()
    expect(parsed.tools).toBeNull()
  })

  it("says where the file went", async () => {
    const user = userEvent.setup()
    mockSave.mockResolvedValue("/tmp/usage.csv")
    renderDashboard()
    await user.click(screen.getByRole("button", { name: h.exportCsv }))
    expect(await screen.findByText(h.report.saved("/tmp/usage.csv"))).toBeInTheDocument()
  })

  it("says the write failed, with the system's reason, instead of nothing", async () => {
    const user = userEvent.setup()
    mockSave.mockResolvedValue("/tmp/usage.csv")
    mockWrite.mockRejectedValueOnce(new Error("read-only file system"))
    renderDashboard()
    await user.click(screen.getByRole("button", { name: h.exportCsv }))
    expect(await screen.findByText(h.exportFailed("read-only file system"))).toBeInTheDocument()
    expect(screen.queryByText(h.report.saved("/tmp/usage.csv"))).not.toBeInTheDocument()
  })

  it("writes nothing when the save dialog is cancelled", async () => {
    const user = userEvent.setup()
    mockSave.mockResolvedValue(null)
    renderDashboard()
    await user.click(screen.getByRole("button", { name: h.exportCsv }))
    await waitFor(() => expect(mockSave).toHaveBeenCalled())
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it("is unavailable in web mode, where there is no filesystem", () => {
    mockIsTauri.mockReturnValue(false)
    renderDashboard()
    expect(screen.getByRole("button", { name: h.exportCsv })).toBeDisabled()
  })
})

describe("UsageDashboard — subscription setting", () => {
  it("persists a figure and reveals the comparison card", async () => {
    const user = userEvent.setup()
    renderDashboard()
    await user.click(screen.getByRole("button", { name: h.subscriptionSetting }))
    const input = await screen.findByLabelText(h.subscriptionLabel)
    await user.type(input, "200{enter}")
    await waitFor(() =>
      expect(mockSaveSettings).toHaveBeenCalledWith({ monthlySubscriptionUsd: 200 })
    )
  })

  it("accepts the way people write dollars: $200, 1,000", async () => {
    const user = userEvent.setup()
    renderDashboard()
    await user.click(screen.getByRole("button", { name: h.subscriptionSetting }))
    const input = await screen.findByLabelText(h.subscriptionLabel)
    await user.type(input, "$1,000{enter}")
    await waitFor(() =>
      expect(mockSaveSettings).toHaveBeenCalledWith({ monthlySubscriptionUsd: 1000 })
    )
  })

  // "abc" used to save null — the comparison card vanished with no word why.
  it("keeps the saved figure and asks for a number when the text isn't one", async () => {
    const user = userEvent.setup()
    renderDashboard()
    await user.click(screen.getByRole("button", { name: h.subscriptionSetting }))
    const input = await screen.findByLabelText(h.subscriptionLabel)
    await user.type(input, "200{enter}")
    await waitFor(() =>
      expect(mockSaveSettings).toHaveBeenCalledWith({ monthlySubscriptionUsd: 200 })
    )
    mockSaveSettings.mockClear()
    await user.clear(input)
    await user.type(input, "two hundred{enter}")
    expect(await screen.findByText(h.subscriptionInvalid)).toBeInTheDocument()
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(mockSaveSettings).not.toHaveBeenCalled()
  })

  it("treats a cleared field as 'not set' rather than as zero", async () => {
    const user = userEvent.setup()
    renderDashboard()
    await user.click(screen.getByRole("button", { name: h.subscriptionSetting }))
    const input = await screen.findByLabelText(h.subscriptionLabel)
    await user.type(input, "200{enter}")
    await waitFor(() =>
      expect(mockSaveSettings).toHaveBeenCalledWith({ monthlySubscriptionUsd: 200 })
    )
    await user.clear(input)
    await user.keyboard("{enter}")
    await waitFor(() =>
      expect(mockSaveSettings).toHaveBeenLastCalledWith({ monthlySubscriptionUsd: null })
    )
    expect(screen.queryByText(h.subscriptionInvalid)).not.toBeInTheDocument()
  })
})
