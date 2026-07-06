jest.mock("@/lib/tauri/commands", () => ({
  historyGetSession: jest.fn(),
}))

import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { historyGetSession } from "@/lib/tauri/commands"
import type { SessionDetail, SessionSummary, TokenUsage } from "@/lib/history/types"
import { SessionBrowser } from "./session-browser"

const usage = (over: Partial<TokenUsage> = {}): TokenUsage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  total: 0,
  ...over,
})

const session = (over: Partial<SessionSummary>): SessionSummary => ({
  id: "s",
  source: "claude",
  title: "t",
  cwd: "/proj",
  projectName: "proj",
  model: "claude-opus-4-8",
  models: ["claude-opus-4-8"],
  messageCount: 3,
  usage: usage({ total: 100 }),
  cost: null,
  startedAt: 0,
  updatedAt: 1000,
  path: "p",
  gitBranch: null,
  ...over,
})

const h = en.history
const mockedGet = historyGetSession as jest.Mock

function renderBrowser(sessions: SessionSummary[]) {
  return render(
    <I18nProvider>
      <SessionBrowser sessions={sessions} />
    </I18nProvider>
  )
}

describe("SessionBrowser", () => {
  it("shows the empty state with no sessions", () => {
    renderBrowser([])
    expect(screen.getByText(h.empty)).toBeInTheDocument()
    expect(screen.getByText(h.emptyHint)).toBeInTheDocument()
  })

  it("filters by source via the filter chips", async () => {
    const user = userEvent.setup()
    renderBrowser([
      session({ id: "a", source: "claude", title: "Claude one" }),
      session({ id: "b", source: "codex", title: "Codex one" }),
    ])
    expect(screen.getByText("Claude one")).toBeInTheDocument()
    expect(screen.getByText("Codex one")).toBeInTheDocument()

    // The chip's accessible name is "<label> <count>" ("Codex 1"), which the
    // session card ("Codex one …") never matches.
    await user.click(screen.getByRole("button", { name: /^Codex 1$/ }))
    expect(screen.queryByText("Claude one")).not.toBeInTheDocument()
    expect(screen.getByText("Codex one")).toBeInTheDocument()
  })

  it("filters by the search query", async () => {
    const user = userEvent.setup()
    renderBrowser([
      session({ id: "a", title: "Fix commitlint" }),
      session({ id: "b", title: "Add feature" }),
    ])
    await user.type(screen.getByPlaceholderText(h.searchPlaceholder), "commit")
    expect(screen.getByText("Fix commitlint")).toBeInTheDocument()
    expect(screen.queryByText("Add feature")).not.toBeInTheDocument()
  })

  it("shows the filtered-empty state when nothing matches", async () => {
    const user = userEvent.setup()
    renderBrowser([session({ title: "Only one" })])
    await user.type(screen.getByPlaceholderText(h.searchPlaceholder), "zzzz")
    expect(screen.getByText(h.emptyFiltered)).toBeInTheDocument()
  })

  it("opens a transcript dialog and renders fetched messages", async () => {
    const user = userEvent.setup()
    const detail: SessionDetail = {
      summary: session({ title: "Deep dive" }),
      messages: [
        {
          id: "u1",
          role: "user",
          ts: null,
          model: null,
          usage: null,
          parts: [{ kind: "text", text: "please help", name: null, callId: null, isError: null }],
        },
      ],
    }
    mockedGet.mockResolvedValueOnce(detail)
    renderBrowser([session({ title: "Deep dive", source: "codex", path: "r.jsonl" })])

    await user.click(screen.getByText("Deep dive"))
    expect(historyGetSession).toHaveBeenCalledWith("codex", "r.jsonl")

    const dialog = await screen.findByRole("dialog")
    await waitFor(() => expect(within(dialog).getByText("please help")).toBeInTheDocument())
  })

  it("shows a load-failed message when the fetch rejects", async () => {
    const user = userEvent.setup()
    mockedGet.mockRejectedValueOnce(new Error("nope"))
    renderBrowser([session({ title: "Broken" })])
    await user.click(screen.getByText("Broken"))
    const dialog = await screen.findByRole("dialog")
    await waitFor(() => expect(within(dialog).getByText(h.loadFailed)).toBeInTheDocument())
  })
})
