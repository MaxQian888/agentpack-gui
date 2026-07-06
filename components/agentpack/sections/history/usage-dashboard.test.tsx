import { render, screen } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import type { SessionSummary, TokenUsage } from "@/lib/history/types"
import { UsageDashboard } from "./usage-dashboard"

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
  messageCount: 4,
  usage: usage({ input: 100, output: 40, total: 140 }),
  cost: null,
  startedAt: 0,
  updatedAt: Date.UTC(2026, 2, 10, 12),
  path: "p",
  gitBranch: null,
  ...over,
})

function renderDash(sessions: SessionSummary[]) {
  return render(
    <I18nProvider>
      <UsageDashboard sessions={sessions} />
    </I18nProvider>
  )
}

const h = en.history

describe("UsageDashboard", () => {
  it("renders an empty state with no sessions", () => {
    renderDash([])
    expect(screen.getByText(h.usageEmpty)).toBeInTheDocument()
  })

  it("renders headline stat labels and a computed session count", () => {
    renderDash([
      session({ source: "claude", usage: usage({ input: 100, output: 40, total: 140 }) }),
      session({
        source: "opencode",
        model: "deepseek-v4-pro",
        projectName: "disco",
        cost: 0.5,
        usage: usage({ input: 10, output: 5, total: 15 }),
      }),
    ])
    // "Total tokens" is unique to the dashboard (unlike "Sessions"/"Cost",
    // which also appear as a tab / table headers).
    expect(screen.getByText(h.statTokens)).toBeInTheDocument()
    // Real cost from the OpenCode session appears (stat card + project row).
    expect(screen.getAllByText(/\$0\.50/).length).toBeGreaterThan(0)
  })

  it("lists models and projects", () => {
    renderDash([
      session({ model: "claude-opus-4-8", projectName: "alpha", usage: usage({ total: 200 }) }),
      session({
        model: "gpt-5.3-codex",
        source: "codex",
        projectName: "beta",
        usage: usage({ total: 90 }),
      }),
    ])
    // Model bar labels (also appear elsewhere) — at least present.
    expect(screen.getAllByText("claude-opus-4-8").length).toBeGreaterThan(0)
    expect(screen.getAllByText("gpt-5.3-codex").length).toBeGreaterThan(0)
    // Project table rows.
    expect(screen.getByText("alpha")).toBeInTheDocument()
    expect(screen.getByText("beta")).toBeInTheDocument()
    expect(screen.getByText(h.costNote)).toBeInTheDocument()
  })

  it("renders the derived-insight cards and the new cost/activity charts", () => {
    renderDash([
      session({
        source: "claude",
        usage: usage({ input: 100, output: 40, cacheRead: 500, reasoning: 20, total: 660 }),
      }),
      session({ source: "opencode", model: "deepseek-v4-pro", cost: 0.5 }),
    ])
    expect(screen.getByText(h.statCache)).toBeInTheDocument()
    expect(screen.getByText(h.statReasoning)).toBeInTheDocument()
    expect(screen.getByText(h.statAvgTokens)).toBeInTheDocument()
    expect(screen.getByText(h.statAvgCost)).toBeInTheDocument()
    // New charts (cost-by-day renders because a session carries a real cost).
    expect(screen.getByText(h.chartCostByDay)).toBeInTheDocument()
    expect(screen.getByText(h.chartByHour)).toBeInTheDocument()
  })

  it("hides the cost-by-day chart when no session has any cost", () => {
    // A model with no known rate → estimated cost is null → 0 everywhere.
    renderDash([session({ source: "codex", model: "mystery-model", cost: null })])
    expect(screen.queryByText(h.chartCostByDay)).not.toBeInTheDocument()
    // Activity chart still renders.
    expect(screen.getByText(h.chartByHour)).toBeInTheDocument()
  })

  it("labels a model-less session's usage as 'unknown' in the model breakdown", () => {
    renderDash([session({ model: "", models: [], usage: usage({ total: 10 }) })])
    // stats folds an empty model id into the literal "unknown" bucket.
    expect(screen.getByText("unknown")).toBeInTheDocument()
  })

  it("estimates cost from pricing and shows the model rate for a Claude session", () => {
    renderDash([
      session({
        source: "claude",
        model: "claude-opus-4-8",
        cost: null,
        usage: usage({ input: 1e6, output: 1e6, total: 2e6 }),
      }),
    ])
    // 1M input × $5 + 1M output × $25 = $30.00.
    expect(screen.getAllByText("$30.00").length).toBeGreaterThan(0)
    expect(screen.getByText(h.costEstimatedSub("$30.00"))).toBeInTheDocument()
    // The model bar shows the per-1M rate.
    expect(screen.getByText(h.ratePerMillion("$5.00", "$25.00"))).toBeInTheDocument()
  })
})
