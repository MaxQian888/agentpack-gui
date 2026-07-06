import { render, screen } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import type { Message, Part, SessionDetail, TokenUsage } from "@/lib/history/types"
import { Transcript } from "./transcript"

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
  callId: null,
  isError: null,
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
})
