import {
  buildReport,
  escapeXml,
  formatDelta,
  reportFilename,
  reportToMarkdown,
  reportToSvg,
  type ReportLabels,
} from "./report"
import type { SessionSummary, TokenUsage } from "./types"

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
  startedAt: 0,
  updatedAt: 0,
  path: "p",
  gitBranch: null,
  parentId: null,
  agentName: null,
  durationMs: null,
  ...over,
})

const NOW = new Date(2026, 6, 20, 12).getTime()
const day = (d: number, month = 6) => new Date(2026, month, d, 9).getTime()

const labels: ReportLabels = {
  title: "AI coding spend",
  periodLabel: "July 2026",
  cost: "Cost",
  tokens: "Tokens",
  sessions: "Sessions",
  perSession: "Per session",
  topModels: "Top models",
  vsPrevious: "vs previous",
  estimatedNote: "Includes estimates.",
  unpricedNote: (n) => `${n} unpriced`,
  noActivity: "No sessions yet",
  footer: "Made with agentpack",
  sourceLabel: (s) => ({ claude: "Claude Code", codex: "Codex", opencode: "OpenCode" })[s],
}

describe("formatDelta", () => {
  it("signs positives and renders a dash for no baseline", () => {
    expect(formatDelta(18.4)).toBe("+18%")
    expect(formatDelta(-4.2)).toBe("-4%")
    expect(formatDelta(null)).toBe("—")
  })
})

describe("escapeXml", () => {
  it("escapes every character that would break an attribute or node", () => {
    expect(escapeXml(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f")
  })
})

describe("buildReport", () => {
  it("ranks models by cost and keeps only the top three", () => {
    const data = buildReport({
      sessions: [
        session({
          id: "a",
          model: "claude-haiku-4-5",
          models: ["claude-haiku-4-5"],
          updatedAt: day(10),
        }),
        session({
          id: "b",
          model: "claude-opus-4-8",
          models: ["claude-opus-4-8"],
          updatedAt: day(11),
        }),
        session({
          id: "c",
          model: "claude-sonnet-5",
          models: ["claude-sonnet-5"],
          updatedAt: day(12),
        }),
        session({
          id: "d",
          model: "claude-3-haiku",
          models: ["claude-3-haiku"],
          updatedAt: day(13),
        }),
      ],
      now: NOW,
    })
    expect(data.topModels).toHaveLength(3)
    expect(data.topModels[0].model).toBe("claude-opus-4-8")
    expect(data.topModels[0].cost).toBeGreaterThan(data.topModels[1].cost)
  })

  it("carries a zero-filled daily series for the window", () => {
    const data = buildReport({ sessions: [session({ updatedAt: day(10) })], now: NOW })
    // Month-to-date on the 20th.
    expect(data.daily).toHaveLength(20)
    expect(data.daily[0].day).toBe("2026-07-01")
  })
})

describe("reportToMarkdown", () => {
  it("renders headline figures and the per-source split", () => {
    const data = buildReport({
      sessions: [
        session({ id: "a", updatedAt: day(10) }),
        session({ id: "b", source: "opencode", cost: 4.5, updatedAt: day(11) }),
      ],
      now: NOW,
    })
    const md = reportToMarkdown(data, labels)
    expect(md).toContain("# AI coding spend")
    expect(md).toContain("**Cost**")
    expect(md).toContain("**OpenCode**")
    expect(md).toContain("Made with agentpack")
  })

  it("states the estimate caveat whenever any cost was estimated", () => {
    const data = buildReport({ sessions: [session({ updatedAt: day(10) })], now: NOW })
    expect(reportToMarkdown(data, labels)).toContain("Includes estimates.")
  })

  it("names how many transcripts went unpriced", () => {
    const data = buildReport({
      sessions: [
        session({ model: "mystery-model", models: ["mystery-model"], updatedAt: day(10) }),
      ],
      now: NOW,
    })
    expect(reportToMarkdown(data, labels)).toContain("1 unpriced")
  })

  it("falls back to the empty-state copy with no history", () => {
    const data = buildReport({ sessions: [], now: NOW })
    const md = reportToMarkdown(data, labels)
    expect(md).toContain("No sessions yet")
    expect(md).not.toContain("**Cost**")
  })
})

describe("reportToSvg", () => {
  const data = buildReport({
    sessions: [
      session({ id: "a", updatedAt: day(10) }),
      session({ id: "b", source: "opencode", cost: 4.5, updatedAt: day(18) }),
    ],
    now: NOW,
  })

  it("is a self-contained SVG with no external reference", () => {
    const svg = reportToSvg(data, labels)
    expect(svg.startsWith("<svg")).toBe(true)
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    // A card that fetches anything cannot be drawn onto a canvas, and the app's
    // CSP would block it regardless.
    expect(svg).not.toMatch(/<image|href=|@import|url\(/)
  })

  it("shows the headline cost and the source chips", () => {
    const svg = reportToSvg(data, labels)
    expect(svg).toContain("Claude Code")
    expect(svg).toContain("OpenCode")
    expect(svg).toContain("agentpack")
  })

  it("escapes label text rather than injecting it raw", () => {
    const svg = reportToSvg(data, { ...labels, title: 'Cost <script>"&' })
    expect(svg).toContain("Cost &lt;script&gt;&quot;&amp;")
    expect(svg).not.toContain("<script>")
  })

  it("renders the empty state instead of a misleading $0.00", () => {
    const empty = buildReport({ sessions: [], now: NOW })
    const svg = reportToSvg(empty, labels)
    expect(svg).toContain("No sessions yet")
    expect(svg).not.toContain("$0.00")
  })

  it("draws one bar per active day and none for idle days", () => {
    const svg = reportToSvg(data, labels)
    // Two sessions on two distinct days inside the window.
    expect(svg.match(/<rect [^>]*fill="#38bdf8" opacity/g) ?? []).toHaveLength(2)
  })
})

describe("reportFilename", () => {
  it("stamps a month range with year-month and sorts chronologically", () => {
    const data = buildReport({ sessions: [], now: NOW })
    expect(reportFilename(data, "png")).toBe("agentpack-usage-2026-07.png")
  })

  it("stamps a shorter range down to the day", () => {
    const data = buildReport({ sessions: [], now: NOW, preset: "7d" })
    expect(reportFilename(data, "svg")).toBe("agentpack-usage-2026-07-20.svg")
  })
})
