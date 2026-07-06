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
export type HistorySource = "claude" | "codex" | "opencode"

/** Every source in canonical display order. */
export const HISTORY_SOURCES: HistorySource[] = ["claude", "codex", "opencode"]

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
  /** Epoch milliseconds. */
  startedAt: number
  updatedAt: number
  /** Handle `getSession` reopens the transcript with (file path or session id). */
  path: string
  gitBranch: string | null
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

/** One normalized content block within a message. */
export interface Part {
  kind: PartKind
  /** Main payload: message text, tool input, tool output, patch body, etc. */
  text: string
  /** Tool name for toolCall / toolResult. */
  name: string | null
  callId: string | null
  isError: boolean | null
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
}

/** A source that failed to scan (missing dir is absent, not an error). */
export interface SourceError {
  source: string
  message: string
}

export interface ListResult {
  sessions: SessionSummary[]
  errors: SourceError[]
}
