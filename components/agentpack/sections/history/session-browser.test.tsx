jest.mock("@/lib/tauri/commands", () => ({
  historyGetSession: jest.fn(),
}))

import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { historyGetSession } from "@/lib/tauri/commands"
import { customRange } from "@/lib/history/range"
import type { SessionDetail, SessionSummary, TokenUsage } from "@/lib/history/types"
import { SessionBrowser, type BrowserFocus } from "./session-browser"

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
  parentId: null,
  agentName: null,
  durationMs: null,
  ...over,
})

const h = en.history
const mockedGet = historyGetSession as jest.Mock

function renderBrowser(sessions: SessionSummary[], focus?: BrowserFocus) {
  return render(
    <I18nProvider>
      <SessionBrowser sessions={sessions} focus={focus} />
    </I18nProvider>
  )
}

beforeEach(() => mockedGet.mockReset())

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
          parts: [
            {
              kind: "text",
              text: "please help",
              name: null,
              agent: null,
              callId: null,
              isError: null,
              truncated: null,
              fullBytes: null,
              ref: null,
            },
          ],
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
    // The reason as the system gave it, not just that it failed.
    expect(within(dialog).getByText("nope")).toBeInTheDocument()
  })

  it("retries a failed load in place", async () => {
    const user = userEvent.setup()
    mockedGet.mockRejectedValueOnce(new Error("busy")).mockResolvedValueOnce({
      summary: session({ title: "Flaky" }),
      messages: [],
    })
    renderBrowser([session({ title: "Flaky" })])
    await user.click(screen.getByText("Flaky"))
    const dialog = await screen.findByRole("dialog")
    await user.click(await within(dialog).findByRole("button", { name: h.retry }))
    await waitFor(() => expect(within(dialog).getByText(h.transcriptEmpty)).toBeInTheDocument())
    expect(historyGetSession).toHaveBeenCalledTimes(2)
  })

  it("lists rows as list items whose names carry the whole row", () => {
    renderBrowser([session({ id: "a", title: "Alpha" }), session({ id: "b", title: "Beta" })])
    const list = screen.getByRole("list", { name: h.listPanel })
    expect(within(list).getAllByRole("listitem")).toHaveLength(2)
    // No title-only override: the tool and the size are part of what's read out.
    const row = within(list).getByRole("button", { name: /Alpha/ })
    expect(row).toHaveAccessibleName(expect.stringContaining(h.rowTokens("100")))
  })

  // Sub-agent runs are separate transcripts on disk and outnumber real sessions
  // (~1225 vs 884 on a working machine), so listing them as peers buries the
  // sessions a reader is actually looking for.
  it("nests sub-agent runs under their parent instead of listing them", async () => {
    const user = userEvent.setup()
    renderBrowser([
      session({ id: "parent", title: "Main work", path: "p.jsonl" }),
      session({
        id: "sub1",
        title: "agent-abc",
        agentName: "audit-panel",
        parentId: "parent",
        path: "p/subagents/agent-abc.jsonl",
      }),
    ])

    expect(screen.getByText("Main work")).toBeInTheDocument()
    expect(screen.queryByText("agent-abc")).not.toBeInTheDocument()
    // The parent advertises how many it owns.
    expect(screen.getByText(h.subagents(1))).toBeInTheDocument()
    // The source chip counts top-level sessions, not the nested transcripts.
    expect(screen.getByRole("button", { name: /^Claude Code 1$/ })).toBeInTheDocument()

    mockedGet.mockResolvedValue({ summary: session({ id: "parent" }), messages: [] })
    await user.click(screen.getByText("Main work"))
    const dialog = await screen.findByRole("dialog")
    // Inside the transcript the sub-agent is reachable, labelled by agent name.
    await user.click(within(dialog).getByRole("button", { name: "audit-panel" }))
    await waitFor(() =>
      expect(historyGetSession).toHaveBeenCalledWith("claude", "p/subagents/agent-abc.jsonl")
    )
  })

  it("reopens on the main session, not on the sub-agent last viewed", async () => {
    const user = userEvent.setup()
    mockedGet.mockResolvedValue({ summary: session({ id: "parent" }), messages: [] })
    renderBrowser([
      session({ id: "parent", title: "Main work", path: "p.jsonl" }),
      session({ id: "sub1", title: "agent-abc", agentName: "audit-panel", parentId: "parent" }),
    ])
    await user.click(screen.getByText("Main work"))
    let dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: "audit-panel" }))
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    await user.click(screen.getByText("Main work"))
    dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByRole("button", { name: h.subagentParent })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
  })

  it("keeps an orphaned sub-agent visible when its parent is gone", () => {
    renderBrowser([
      session({ id: "sub1", title: "agent-orphan", parentId: "vanished", path: "o.jsonl" }),
    ])
    // Hiding it would silently drop a transcript that still exists on disk.
    expect(screen.getByText("agent-orphan")).toBeInTheDocument()
  })

  // Codex agents spawn their own agents. Grouping a grandchild under its
  // immediate (already-nested) parent would strand it: only top-level sessions
  // get a card, so nothing would ever open it.
  it("hoists a nested sub-agent's own sub-agent onto the root session", async () => {
    const user = userEvent.setup()
    renderBrowser([
      session({ id: "root", source: "codex", title: "Main work", path: "root.jsonl" }),
      session({
        id: "mid",
        source: "codex",
        title: "research",
        agentName: "research",
        parentId: "root",
        path: "mid.jsonl",
      }),
      session({
        id: "leaf",
        source: "codex",
        title: "official_docs",
        agentName: "official_docs",
        parentId: "mid",
        path: "leaf.jsonl",
      }),
    ])

    expect(screen.getByText(h.subagents(2))).toBeInTheDocument()
    mockedGet.mockResolvedValue({ summary: session({ id: "root" }), messages: [] })
    await user.click(screen.getByText("Main work"))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: "official_docs" }))
    await waitFor(() => expect(historyGetSession).toHaveBeenCalledWith("codex", "leaf.jsonl"))
  })

  describe("drill-downs from the usage tab", () => {
    // A sub-agent ranks among the most expensive sessions on its own cost, but
    // the list nests it out of sight — a title search for it matched nothing.
    it("opens a sub-agent inside its parent's transcript, with its chip selected", async () => {
      mockedGet.mockResolvedValue({ summary: session({ id: "parent" }), messages: [] })
      renderBrowser(
        [
          session({ id: "parent", title: "Main work", path: "drill.jsonl" }),
          session({
            id: "sub1",
            title: "agent-drill",
            agentName: "audit-panel",
            parentId: "parent",
            // Unique to this test: transcripts are cached across tests by path.
            path: "drill/subagents/agent-drill.jsonl",
          }),
        ],
        { session: { source: "claude", path: "drill/subagents/agent-drill.jsonl" }, nonce: 1 }
      )
      const dialog = await screen.findByRole("dialog")
      expect(within(dialog).getByRole("heading", { name: "agent-drill" })).toBeInTheDocument()
      expect(within(dialog).getByRole("button", { name: "audit-panel" })).toHaveAttribute(
        "aria-pressed",
        "true"
      )
      await waitFor(() =>
        expect(historyGetSession).toHaveBeenCalledWith(
          "claude",
          "drill/subagents/agent-drill.jsonl"
        )
      )
    })

    it("filters to exactly the drilled project, as a chip that clears it", async () => {
      const user = userEvent.setup()
      renderBrowser(
        [
          session({ id: "a", title: "Tidy api", projectName: "api" }),
          session({ id: "b", title: "Gateway work", projectName: "api-gateway" }),
          session({ id: "c", title: "Talk about the api", projectName: "docs" }),
        ],
        { project: "api", nonce: 1 }
      )
      // A substring search for "api" matched all three.
      expect(screen.getByText("Tidy api")).toBeInTheDocument()
      expect(screen.queryByText("Gateway work")).not.toBeInTheDocument()
      expect(screen.queryByText("Talk about the api")).not.toBeInTheDocument()

      await user.click(screen.getByRole("button", { name: h.clearFilter(h.projectFilter("api")) }))
      expect(screen.getByText("Gateway work")).toBeInTheDocument()
    })

    it("carries the period the clicked figure was counted over", async () => {
      const user = userEvent.setup()
      const inside = new Date(2026, 6, 5, 12).getTime()
      const outside = new Date(2026, 5, 1, 12).getTime()
      renderBrowser(
        [
          session({ id: "a", title: "July", projectName: "api", updatedAt: inside }),
          session({ id: "b", title: "June", projectName: "api", updatedAt: outside }),
        ],
        {
          project: "api",
          period: {
            range: customRange(new Date(2026, 6, 1).getTime(), new Date(2026, 6, 7).getTime()),
            label: "Jul 1 – Jul 7",
          },
          nonce: 1,
        }
      )
      expect(screen.getByText("July")).toBeInTheDocument()
      expect(screen.queryByText("June")).not.toBeInTheDocument()
      await user.click(
        screen.getByRole("button", { name: h.clearFilter(h.periodFilter("Jul 1 – Jul 7")) })
      )
      expect(screen.getByText("June")).toBeInTheDocument()
    })
  })
})
