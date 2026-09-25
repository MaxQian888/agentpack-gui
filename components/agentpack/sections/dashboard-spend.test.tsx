import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import {
  WHOLE_SCAN,
  type ListResult,
  type SessionSummary,
  type TokenUsage,
} from "@/lib/history/types"
import { SpendCard, type HistoryFeed } from "./dashboard-spend"

jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))

const s = en.dashboard.spend

const usage = (over: Partial<TokenUsage> = {}): TokenUsage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  total: 0,
  ...over,
})

const session = (over: Partial<SessionSummary> = {}): SessionSummary => ({
  id: "s",
  source: "claude",
  title: "A session",
  cwd: "/proj",
  projectName: "proj",
  model: "claude-opus-4-8",
  models: ["claude-opus-4-8"],
  messageCount: 4,
  usage: usage({ input: 1_000_000, total: 1_000_000 }),
  cost: null,
  startedAt: Date.now(),
  updatedAt: Date.now(),
  path: "p",
  gitBranch: null,
  parentId: null,
  agentName: null,
  durationMs: null,
  ...over,
})

function renderCard(history: HistoryFeed) {
  const onNavigate = jest.fn()
  render(
    <I18nProvider>
      <SpendCard history={history} onNavigate={onNavigate} />
    </I18nProvider>
  )
  return { onNavigate }
}

const scanned = (sessions: SessionSummary[]): ListResult => ({ sessions, errors: [] })

describe("SpendCard states", () => {
  it("shows the scan progress instead of a number while the scan runs", () => {
    renderCard({ data: null, progress: { done: 3, total: 10 } })
    expect(screen.getByText(s.scanning)).toBeInTheDocument()
    expect(screen.getByRole("progressbar")).toBeInTheDocument()
  })

  it("offers a way forward when the scan found no history", async () => {
    const { onNavigate } = renderCard({ data: scanned([]), progress: null })
    expect(screen.getByText(s.empty)).toBeInTheDocument()
    // The empty state must not read as a real $0.00 — that is a different fact.
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: s.emptyAction }))
    expect(onNavigate).toHaveBeenCalledWith("clis")
  })

  it("totals every source and breaks the figure down per CLI", () => {
    renderCard({
      data: scanned([
        // 1M input on Opus 4.8 at $5/M — estimated.
        session({ id: "a" }),
        // Recorded by OpenCode.
        session({ id: "b", source: "opencode", cost: 4.5 }),
      ]),
      progress: null,
    })
    expect(screen.getByText("$9.50")).toBeInTheDocument()
    expect(screen.getByText("$5.00")).toBeInTheDocument()
    expect(screen.getByText("$4.50")).toBeInTheDocument()
    expect(screen.getByText(s.tokens)).toBeInTheDocument()
    expect(screen.getByText(s.sessions)).toBeInTheDocument()
  })

  it("says so when the figure is estimated rather than recorded", () => {
    renderCard({ data: scanned([session()]), progress: null })
    expect(screen.getByText(s.estimated)).toBeInTheDocument()
  })

  it("names transcripts it could not price, so the total reads as a floor", () => {
    renderCard({
      data: scanned([session({ model: "mystery-model", models: ["mystery-model"] })]),
      progress: null,
    })
    expect(screen.getByText(s.unpriced(1))).toBeInTheDocument()
  })

  it("hands off to the usage dashboard", async () => {
    const { onNavigate } = renderCard({ data: scanned([session()]), progress: null })
    await userEvent.click(screen.getByRole("button", { name: s.details }))
    expect(onNavigate).toHaveBeenCalledWith("history")
  })
})

describe("SpendCard honesty about the read", () => {
  it("says the read failed, with a way to read again, instead of 'no sessions yet'", async () => {
    const retry = jest.fn()
    renderCard({
      data: { sessions: [], errors: [{ source: WHOLE_SCAN, message: "disk on fire" }] },
      progress: null,
      retry,
    })
    expect(screen.getByText(s.failed("disk on fire"))).toBeInTheDocument()
    expect(screen.queryByText(s.empty)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: s.retry }))
    expect(retry).toHaveBeenCalled()
  })

  it("marks a total read from only some sources as partial", () => {
    renderCard({
      data: { sessions: [session()], errors: [{ source: "codex", message: "unreadable" }] },
      progress: null,
    })
    expect(screen.getByText(s.partial(1))).toBeInTheDocument()
  })

  it("opens the usage dashboard where the link says it goes", async () => {
    const onOpenUsage = jest.fn()
    const onNavigate = jest.fn()
    render(
      <I18nProvider>
        <SpendCard
          history={{ data: scanned([session()]), progress: null }}
          onNavigate={onNavigate}
          onOpenUsage={onOpenUsage}
        />
      </I18nProvider>
    )
    await userEvent.click(screen.getByRole("button", { name: s.details }))
    expect(onOpenUsage).toHaveBeenCalled()
    expect(onNavigate).not.toHaveBeenCalled()
  })
})
