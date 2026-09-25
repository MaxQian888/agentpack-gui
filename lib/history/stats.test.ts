import { formatCostFigure } from "./format"
import { computeUsageStats, matchesQuery, projectKey, statsCostFigure } from "./stats"
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
  parentId: null,
  agentName: null,
  durationMs: null,
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
    expect(st.unpriced).toEqual({ transcripts: 0, tokens: 0 })
    expect(st.subagents).toEqual({ transcripts: 0, tokens: 0, cost: 0 })
    expect(st.bySource).toEqual([])
    expect(st.byModel).toEqual([])
    expect(st.byDay).toEqual([])
    expect(st.byProject).toEqual([])
    expect(st.averages).toEqual({
      tokensPerSession: 0,
      costPerSession: 0,
      durationPerSession: 0,
    })
    // byHour is always a 24-slot zero-filled scaffold, even with no sessions.
    expect(st.byHour).toHaveLength(24)
    expect(st.byHour.every((h) => h.sessions === 0 && h.total === 0)).toBe(true)
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

  it("classifies Pi's recorded model-price cost as an estimate", () => {
    const st = computeUsageStats([
      session({
        source: "pi",
        model: "custom-model",
        cost: 0.75,
        costBasis: "sourceEstimate",
      }),
    ])
    expect(st.actualCost).toBe(0)
    expect(st.estimatedCost).toBeCloseTo(0.75)
    expect(st.unpriced.transcripts).toBe(0)
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
    expect(st.byModel[0].transcripts).toBe(1)
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

  it("computes per-session averages over total tokens and cost", () => {
    const st = computeUsageStats([
      session({ usage: usage({ total: 100 }), cost: 0.2 }),
      session({ usage: usage({ total: 300 }), cost: 0.6 }),
    ])
    expect(st.averages.tokensPerSession).toBe(200)
    expect(st.averages.costPerSession).toBeCloseTo(0.4)
  })

  it("buckets session activity by local start hour into 24 slots", () => {
    const st = computeUsageStats([
      // Local hour 14, twice.
      session({ startedAt: new Date(2026, 2, 10, 14).getTime(), usage: usage({ total: 5 }) }),
      session({ startedAt: new Date(2026, 2, 11, 14).getTime(), usage: usage({ total: 7 }) }),
      // Local hour 9, once.
      session({ startedAt: new Date(2026, 2, 10, 9).getTime(), usage: usage({ total: 3 }) }),
    ])
    expect(st.byHour).toHaveLength(24)
    expect(st.byHour[14]).toEqual({ hour: 14, sessions: 2, total: 12 })
    expect(st.byHour[9]).toEqual({ hour: 9, sessions: 1, total: 3 })
    expect(st.byHour[0].sessions).toBe(0)
  })
})

describe("computeUsageStats — sub-agent transcripts", () => {
  const parent = session({
    id: "root-1",
    usage: usage({ input: 1e6, total: 1e6 }),
    messageCount: 4,
    durationMs: 90_000,
    startedAt: new Date(2026, 2, 10, 14).getTime(),
    updatedAt: DAY_A,
  })
  const child = session({
    id: "agent-1",
    parentId: "root-1",
    agentName: "Explore",
    model: "claude-haiku-4-5",
    models: ["claude-haiku-4-5"],
    usage: usage({ input: 2e6, total: 2e6 }),
    messageCount: 6,
    // A sub-agent runs *inside* a parent turn, so its wall clock is already in
    // the parent's — counting it again would invent time that never elapsed.
    durationMs: 60_000,
    startedAt: new Date(2026, 2, 10, 14).getTime(),
    updatedAt: DAY_A,
  })

  it("counts sub-agent tokens but not sub-agent sessions", () => {
    const st = computeUsageStats([parent, child])
    expect(st.totals.sessions).toBe(1)
    expect(st.totals.messages).toBe(10)
    expect(st.totals.usage.total).toBe(3e6)
    // $5/M input for Opus 4.8 + $1/M for Haiku 4.5.
    expect(st.totals.cost).toBeCloseTo(5 + 2)
    expect(st.subagents).toEqual({ transcripts: 1, tokens: 2e6, cost: 2 })
    // The average is per top-level session, sub-agent tokens included.
    expect(st.averages.tokensPerSession).toBe(3e6)
  })

  it("keeps the sub-agent's own model visible in the model split", () => {
    const st = computeUsageStats([parent, child])
    const haiku = st.byModel.find((m) => m.model === "claude-haiku-4-5")
    expect(haiku?.usage.total).toBe(2e6)
    expect(haiku?.transcripts).toBe(1)
  })

  it("excludes sub-agent duration, which elapsed inside the parent turn", () => {
    const st = computeUsageStats([parent, child])
    expect(st.totals.durationMs).toBe(90_000)
    expect(st.totals.durationSessions).toBe(1)
  })

  it("counts sub-agent activity once in the hour and project buckets", () => {
    const st = computeUsageStats([parent, child])
    expect(st.byHour[14].sessions).toBe(1)
    expect(st.byHour[14].total).toBe(3e6)
    expect(st.byProject[0].sessions).toBe(1)
    expect(st.byProject[0].total).toBe(3e6)
  })

  it("promotes an orphan whose parent was not scanned", () => {
    const st = computeUsageStats([child])
    expect(st.totals.sessions).toBe(1)
    expect(st.subagents.transcripts).toBe(0)
  })
})

