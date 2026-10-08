/**
 * Normalized chat-history model shared with the Rust reader
 * (`src-tauri/src/history.rs`). The three CLIs store transcripts in wildly
 * different shapes (Claude JSONL, Codex rollout JSONL, OpenCode SQLite); Rust
 * flattens each into these types so the UI renders one model. Serde emits
 * camelCase, so these interfaces match the wire format 1:1.
 *
 * Pure types only — no runtime — so this file is excluded from coverage like the
 * other `types.ts` modules.
 */

/** The agent CLI a session belongs to. */
export type HistorySource = "claude" | "codex" | "opencode" | "pi"

/** Every source in canonical display order. */
export const HISTORY_SOURCES: HistorySource[] = ["claude", "codex", "opencode", "pi"]

export type CostBasis = "billed" | "sourceEstimate"

/**
 * Unified token accounting. The component fields are the disjoint parts summing
 * to `total` for a given source, so aggregating `total` never double-counts.
 * `cacheRead` / `reasoning` may be informational subsets already inside `total`
 * depending on the source (see the Rust `finish_total` notes).
 */
export interface TokenUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  total: number
}

/** Lightweight per-session record for the list + usage stats. */
export interface SessionSummary {
  id: string
  source: HistorySource
  title: string
  cwd: string
  projectName: string
  /** Primary (last-seen) model id. */
  model: string
  /** Every distinct model id seen in the session. */
  models: string[]
  messageCount: number
  usage: TokenUsage
  /** Real USD cost when the source records it (OpenCode); otherwise null. */
  cost: number | null
  /** Provenance for a source-provided cost; absent means agentpack prices tokens. */
  costBasis?: CostBasis | null
  /** Number of leaves in a tree session; linear sources default to one. */
  branchCount?: number
  /** Epoch milliseconds. */
  startedAt: number
  updatedAt: number
  /** Handle `getSession` reopens the transcript with (file path or session id). */
  path: string
  gitBranch: string | null
  /**
   * Set on a sub-agent transcript: the id of the session that spawned it. The
   * list nests these under their parent instead of showing them as peers.
   */
  parentId: string | null
  /** Sub-agent label from Claude's `agent-name` record. */
  agentName: string | null
  /**
   * Wall-clock time actually spent, summed from Claude's `turn_duration`
   * records. `null` for sources that don't record it — absent, not zero.
   */
  durationMs: number | null
}

/** Kind of a normalized content block. */
export type PartKind =
  | "text"
  | "thinking"
  | "toolCall"
  | "toolResult"
  | "image"
  | "patch"
  | "webSearch"
  | "event"
  /** Codex multi-agent: a message from another agent (its report, a hand-off). */
  | "agentMessage"
  /** Codex multi-agent: a spawned agent started / was interacted with / stopped. */
  | "subagentActivity"

/** One normalized content block within a message. */
export interface Part {
  kind: PartKind
  /**
   * Main payload: message text, tool input, tool output, patch body, etc.
   * Capped by the Rust side — when `truncated`, this is only a prefix.
   */
  text: string
  /**
   * Tool name for toolCall / toolResult; attachment subtype for `event`;
   * envelope kind for `agentMessage` (`FINAL_ANSWER`, …) and `subagentActivity`
   * (`started`, …).
   */
  name: string | null
  /**
   * The *other* agent a multi-agent part concerns, as its canonical Codex path
   * (`/root/pip_i18n`). `null` for every single-agent part kind.
   */
  agent: string | null
  callId: string | null
  isError: boolean | null
  /** `true` when `text` is only a prefix of the real payload. */
  truncated: boolean | null
  /** Byte length of the full payload when `truncated`. */
  fullBytes: number | null
  /** Locator `getPartText` fetches the full payload with. */
  ref: string | null
}

/** One turn in a transcript. */
export interface Message {
  id: string
  role: "user" | "assistant" | "system" | "tool"
  ts: number | null
  model: string | null
  parts: Part[]
  usage: TokenUsage | null
}

export interface SessionDetail {
  summary: SessionSummary
  messages: Message[]
  tree?: SessionTree
}

export interface SessionTreeNode {
  id: string
  parentId: string | null
  kind: string
  label: string | null
  message: Message | null
}

export interface SessionTree {
  activeLeafId: string
  nodes: SessionTreeNode[]
}

/** A source that failed to scan (missing dir is absent, not an error). */
export interface SourceError {
  source: string
  message: string
}

/**
 * `SourceError.source` for a scan that failed as a whole: the command itself
 * rejected, so no source was read at all. Recorded as an error rather than as
 * an empty result — an empty list says "this machine has no history", which is
 * exactly the claim a failed read can't make. Not a `HistorySource`, so it is
 * never looked up in the per-CLI tables.
 */
export const WHOLE_SCAN = "*"

export interface ListResult {
  sessions: SessionSummary[]
  errors: SourceError[]
}

/** How far a scan has got, streamed while gigabytes of JSONL are re-parsed. */
export interface ScanProgress {
  done: number
  total: number
}

/**
 * One priced unit of work, packed as
 * `[ts, modelIndex, input, output, cacheRead, cacheWrite, reasoning]`.
 *
 * `modelIndex` points into the owning `SessionSeries.models`, or is `-1` when
 * the record named no model. Packed rather than an object because a real
 * history holds ~600k of these; see the Rust `PackedEvent`.
 */
export type PackedEvent = [
  ts: number,
  modelIndex: number,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
  reasoning: number,
  /** Source-provided cost in millionths of USD; absent/-1 means unavailable. */
  reportedCostMicros?: number,
]

/** Field offsets into a {@link PackedEvent}, so callers never index by magic number. */
export const EV = {
  ts: 0,
  model: 1,
  input: 2,
  output: 3,
  cacheRead: 4,
  cacheWrite: 5,
  reasoning: 6,
  reportedCost: 7,
} as const

/**
 * How often one tool was called in a session, and how often it failed.
 * `errors` stays 0 for Codex, which writes tool output as free text with no
 * failure flag — absent data, not a claim of success.
 */
export interface ToolStat {
  name: string
  calls: number
  errors: number
}

/** The message-level detail behind a session — see the Rust `SessionSeries`. */
export interface SessionSeries {
  id: string
  source: HistorySource
  projectName: string
  gitBranch: string | null
  parentId: string | null
  /** Model ids referenced by `events[i][EV.model]`, in first-seen order. */
  models: string[]
  events: PackedEvent[]
  /** Sorted most-called first by the Rust side. */
  tools: ToolStat[]
  costBasis?: CostBasis | null
}

export interface UsageSeriesResult {
  sessions: SessionSeries[]
  errors: SourceError[]
  /** Same-scan summaries. Optional for compatibility with older desktop builds. */
  summary?: ListResult
}
