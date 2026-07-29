/**
 * Shared builders for the usage-panel tests.
 *
 * Not a `.test.` file so Jest doesn't try to run it, and not exported from the
 * panels themselves so production code never depends on test scaffolding.
 */
import type { PackedEvent, SessionSeries, SessionSummary, TokenUsage } from "@/lib/history/types"

export const usage = (over: Partial<TokenUsage> = {}): TokenUsage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  total: 0,
  ...over,
})

export const session = (over: Partial<SessionSummary> = {}): SessionSummary => ({
  id: "s",
  source: "claude",
  title: "A session",
  cwd: "/proj",
  projectName: "proj",
  model: "claude-opus-4-8",
  models: ["claude-opus-4-8"],
  messageCount: 4,
  usage: usage({ input: 1000, output: 100, total: 1100 }),
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

/** `[ts, modelIndex, input, output, cacheRead, cacheWrite, reasoning]`. */
export const ev = (
  ts: number,
  model: number,
  input: number,
  output: number,
  cacheRead = 0,
  cacheWrite = 0
): PackedEvent => [ts, model, input, output, cacheRead, cacheWrite, 0]

export const series = (over: Partial<SessionSeries> = {}): SessionSeries => ({
  id: "s",
  source: "claude",
  projectName: "proj",
  gitBranch: null,
  parentId: null,
  models: ["claude-opus-4-8"],
  events: [],
  tools: [],
  ...over,
})