describe("computeUsageStats — unpriced models", () => {
  it("reports an unknown model as unpriced instead of a real $0", () => {
    const st = computeUsageStats([
      session({ model: "some-local-llm", usage: usage({ input: 5e6, total: 5e6 }) }),
      session({ source: "opencode", usage: usage({ total: 1 }), cost: 0.5 }),
    ])
    expect(st.unpriced).toEqual({ transcripts: 1, tokens: 5e6 })
    // The unpriced session contributes nothing to either cost bucket — before,
    // its 0 landed in `actualCost` and read as a genuinely free session.
    expect(st.actualCost).toBeCloseTo(0.5)
    expect(st.estimatedCost).toBe(0)
    expect(st.totals.cost).toBeCloseTo(0.5)
    // …and the headline figure says it is a lower bound.
    expect(formatCostFigure(statsCostFigure(st))).toBe("≥$0.5000")
  })

  it("writes — for a total when no transcript could be priced at all", () => {
    const st = computeUsageStats([session({ model: "some-local-llm", usage: usage({ total: 9 }) })])
    expect(formatCostFigure(statsCostFigure(st))).toBe("—")
    expect(st.byProject[0]).toMatchObject({ transcripts: 1, unpriced: 1 })
  })
})

describe("projectKey", () => {
  it("is the key byProject groups under, including the nameless bucket", () => {
    const st = computeUsageStats([session({ projectName: "" })])
    expect(st.byProject[0].project).toBe(projectKey(session({ projectName: "" })))
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

describe("computeUsageStats — wall-clock duration", () => {
  it("sums durations only over sessions that report one", () => {
    const st = computeUsageStats([
      session({ id: "a", durationMs: 60_000 }),
      session({ id: "b", durationMs: 120_000 }),
      // Codex/OpenCode don't record turn durations — these must not be counted
      // as zero-length sessions, which would halve the average.
      session({ id: "c", source: "codex", durationMs: null }),
      session({ id: "d", source: "opencode", durationMs: 0 }),
    ])
    expect(st.totals.sessions).toBe(4)
    expect(st.totals.durationMs).toBe(180_000)
    expect(st.totals.durationSessions).toBe(2)
    expect(st.averages.durationPerSession).toBe(90_000)
  })

  it("reports zero duration without dividing by zero when no source measures it", () => {
    const st = computeUsageStats([session({ id: "a", durationMs: null })])
    expect(st.totals.durationSessions).toBe(0)
    expect(st.averages.durationPerSession).toBe(0)
  })

  it("attributes duration to the source that recorded it", () => {
    const st = computeUsageStats([
      session({ id: "a", source: "claude", durationMs: 30_000 }),
      session({ id: "b", source: "codex", durationMs: null }),
    ])
    const claude = st.bySource.find((s) => s.source === "claude")
    const codex = st.bySource.find((s) => s.source === "codex")
    expect(claude?.durationMs).toBe(30_000)
    expect(codex?.durationMs).toBe(0)
    expect(codex?.durationSessions).toBe(0)
  })
})
