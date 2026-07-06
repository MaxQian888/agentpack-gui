import type { SessionDetail, SessionSummary, TokenUsage } from "./types"
import { clearDetailCache, detailCacheKey, getCachedDetail, setCachedDetail } from "./detail-cache"

const usage: TokenUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  total: 0,
}

const detail = (id: string): SessionDetail => ({
  summary: {
    id,
    source: "claude",
    title: id,
    cwd: "/p",
    projectName: "p",
    model: "m",
    models: ["m"],
    messageCount: 0,
    usage,
    cost: null,
    startedAt: 0,
    updatedAt: 0,
    path: id,
    gitBranch: null,
  } as SessionSummary,
  messages: [],
})

describe("detail-cache", () => {
  beforeEach(() => clearDetailCache())

  it("builds a source-scoped key", () => {
    expect(detailCacheKey("claude", "a.jsonl")).toBe("claude:a.jsonl")
    expect(detailCacheKey("codex", "a.jsonl")).not.toBe(detailCacheKey("claude", "a.jsonl"))
  })

  it("returns undefined on a miss and the value on a hit", () => {
    expect(getCachedDetail("k")).toBeUndefined()
    const d = detail("k")
    setCachedDetail("k", d)
    expect(getCachedDetail("k")).toBe(d)
  })

  it("clears everything", () => {
    setCachedDetail("k", detail("k"))
    clearDetailCache()
    expect(getCachedDetail("k")).toBeUndefined()
  })

  it("evicts the least-recently-used entry past the cap", () => {
    // Fill past the cap (24). Entry 0 is the oldest and should be evicted.
    for (let i = 0; i < 25; i++) setCachedDetail(`k${i}`, detail(`k${i}`))
    expect(getCachedDetail("k0")).toBeUndefined()
    expect(getCachedDetail("k24")).toBeDefined()
  })

  it("a hit refreshes recency so it survives eviction", () => {
    for (let i = 0; i < 24; i++) setCachedDetail(`k${i}`, detail(`k${i}`))
    // Touch k0 so it is now most-recently used, then push one more in.
    expect(getCachedDetail("k0")).toBeDefined()
    setCachedDetail("k24", detail("k24"))
    // k1 (now oldest) is evicted; k0 survives.
    expect(getCachedDetail("k0")).toBeDefined()
    expect(getCachedDetail("k1")).toBeUndefined()
  })
})
