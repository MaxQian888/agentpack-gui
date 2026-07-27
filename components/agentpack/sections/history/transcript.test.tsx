jest.mock("@/lib/tauri/commands", () => ({
  historyGetPartText: jest.fn(),
}))

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { historyGetPartText } from "@/lib/tauri/commands"
import type { Message, Part, SessionDetail, TokenUsage } from "@/lib/history/types"
import { Transcript } from "./transcript"

const mockedGetPartText = historyGetPartText as jest.MockedFunction<typeof historyGetPartText>

beforeEach(() => {
  mockedGetPartText.mockReset()
})

/** One assistant turn wrapping `parts`, the shape most cases below need. */
const assistantTurn = (parts: Part[]): Message => ({
  id: "a1",
  role: "assistant",
  ts: null,
  model: null,
  usage: null,
  parts,
})

const usage: TokenUsage = {
  input: 100,
  output: 50,
  cacheRead: 10,
  cacheWrite: 0,
  reasoning: 0,
  total: 150,
}

const part = (over: Partial<Part> & Pick<Part, "kind">): Part => ({
  text: "",
  name: null,
  agent: null,
  callId: null,
  isError: null,
  truncated: null,
  fullBytes: null,
  ref: null,
  ...over,
})

const detail = (messages: Message[]): SessionDetail => ({
  summary: {
    id: "s1",
    source: "claude",
    title: "T",
    cwd: "/p",
    projectName: "p",
    model: "claude-opus-4-8",
    models: ["claude-opus-4-8"],
    messageCount: messages.length,
    usage,
    cost: null,
    startedAt: 1,
    updatedAt: 2,
    path: "x.jsonl",
    gitBranch: null,
    parentId: null,
    agentName: null,
    durationMs: null,
  },
  messages,
})

function renderTranscript(d: SessionDetail) {
  return render(
    <I18nProvider>
      <Transcript detail={d} />
    </I18nProvider>
  )
}

const h = en.history

