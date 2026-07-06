import { computeUsageStats, matchesQuery } from "./stats"
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

const session = (over: Partial<SessionSummary>): SessionSummary => ({
  id: "s",
  source: "claude",
  title: "t",
  cwd: "/proj",
  projectName: "proj",
  model: "claude-opus-4-8",
  models: ["claude-opus-4-8"],
  messageCount: 1,
  usage: usage(),
  cost: null,
  startedAt: 0,
  updatedAt: 0,
  path: "p",
  gitBranch: null,
  ...over,
})

// Two clearly-different local days (>48h apart) keep byDay bucketing tz-robust.
const DAY_A = new Date(2026, 2, 10, 12).getTime()
const DAY_B = new Date(2026, 2, 13, 12).getTime()

describe("computeUsageStats", () => {
  it("returns empty scaffolding for no sessions", () => {
    const st = computeUsageStats([])
    expect(st.totals.sessions).toBe(0)
    expect(st.totals.usage.total).toBe(0)
    expect(st.actualCost).toBe(0)
    expect(st.estimatedCost).toBe(0)
    expect(st.bySource).toEqual([])
    expect(st.byModel).toEqual([])
    expect(st.byDay).toEqual([])
    expect(st.byProject).toEqual([])
  })

  it("sums totals across sources, splitting real vs estimated cost", () => {
    const st = computeUsageStats([
      // Claude: no recorded cost → estimated from Opus 4.8 pricing.
      session({
        source: "claude",
        model: "claude-opus-4-8",
        usage: usage({ input: 1e6, output: 1e6, total: 2e6 }),
        messageCount: 3,
      }),
      // OpenCode: real recorded cost.
      session({
        source: "opencode",
        usage: usage({ input: 2, output: 1, total: 3 }),
        cost: 0.25,
        messageCount: 2,
      }),
    ])
    expect(st.totals.sessions).toBe(2)
    expect(st.totals.messages).toBe(5)
    expect(st.totals.usage.total).toBe(2e6 + 3)
    // Real cost from OpenCode.
    expect(st.actualCost).toBeCloseTo(0.25)
    // Estimated from Opus 4.8: 1M input × $5 + 1M output × $25 = $30.
    expect(st.estimatedCost).toBeCloseTo(30)
    expect(st.totals.cost).toBeCloseTo(30.25)
  })

  it("groups by source, sorted by total tokens desc", () => {
    const st = computeUsageStats([
      session({ source: "codex", usage: usage({ total: 5 }) }),
      session({ source: "claude", usage: usage({ total: 20 }) }),
      session({ source: "claude", usage: usage({ total: 10 }) }),
    ])
    expect(st.bySource.map((s) => s.source)).toEqual(["claude", "codex"])
    expect(st.bySource[0].sessions).toBe(2)
    expect(st.bySource[0].usage.total).toBe(30)
  })

  it("attributes usage to the primary model, falling back to 'unknown'", () => {
    const st = computeUsageStats([
      session({ model: "", models: [], usage: usage({ total: 1 }) }),
      session({ model: "gpt-5.3-codex", usage: usage({ total: 7 }) }),
    ])
    const models = st.byModel.map((m) => m.model)
    expect(models).toContain("unknown")
    expect(models).toContain("gpt-5.3-codex")
    expect(st.byModel[0].model).toBe("gpt-5.3-codex")
  })

  it("buckets by local day, sorted ascending", () => {
    const st = computeUsageStats([
      session({ updatedAt: DAY_B, usage: usage({ total: 3, input: 2, output: 1 }) }),
      session({ updatedAt: DAY_A, usage: usage({ total: 5, input: 4, output: 1 }) }),
      session({ updatedAt: DAY_A, usage: usage({ total: 2, input: 1, output: 1 }) }),
    ])
    expect(st.byDay.length).toBe(2)
    expect(st.byDay[0].day < st.byDay[1].day).toBe(true)
    expect(st.byDay[0].total).toBe(7)
    expect(st.byDay[0].input).toBe(5)
  })

  it("groups by project, sorted by total tokens desc", () => {
    const st = computeUsageStats([
      session({ projectName: "a", usage: usage({ total: 3 }), cost: 0.1 }),
      session({ projectName: "b", usage: usage({ total: 9 }) }),
      session({ projectName: "a", usage: usage({ total: 4 }) }),
    ])
    expect(st.byProject[0].project).toBe("b")
    expect(st.byProject[1].project).toBe("a")
    expect(st.byProject[1].sessions).toBe(2)
    expect(st.byProject[1].total).toBe(7)
  })
})

describe("matchesQuery", () => {
  const s = session({
    title: "Fix commitlint",
    projectName: "cognia",
    cwd: "D:/Project/Cognia",
    model: "gpt-5.3-codex",
  })
  it("matches empty query", () => {
    expect(matchesQuery(s, "")).toBe(true)
    expect(matchesQuery(s, "   ")).toBe(true)
  })
  it("matches title / project / cwd / model case-insensitively", () => {
    expect(matchesQuery(s, "COMMITLINT")).toBe(true)
    expect(matchesQuery(s, "cognia")).toBe(true)
    expect(matchesQuery(s, "d:/project")).toBe(true)
    expect(matchesQuery(s, "codex")).toBe(true)
  })
  it("rejects a non-match", () => {
    expect(matchesQuery(s, "zzz")).toBe(false)
  })
})
