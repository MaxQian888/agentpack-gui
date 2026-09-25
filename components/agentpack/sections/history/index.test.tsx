const mockIsTauri = jest.fn(() => true)
jest.mock("@/lib/tauri", () => ({ isTauri: () => mockIsTauri() }))
jest.mock("@/lib/tauri/commands", () => ({
  historyGetSession: jest.fn(),
  writeTextFile: jest.fn(),
}))
jest.mock("@/lib/tauri/settings", () => ({
  loadSettings: jest.fn(async () => ({ monthlySubscriptionUsd: null })),
  saveSettings: jest.fn(async () => ({})),
}))

import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { historyGetSession } from "@/lib/tauri/commands"
import { WHOLE_SCAN, type ListResult, type SessionSummary } from "@/lib/history/types"
import { HistorySection } from "./index"

const h = en.history

/** Inside the dashboard's default 30-day window, whenever the suite runs. */
const RECENT = Date.now() - 60_000

const summary = (over: Partial<SessionSummary>): SessionSummary => ({
  id: "s",
  source: "claude",
  title: "Session one",
  cwd: "/proj",
  projectName: "proj",
  model: "claude-opus-4-8",
  models: ["claude-opus-4-8"],
  messageCount: 2,
  usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 15 },
  cost: null,
  startedAt: RECENT,
  updatedAt: RECENT,
  path: "p",
  gitBranch: null,
  parentId: null,
  agentName: null,
  durationMs: null,
  ...over,
})

function renderSection(props: Partial<React.ComponentProps<typeof HistorySection>> = {}) {
  return render(
    <I18nProvider>
      <HistorySection
        result={null}
        loading={false}
        progress={null}
        series={{ data: null, loading: false, request: jest.fn() }}
        refresh={jest.fn()}
        {...props}
      />
    </I18nProvider>
  )
}

beforeEach(() => mockIsTauri.mockReturnValue(true))

