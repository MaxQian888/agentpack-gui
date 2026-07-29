const mockIsTauri = jest.fn(() => true)
jest.mock("@/lib/tauri", () => ({ isTauri: () => mockIsTauri() }))

const mockSave = jest.fn<Promise<string | null>, unknown[]>()
jest.mock("@tauri-apps/plugin-dialog", () => ({ save: (...a: unknown[]) => mockSave(...a) }), {
  virtual: true,
})

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
import { UsageDashboard } from "./index"
import { session, usage } from "./fixtures"

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

  it("treats a cleared field as 'not set' rather than as zero", async () => {
    const user = userEvent.setup()
    renderDashboard()
    await user.click(screen.getByRole("button", { name: h.subscriptionSetting }))
    const input = await screen.findByLabelText(h.subscriptionLabel)
    await user.type(input, "abc{enter}")
    await waitFor(() =>
      expect(mockSaveSettings).toHaveBeenCalledWith({ monthlySubscriptionUsd: null })
    )
  })
})