describe("Transcript", () => {
  it("shows an empty note when there are no messages", () => {
    renderTranscript(detail([]))
    expect(screen.getByText(h.transcriptEmpty)).toBeInTheDocument()
  })

  it("renders a user turn and an assistant turn with token badge and model", () => {
    renderTranscript(
      detail([
        {
          id: "u1",
          role: "user",
          ts: Date.UTC(2026, 0, 1, 8, 30),
          model: null,
          parts: [part({ kind: "text", text: "hello" })],
          usage: null,
        },
        {
          id: "a1",
          role: "assistant",
          ts: Date.UTC(2026, 0, 1, 8, 31),
          model: "claude-opus-4-8",
          parts: [part({ kind: "text", text: "hi there" })],
          usage,
        },
      ])
    )
    expect(screen.getByText(h.roleUser)).toBeInTheDocument()
    expect(screen.getByText(h.roleAssistant)).toBeInTheDocument()
    expect(screen.getByText("hello")).toBeInTheDocument()
    expect(screen.getByText("hi there")).toBeInTheDocument()
    expect(screen.getByText("· claude-opus-4-8")).toBeInTheDocument()
    expect(screen.getByText("150")).toBeInTheDocument() // formatTokens(150)
  })

  it("renders every specialized part kind", () => {
    renderTranscript(
      detail([
        {
          id: "a1",
          role: "assistant",
          ts: null,
          model: "gpt-5.3-codex",
          usage: null,
          parts: [
            part({ kind: "thinking", text: "planning ahead" }),
            part({ kind: "toolCall", name: "Read", text: '{"file":"x"}' }),
            part({ kind: "toolResult", text: "ok output" }),
            part({ kind: "toolResult", text: "boom", isError: true }),
            part({ kind: "webSearch", text: "recharts docs" }),
            part({ kind: "patch", text: "src/a.ts" }),
            part({ kind: "image" }),
          ],
        },
      ])
    )
    expect(screen.getByText(h.thinking)).toBeInTheDocument()
    expect(screen.getByText(h.toolCall("Read"))).toBeInTheDocument()
    expect(screen.getByText(h.toolResult)).toBeInTheDocument()
    expect(screen.getByText(h.toolError)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(h.webSearch))).toBeInTheDocument()
    expect(screen.getByText(h.patch)).toBeInTheDocument()
    expect(screen.getByText(h.image)).toBeInTheDocument()
  })

  it("renders a toolCall with empty input as a dash", () => {
    renderTranscript(
      detail([
        {
          id: "a1",
          role: "assistant",
          ts: null,
          model: null,
          usage: null,
          parts: [part({ kind: "toolCall", name: null, text: "" })],
        },
      ])
    )
    expect(screen.getByText(h.toolCall("tool"))).toBeInTheDocument()
    expect(screen.getByText("—")).toBeInTheDocument()
  })

  // The reason Foldable isn't a native <details>: React renders children
  // regardless of `open`, so a collapsed tool result would still put its whole
  // payload (~88% of a big transcript's bytes) in the DOM.
  it("keeps a collapsed payload out of the DOM until it is opened", async () => {
    const user = userEvent.setup()
    renderTranscript(detail([assistantTurn([part({ kind: "toolResult", text: "ok output" })])]))

    expect(screen.queryByText("ok output")).not.toBeInTheDocument()
    await user.click(screen.getByText(h.toolResult))
    expect(screen.getByText("ok output")).toBeInTheDocument()
  })

  it("fetches the full text of a truncated payload on demand", async () => {
    const user = userEvent.setup()
    mockedGetPartText.mockResolvedValueOnce("the whole 40KB output")
    renderTranscript(
      detail([
        assistantTurn([
          part({
            kind: "toolResult",
            text: "prefix only",
            truncated: true,
            fullBytes: 40960,
            ref: "part:a1:0",
          }),
        ]),
      ])
    )

    await user.click(screen.getByText(h.toolResult))
    expect(screen.getByText("prefix only")).toBeInTheDocument()

    await user.click(screen.getByText(h.loadFullText("40.0 KB")))
    expect(mockedGetPartText).toHaveBeenCalledWith("claude", "x.jsonl", "part:a1:0")
    expect(await screen.findByText("the whole 40KB output")).toBeInTheDocument()
    // The affordance is spent — the full text is already on screen.
    expect(screen.queryByText(h.loadFullText("40.0 KB"))).not.toBeInTheDocument()
  })

  it("reports a failed full-text fetch instead of silently showing the prefix", async () => {
    const user = userEvent.setup()
    mockedGetPartText.mockRejectedValueOnce(new Error("gone"))
    renderTranscript(
      detail([
        assistantTurn([
          part({
            kind: "toolResult",
            text: "prefix",
            truncated: true,
            fullBytes: 2048,
            ref: "file:/x",
          }),
        ]),
      ])
    )

    await user.click(screen.getByText(h.toolResult))
    await user.click(screen.getByText(h.loadFullText("2.0 KB")))
    expect(await screen.findByText(h.fullTextFailed)).toBeInTheDocument()
  })

  // Codex writes an inter-agent message into the recipient's transcript, so in
  // the delegating session these carry the sub-agents' actual reports — the only
  // place their work shows up without opening each agent's own transcript.
  it("renders an agent report open, with its author", () => {
    renderTranscript(
      detail([
        assistantTurn([
          part({
            kind: "agentMessage",
            name: "FINAL_ANSWER",
            agent: "/root/pip_i18n",
            text: "Found 3 missing keys.",
          }),
        ]),
      ])
    )
    expect(screen.getByText(h.agentMessage("FINAL_ANSWER", "/root/pip_i18n"))).toBeInTheDocument()
    expect(screen.getByText("Found 3 missing keys.")).toBeInTheDocument()
  })

  it("renders a bodyless task hand-off as a line, not a dead-end disclosure", () => {
    renderTranscript(
      detail([
        assistantTurn([part({ kind: "agentMessage", name: "NEW_TASK", agent: "/root", text: "" })]),
      ])
    )
    // Codex encrypts the hand-off payload, so there is nothing behind a toggle.
    expect(screen.getByText(h.agentMessage("NEW_TASK", "/root"))).toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it("renders sub-agent lifecycle activity as a single line", () => {
    renderTranscript(
      detail([
        assistantTurn([
          part({ kind: "subagentActivity", name: "started", agent: "/root/pip_i18n" }),
        ]),
      ])
    )
    expect(screen.getByText(h.subagentActivity("started", "/root/pip_i18n"))).toBeInTheDocument()
  })

  it("renders a whitelisted attachment as an event", async () => {
    const user = userEvent.setup()
    renderTranscript(
      detail([
        {
          id: "e1",
          role: "system",
          ts: null,
          model: null,
          usage: null,
          parts: [part({ kind: "event", name: "hook_blocking_error", text: "i18n gate failed" })],
        },
      ])
    )
    expect(screen.getByText(h.event("hook_blocking_error"))).toBeInTheDocument()
    await user.click(screen.getByText(h.event("hook_blocking_error")))
    expect(screen.getByText("i18n gate failed")).toBeInTheDocument()
  })
})