describe("HistorySection", () => {
  it("shows the loading spinner while the scan is pending (result null)", () => {
    renderSection({ result: null, loading: true })
    expect(screen.getByText(h.loading)).toBeInTheDocument()
  })

  it("renders sessions and both tabs once loaded", () => {
    const result: ListResult = { sessions: [summary({ title: "Session one" })], errors: [] }
    renderSection({ result })
    expect(screen.getByText("Session one")).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: h.tabSessions })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: h.tabUsage })).toBeInTheDocument()
  })

  it("switches to the Usage tab", async () => {
    const user = userEvent.setup()
    renderSection({ result: { sessions: [summary({})], errors: [] } })
    await user.click(screen.getByRole("tab", { name: h.tabUsage }))
    // "Total tokens" is unique to the dashboard (unlike "Sessions").
    await waitFor(() => expect(screen.getByText(h.statTokens)).toBeInTheDocument())
  })

  it("says the period is empty rather than showing zeroed cards", async () => {
    const user = userEvent.setup()
    // Last touched two years ago: outside the dashboard's default 30-day range.
    const old = Date.now() - 730 * 24 * 3600 * 1000
    renderSection({
      result: { sessions: [summary({ startedAt: old, updatedAt: old })], errors: [] },
    })
    await user.click(screen.getByRole("tab", { name: h.tabUsage }))
    await waitFor(() => expect(screen.getByText(h.rangeEmpty)).toBeInTheDocument())
  })

  it("asks for the usage series the first time the dashboard mounts", async () => {
    const user = userEvent.setup()
    const request = jest.fn()
    renderSection({
      result: { sessions: [summary({})], errors: [] },
      series: { data: null, loading: false, request },
    })
    await user.click(screen.getByRole("tab", { name: h.tabUsage }))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  })

  it("drills down from a project row into the filtered session list", async () => {
    const user = userEvent.setup()
    renderSection({
      result: {
        sessions: [
          summary({ id: "a", title: "Alpha work", projectName: "alpha" }),
          summary({ id: "b", title: "Beta work", projectName: "beta", path: "p2" }),
        ],
        errors: [],
      },
    })
    await user.click(screen.getByRole("tab", { name: h.tabUsage }))
    await waitFor(() => expect(screen.getByText(h.tableProjects)).toBeInTheDocument())
    await user.click(screen.getByRole("cell", { name: "alpha" }))
    // Back on the Sessions tab, filtered to the project that was clicked.
    await waitFor(() => expect(screen.getByText("Alpha work")).toBeInTheDocument())
    expect(screen.queryByText("Beta work")).not.toBeInTheDocument()
  })

  it("shows scan progress instead of a bare spinner while rebuilding", () => {
    renderSection({ result: null, loading: true, progress: { done: 120, total: 3000 } })
    expect(screen.getByText(h.scanProgress(120, 3000))).toBeInTheDocument()
  })

  it("surfaces per-source scan errors", () => {
    renderSection({
      result: { sessions: [], errors: [{ source: "opencode", message: "locked" }] },
    })
    expect(screen.getByText(h.scanError(h.sources.opencode, "locked"))).toBeInTheDocument()
  })

  it("calls refresh when the Rescan button is clicked", async () => {
    const user = userEvent.setup()
    const refresh = jest.fn()
    renderSection({ result: { sessions: [], errors: [] }, refresh })
    await user.click(screen.getByRole("button", { name: h.refresh }))
    expect(refresh).toHaveBeenCalled()
  })

  it("shows the not-desktop message outside Tauri", () => {
    mockIsTauri.mockReturnValue(false)
    renderSection()
    expect(screen.getByText(h.notTauri)).toBeInTheDocument()
    // Disabled for the reason the note gives, not labelled as if scanning.
    expect(screen.getByRole("button", { name: h.refresh })).toBeDisabled()
  })

  // A rejected scan used to arrive as an empty result: "No sessions found" and
  // a band of zeros, on a machine whose history simply couldn't be read.
  it("reports a failed scan as a failure, not as an empty machine", () => {
    renderSection({
      result: { sessions: [], errors: [{ source: WHOLE_SCAN, message: "cache is corrupt" }] },
    })
    expect(screen.getByRole("alert")).toHaveTextContent(h.scanFailed("cache is corrupt"))
    expect(screen.queryByText(h.empty)).not.toBeInTheDocument()
    expect(screen.queryByText(h.statAllSessions)).not.toBeInTheDocument()
    // The way back is right there.
    expect(screen.getByRole("button", { name: h.refresh })).toBeEnabled()
  })

  it("holds Rescan, labelled as busy, while another scan is running", () => {
    renderSection({
      result: { sessions: [summary({})], errors: [] },
      series: { data: null, loading: true, request: jest.fn() },
    })
    const button = screen.getByRole("button", { name: h.refreshing })
    expect(button).toBeDisabled()
  })

  it("shows how far a Rescan has got while the old list stays readable", () => {
    renderSection({
      result: { sessions: [summary({ title: "Session one" })], errors: [] },
      loading: true,
      progress: { done: 5, total: 50 },
    })
    expect(screen.getByText("Session one")).toBeInTheDocument()
    expect(screen.getByText(h.scanProgress(5, 50))).toBeInTheDocument()
  })

  it("keeps the usage period and the session search across tab switches", async () => {
    const user = userEvent.setup()
    renderSection({ result: { sessions: [summary({})], errors: [] } })
    await user.type(screen.getByPlaceholderText(h.searchPlaceholder), "zzz")
    await user.click(screen.getByRole("tab", { name: h.tabUsage }))
    await user.click(await screen.findByRole("button", { name: h.ranges["7d"] }))
    await user.click(screen.getByRole("tab", { name: h.tabSessions }))
    expect(screen.getByPlaceholderText(h.searchPlaceholder)).toHaveValue("zzz")
    await user.click(screen.getByRole("tab", { name: h.tabUsage }))
    expect(screen.getByRole("button", { name: h.ranges["7d"] })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
  })

  it("opens an expensive session's transcript without leaving the Usage tab", async () => {
    const user = userEvent.setup()
    ;(historyGetSession as jest.Mock).mockResolvedValue({
      summary: summary({ id: "kid" }),
      messages: [],
    })
    renderSection({
      result: {
        sessions: [
          summary({ id: "root", title: "Main work", path: "root.jsonl" }),
          // A sub-agent: nested out of the session list, ranked here on its own.
          summary({
            id: "kid",
            title: "Pricey helper",
            agentName: "helper",
            parentId: "root",
            path: "kid.jsonl",
            usage: { input: 5e6, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 5e6 },
          }),
        ],
        errors: [],
      },
    })
    await user.click(screen.getByRole("tab", { name: h.tabUsage }))
    await user.click(await screen.findByRole("tab", { name: h.tabBehaviour }))
    await user.click(await screen.findByRole("button", { name: "Pricey helper" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByRole("button", { name: "helper" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    expect(screen.getByRole("tab", { name: h.tabUsage, hidden: true })).toHaveAttribute(
      "aria-selected",
      "true"
    )
  })
})
