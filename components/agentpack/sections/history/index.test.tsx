const mockIsTauri = jest.fn(() => true)
jest.mock("@/lib/tauri", () => ({ isTauri: () => mockIsTauri() }))
jest.mock("@/lib/tauri/commands", () => ({ historyGetSession: jest.fn() }))

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import type { ListResult, SessionSummary } from "@/lib/history/types"
import { HistorySection } from "./index"

const h = en.history

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
  startedAt: 0,
  updatedAt: 1000,
  path: "p",
  gitBranch: null,
  ...over,
})

function renderSection(props: Partial<React.ComponentProps<typeof HistorySection>> = {}) {
  return render(
    <I18nProvider>
      <HistorySection result={null} loading={false} refresh={jest.fn()} {...props} />
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
  })
})
